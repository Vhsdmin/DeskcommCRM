import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { atividadeDoClienteSchema, TIPO_ATIVIDADE } from "@/lib/contacts/atividade-schema";
const editSchema = atividadeDoClienteSchema.extend({ revision: z.number().int().nonnegative() });
const deleteSchema = z.object({ revision: z.number().int().nonnegative() }).strict();
type Context = { params: Promise<{ id: string; activityId: string }> };
export const dynamic = "force-dynamic";
async function change(req: NextRequest, ctx: Context, remove: boolean) {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const { id, activityId } = await ctx.params;
  if (![id, activityId].every((value) => z.uuid().safeParse(value).success))
    return fail("validation_failed", "ID inválido.", 422, { requestId });
  const body = await req.json().catch(() => null);
  const parsed = (remove ? deleteSchema : editSchema).safeParse(body);
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });
  const db = await createClient();
  const contact = await db
    .from("contacts")
    .select("id,is_anonymized,is_merged_into")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (contact.error)
    return fail("internal_error", "Erro ao consultar cliente.", 500, { requestId });
  if (!contact.data) return fail("not_found", "Cliente não encontrado.", 404, { requestId });
  if (contact.data.is_anonymized || contact.data.is_merged_into)
    return fail("conflict", "Cliente indisponível para alterações.", 409, { requestId });
  const existing = await db
    .from("crm_lead_activities")
    .select("id,type,revision,performed_by_user_id,payload,performed_at")
    .eq("organization_id", authz.org.orgId)
    .eq("contact_id", id)
    .eq("id", activityId)
    .eq("source_module", "crm")
    .eq("actor_kind", "user")
    .is("lead_id", null)
    .is("deleted_at", null)
    .in("type", Object.values(TIPO_ATIVIDADE))
    .maybeSingle();
  if (existing.error)
    return fail("internal_error", "Erro ao consultar atividade.", 500, { requestId });
  if (!existing.data) return fail("not_found", "Atividade não encontrada.", 404, { requestId });
  if (
    existing.data.performed_by_user_id !== authz.user.id &&
    !["manager", "admin"].includes(authz.org.role)
  )
    return fail("forbidden", "Sem permissão para alterar este registro.", 403, { requestId });
  if (existing.data.revision !== parsed.data.revision)
    return fail(
      "conflict",
      "O registro mudou. Atualize o histórico antes de tentar novamente.",
      409,
      { requestId },
    );
  const timestamp = new Date().toISOString();
  const edit = !remove ? editSchema.parse(body) : null;
  const changes = {
    revision: parsed.data.revision + 1,
    edited_at: timestamp,
    edited_by_user_id: authz.user.id,
    ...(remove
      ? { deleted_at: timestamp }
      : {
          type: TIPO_ATIVIDADE[edit!.kind],
          payload: { summary: edit!.summary, next_steps: edit!.next_steps },
          performed_at: edit!.performed_at,
        }),
  };
  const result = remove
    ? await db.rpc("fn_delete_customer_activity", {
        p_id: activityId,
        p_contact: id,
        p_org: authz.org.orgId,
        p_revision: parsed.data.revision,
      })
    : await db
        .from("crm_lead_activities")
        .update(changes, { count: "exact" })
        .eq("organization_id", authz.org.orgId)
        .eq("contact_id", id)
        .eq("id", activityId)
        .eq("revision", parsed.data.revision)
        .is("deleted_at", null);
  // Exclusão usa operação restrita para manter a RLS que oculta registros excluídos.
  if (result.error) return fail("internal_error", "Erro ao alterar atividade.", 500, { requestId });
  if (remove ? result.data !== true : result.count !== 1)
    return fail(
      "conflict",
      "O registro mudou. Atualize o histórico antes de tentar novamente.",
      409,
      { requestId },
    );
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "contact.updated",
    resourceType: "contacts",
    resourceId: id,
    requestId,
    metadata: {
      activity_id: activityId,
      operation: remove ? "activity.deleted" : "activity.edited",
      // O CONTEÚDO do registro (resumo, próximos passos) não entra: a auditoria
      // é append-only e a anonimização LGPD não a alcança. Fica o que identifica
      // a mudança sem carregar dado do cliente.
      previous: {
        type: existing.data.type,
        performed_at: existing.data.performed_at,
        revision: existing.data.revision,
        had_next_steps: Boolean(
          (existing.data.payload as { next_steps?: unknown } | null)?.next_steps,
        ),
      },
    },
  });
  return ok({ id: activityId, revision: parsed.data.revision + 1, deleted: remove }, { requestId });
}
// A guarda de suporte fica em cada handler exportado, onde a varredura de
// `tests/unit/suporte-cobertura-de-efeitos.test.ts` a enxerga.
export async function PATCH(req: NextRequest, ctx: Context) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  return change(req, ctx, false);
}
export async function DELETE(req: NextRequest, ctx: Context) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  return change(req, ctx, true);
}
