/**
 * GET /api/v1/conversations/[id]/quem-ja-atende — quem, além do dono desta
 * conversa, já está com este cliente.
 *
 * Duas fontes, e as duas valem o aviso:
 *  - **conversa aberta**: outra conversa ativa do MESMO contato, com outra
 *    pessoa (o cliente escreveu para outro número, ou foi atendido antes);
 *  - **CSM**: o responsável pelo cliente na Carteira (`contacts.cs_owner_user_id`).
 *
 * Só devolve gente diferente de quem já é dono desta conversa: se a conversa já
 * está com a CSM, não há o que avisar. A tela mostra o aviso com o botão de
 * transferir, que usa a rota de transferência de sempre — esta aqui só lê.
 *
 * Leitura pela sessão: a RLS de `conversations` e `contacts` isola a
 * organização, e o filtro explícito por `organization_id` escolhe a org ativa.
 *
 * `pode_receber` diz se a transferência seria aceita: a rota de transferência
 * exige membro ATIVO `agent`+ da org, e a CSM desligada ou rebaixada a
 * `viewer` continua gravada no contato. O aviso segue valendo (é fato que ela
 * está ligada ao cliente), mas o botão que só levaria 422 não aparece.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { isServiceRoleConfigured } from "@/lib/audit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

/** Estados em que a conversa ainda está sendo atendida. */
const ESTADOS_ATIVOS = ["open", "pending", "claimed", "ai_handling"];

export type MotivoDeQuemJaAtende = "conversa_aberta" | "csm";

export interface QuemJaAtende {
  user_id: string;
  nome: string | null;
  motivos: MotivoDeQuemJaAtende[];
  /** A conversa aberta com essa pessoa, quando o motivo é `conversa_aberta`. */
  conversation_id: string | null;
  /** A transferência para essa pessoa seria aceita (membro ativo `agent`+). */
  pode_receber: boolean;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: conversa, error: erroConversa } = await supabase
    .from("conversations")
    .select("id, contact_id, assigned_to_user_id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (erroConversa) return fail("internal_error", erroConversa.message, 500, { requestId });
  if (!conversa) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  const dono = (conversa.assigned_to_user_id as string | null) ?? null;

  const [outras, contato] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, assigned_to_user_id, last_message_at")
      .eq("organization_id", orgId)
      .eq("contact_id", conversa.contact_id)
      .neq("id", id)
      .in("status", ESTADOS_ATIVOS)
      .not("assigned_to_user_id", "is", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from("contacts")
      .select("cs_owner_user_id")
      .eq("organization_id", orgId)
      .eq("id", conversa.contact_id)
      .maybeSingle(),
  ]);
  const falha = outras.error ?? contato.error;
  if (falha) return fail("internal_error", falha.message, 500, { requestId });

  const porPessoa = new Map<string, QuemJaAtende>();
  for (const c of (outras.data ?? []) as Array<{ id: string; assigned_to_user_id: string }>) {
    if (c.assigned_to_user_id === dono || porPessoa.has(c.assigned_to_user_id)) continue;
    porPessoa.set(c.assigned_to_user_id, {
      user_id: c.assigned_to_user_id,
      nome: null,
      motivos: ["conversa_aberta"],
      conversation_id: c.id,
      pode_receber: false,
    });
  }
  const csm = (contato.data?.cs_owner_user_id as string | null) ?? null;
  if (csm && csm !== dono) {
    const ja = porPessoa.get(csm);
    if (ja) ja.motivos.push("csm");
    else
      porPessoa.set(csm, {
        user_id: csm,
        nome: null,
        motivos: ["csm"],
        conversation_id: null,
        pode_receber: false,
      });
  }

  const ids = [...porPessoa.keys()];
  const recebem = await quemPodeReceber(orgId, ids);
  if (recebem instanceof Error) return fail("internal_error", recebem.message, 500, { requestId });

  const nomes = await nomesDosAtendentes(ids);
  const lista = [...porPessoa.values()].map((p) => ({
    ...p,
    nome: nomes.get(p.user_id) ?? null,
    pode_receber: recebem === null || recebem.has(p.user_id),
  }));

  return ok(lista, { requestId });
}

/**
 * Os membros ativos `agent`+ da org entre `ids` — a MESMA regra da rota de
 * transferência. Pelo admin client filtrado pela org da sessão, porque a RLS
 * de `user_organizations` só mostra a um agent o próprio vínculo. Sem service
 * role a transferência também não confere, e devolver `null` (todos podem)
 * mantém as duas rotas de acordo.
 */
async function quemPodeReceber(orgId: string, ids: string[]): Promise<Set<string> | null | Error> {
  if (ids.length === 0 || !isServiceRoleConfigured()) return null;
  const { data, error } = await createAdminClient()
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", orgId)
    .in("user_id", ids)
    .is("revoked_at", null);
  if (error) return new Error(error.message);
  return new Set(
    ((data ?? []) as Array<{ user_id: string; role: string }>)
      .filter((m) => m.role !== "viewer")
      .map((m) => m.user_id),
  );
}
