import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { atividadeDoClienteSchema, TIPO_ATIVIDADE } from "@/lib/contacts/atividade-schema";
/**
 * GET /api/v1/contacts/[id]/timeline
 *
 * Returns polymorphic timeline (`crm_lead_activities`) for a contact, merging
 * direct `contact_id` activities with activities attached to leads owned by
 * this contact. Two RLS-scoped queries client-side (supabase-js does not
 * compose `.or` with subqueries cleanly), then merge → sort → cursor-paginate.
 *
 * Filters:
 *   - type: repeatable query param (?type=order_created&type=message_inbound)
 *   - cursor: opaque base64 of (performed_at, id)
 *   - limit: 1..100 (default 50)
 *
 * ESTA ROTA NÃO É O DOSSIÊ DO NEGÓCIO. Ela é a vida do CONTATO, e por isso
 * soma os negócios dele — o que no dossiê de UM negócio apareceria como
 * história do irmão. O dossiê usa `leads/[id]/timeline`, ancorada no lead;
 * as duas dividem as peças de `lib/leads/timeline-query.ts` e divergem só na
 * cláusula, que é justamente onde a diferença mora.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import type { TimelineItem } from "@/lib/types/contacts";
import {
  TIMELINE_COLS,
  comNomeDoAtor,
  decodeCursor,
  encodeCursor,
  type Cursor,
} from "@/lib/leads/timeline-query";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: contactId } = await ctx.params;
  const authz = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const authUser = await loadAuthUser();
  const t = (texto: string) => traduzir(texto, authUser?.idioma ?? "pt-BR");

  const url = new URL(req.url);
  const types = url.searchParams.getAll("type").filter(Boolean);
  const cursorRaw = url.searchParams.get("cursor");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 100);

  let cursor: Cursor | null = null;
  if (cursorRaw) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) {
      return fail("invalid_cursor", t("Cursor inválido."), 400, { requestId });
    }
  }

  // Verify contact accessible (RLS will filter); 404 if not.
  const { data: contactRow, error: cErr } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (cErr) return fail("internal_error", cErr.message, 500, { requestId });
  if (!contactRow) return fail("not_found", t("Contato não encontrado."), 404, { requestId });

  // Resolve owned lead ids first.
  const { data: leadRows, error: lErr } = await supabase
    .from("crm_leads")
    .select("id")
    .eq("contact_id", contactId)
    .eq("organization_id", authz.org.orgId);
  if (lErr) return fail("internal_error", lErr.message, 500, { requestId });

  const leadIds = (leadRows ?? []).map((r) => (r as { id: string }).id);

  // Pull last (limit + 1) from each side to detect has_more after merge.
  // We over-fetch slightly to keep merge correct.
  const FETCH = limit + 1;

  const buildQuery = (column: "contact_id" | "lead_id", values: string | string[]) => {
    let q = supabase
      .from("crm_lead_activities")
      .select(TIMELINE_COLS)
      .eq("organization_id", authz.org.orgId)
      .order("performed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(FETCH);
    if (Array.isArray(values)) q = q.in(column, values);
    else q = q.eq(column, values);
    if (types.length > 0) q = q.in("type", types);
    if (cursor) {
      q = q.or(
        `performed_at.lt.${cursor.performed_at},and(performed_at.eq.${cursor.performed_at},id.lt.${cursor.id})`,
      );
    }
    return q;
  };

  const directQ = buildQuery("contact_id", contactId);
  const leadQ =
    leadIds.length > 0
      ? buildQuery("lead_id", leadIds)
      : Promise.resolve({ data: [], error: null });

  const [directRes, leadRes] = await Promise.all([directQ, leadQ]);

  if (directRes.error) {
    return fail("internal_error", directRes.error.message, 500, { requestId });
  }
  if ("error" in leadRes && leadRes.error) {
    return fail("internal_error", leadRes.error.message, 500, { requestId });
  }

  // Cast duplo porque a lista de colunas agora é montada com `join()`: o
  // supabase-js infere o shape a partir da STRING LITERAL do select, e a
  // string dinâmica apaga essa inferência (vira GenericStringError[]). A troca
  // é deliberada — perde-se uma inferência que já não protegia contra o bug
  // real (campo do tipo fora do SELECT compilava verde) e ganha-se o portão de
  // exaustividade acima, que protege.
  const merged = new Map<string, TimelineItem>();
  for (const row of (directRes.data ?? []) as unknown as TimelineItem[]) merged.set(row.id, row);
  for (const row of (leadRes.data ?? []) as unknown as TimelineItem[]) merged.set(row.id, row);

  const sorted = Array.from(merged.values()).sort((a, b) => {
    if (a.performed_at !== b.performed_at) {
      return a.performed_at < b.performed_at ? 1 : -1;
    }
    return a.id < b.id ? 1 : -1;
  });

  const hasMore = sorted.length > limit;
  const pageRows = hasMore ? sorted.slice(0, limit) : sorted;

  // Quem agiu, com NOME — resolvido aqui, na borda, e não na tela. É a mesma
  // decisão do dono agente no board: o dado de exibição viaja com a linha, em
  // vez de a tela ter de descobrir sozinha (e mostrar "Agente" genérico quando
  // não descobre). Sem filtro de is_active/archived: quem AGIU agiu, mesmo que
  // o agente tenha sido desligado depois.
  const page = await comNomeDoAtor(supabase, pageRows);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ performed_at: last.performed_at, id: last.id }) : null;

  return ok(page, {
    requestId,
    meta: { cursor: nextCursor, has_more: hasMore },
  });
}

/** Registra relacionamento diretamente no contato, sem inventar um lead. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success)
    return fail("validation_failed", "ID inválido.", 422, { requestId });
  const parsed = atividadeDoClienteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });
  const supabase = await createClient();
  const contact = await supabase
    .from("contacts")
    .select("id,is_anonymized,is_merged_into")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (contact.error)
    return fail("internal_error", "Erro ao consultar cliente.", 500, { requestId });
  if (!contact.data) return fail("not_found", "Cliente não encontrado.", 404, { requestId });
  if (contact.data.is_anonymized || contact.data.is_merged_into)
    return fail("conflict", "Cliente indisponível para novos registros.", 409, { requestId });
  const { kind, summary, next_steps, performed_at } = parsed.data;
  const result = await supabase
    .from("crm_lead_activities")
    .insert({
      organization_id: authz.org.orgId,
      contact_id: id,
      lead_id: null,
      source_module: "crm",
      type: TIPO_ATIVIDADE[kind],
      performed_at,
      performed_by_user_id: authz.user.id,
      actor_kind: "user",
      payload: { summary, next_steps },
    })
    .select("id")
    .single();
  if (result.error)
    return fail("internal_error", "Erro ao registrar atividade.", 500, { requestId });
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "contact.updated",
    resourceType: "contacts",
    resourceId: id,
    requestId,
    metadata: { activity_id: result.data.id, activity_type: TIPO_ATIVIDADE[kind] },
  });
  return ok(result.data, { requestId, status: 201 });
}
