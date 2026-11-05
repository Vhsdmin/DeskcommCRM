/**
 * LEITURAS DE GESTÃO — desempenho da equipe, relatório de atividades e registro
 * de auditoria, para quem configura e acompanha a operação por fora da tela.
 *
 * ⚠️ TODAS SÓ LEEM, e todas filtram `organization_id` em voz alta: o client pode
 * ser service role.
 *
 * ⚠️ O painel de desempenho de CS (`fn_cs_performance`) NÃO está aqui de
 * propósito: a função exige `auth.uid()`, a sessão de uma pessoa, e recusa o
 * service role. O que sai daqui é o funil e os atendentes (`fn_attendant_metrics`,
 * a mesma consulta de `app/api/v1/metrics/attendants`) e o relatório de
 * atividades (`fn_activity_report`, o mesmo de `app/api/v1/reports/activities`).
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/types";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";
import type { PipelineVocabulary } from "@/lib/kanban/types";
import {
  fusoValido,
  janelaDoPeriodo,
  montarRelatorio,
  type NomesConhecidos,
  type RelatorioBruto,
  type RelatorioDeAtividades,
} from "@/lib/reports/atividades";

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;
const LIMITE_DE_LINHAS = 200;

export const desempenhoQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  owner_user_id: z.string().uuid().optional(),
});

export const atividadesQuerySchema = z.object({
  days: z.number().int().min(1).max(90).default(7),
  tz: z.string().min(1).max(64).default("UTC").refine(fusoValido, { message: "Fuso horário desconhecido." }),
});

export const auditoriaQuerySchema = z.object({
  action: z.string().min(1).max(100).optional(),
  resource_type: z.string().min(1).max(100).optional(),
  actor_user_id: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

interface LinhaDeAtendente {
  user_id: string;
  won: number;
  lost: number;
  conversations_handled: number;
  avg_first_response_seconds: number | null;
}

export interface DesempenhoDaEquipe {
  window: { from: string; to: string };
  funnel: Array<{ stage_id: string; stage_name: string; position: number; count: number }>;
  attendants: Array<LinhaDeAtendente & { name: string | null; email: string | null }>;
}

function erroInterno(deps: DepsDaOperacao, mensagem: string): ApiError {
  return new ApiError(500, "internal_error", undefined, deps.requestId, mensagem);
}

function invalido(deps: DepsDaOperacao, detalhes: unknown, mensagem: string): ApiError {
  return new ApiError(400, "invalid_request", detalhes as Record<string, unknown>, deps.requestId, mensagem);
}

/** Nome e e-mail pelo Auth admin; se o client não for service role, fica em branco. */
async function nomeDoUsuario(
  deps: DepsDaOperacao,
  userId: string,
): Promise<{ name: string | null; email: string | null }> {
  try {
    const { data } = await deps.supabase.auth.admin.getUserById(userId);
    const u = data?.user;
    return {
      name: (u?.user_metadata?.full_name as string | undefined) ?? null,
      email: u?.email ?? null,
    };
  } catch {
    return { name: null, email: null };
  }
}

export async function desempenhoDaEquipe(
  deps: DepsDaOperacao,
  input: unknown,
): Promise<DesempenhoDaEquipe> {
  const parsed = desempenhoQuerySchema.safeParse(input ?? {});
  if (!parsed.success) throw invalido(deps, parsed.error.flatten(), "Confira o período.");
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - TRINTA_DIAS_MS);
  if (from.getTime() >= to.getTime()) {
    throw invalido(deps, undefined, "Janela inválida: o início precisa vir antes do fim.");
  }
  const { data, error } = await deps.supabase.rpc("fn_attendant_metrics", {
    p_org: deps.organizationId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_owner: parsed.data.owner_user_id ?? null,
  });
  if (error) throw erroInterno(deps, error.message);
  const bruto = (data ?? { funnel: [], attendants: [] }) as unknown as {
    funnel: DesempenhoDaEquipe["funnel"];
    attendants: LinhaDeAtendente[];
  };
  const attendants = await Promise.all(
    (bruto.attendants ?? []).map(async (a) => ({ ...a, ...(await nomeDoUsuario(deps, a.user_id)) })),
  );
  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    funnel: bruto.funnel ?? [],
    attendants,
  };
}

function ehId(v: string | null): v is string {
  return typeof v === "string" && v.length > 0;
}

export async function relatorioDeAtividades(
  deps: DepsDaOperacao,
  input: unknown,
): Promise<{ window: { from: string; to: string } } & RelatorioDeAtividades> {
  const parsed = atividadesQuerySchema.safeParse(input ?? {});
  if (!parsed.success) throw invalido(deps, parsed.error.flatten(), "Confira o período e o fuso.");
  const { de, ate } = janelaDoPeriodo(parsed.data.days, new Date());
  const { data, error } = await deps.supabase.rpc("fn_activity_report", {
    p_org: deps.organizationId,
    p_from: de.toISOString(),
    p_to: ate.toISOString(),
    p_tz: parsed.data.tz,
    p_limit: LIMITE_DE_LINHAS,
  });
  if (error) throw erroInterno(deps, error.message);
  const bruto = (data ?? {
    total: 0,
    by_actor: [],
    by_type: [],
    daily: [],
    items: [],
    items_truncated: false,
  }) as unknown as RelatorioBruto;

  const nomes: NomesConhecidos = { usuarios: {}, agentes: {} };
  const idsDeUsuario = [...new Set(bruto.by_actor.map((a) => a.user_id).filter(ehId))];
  const idsDeAgente = [...new Set(bruto.by_actor.map((a) => a.agent_id).filter(ehId))];
  await Promise.all(
    idsDeUsuario.map(async (id) => {
      const { name, email } = await nomeDoUsuario(deps, id);
      nomes.usuarios[id] = name ?? email ?? null;
    }),
  );
  if (idsDeAgente.length > 0) {
    const { data: agentes } = await deps.supabase
      .from("ai_agents")
      .select("id, name")
      .eq("organization_id", deps.organizationId)
      .in("id", idsDeAgente);
    for (const a of (agentes ?? []) as Array<{ id: string; name: string }>) nomes.agentes[a.id] = a.name;
  }
  const { data: funil } = await deps.supabase
    .from("crm_pipelines")
    .select("vocabulary")
    .eq("organization_id", deps.organizationId)
    .eq("is_default", true)
    .maybeSingle();
  const relatorio = montarRelatorio(bruto, {
    nomes,
    vocabulary: ((funil as { vocabulary?: unknown } | null)?.vocabulary ?? null) as PipelineVocabulary | null,
  });
  return { window: { from: de.toISOString(), to: ate.toISOString() }, ...relatorio };
}

export interface LinhaDeAuditoria {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_api_token_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown> | null;
}

export async function listarAuditoria(
  deps: DepsDaOperacao,
  input: unknown,
): Promise<{ entries: LinhaDeAuditoria[]; has_more: boolean }> {
  const parsed = auditoriaQuerySchema.safeParse(input ?? {});
  if (!parsed.success) throw invalido(deps, parsed.error.flatten(), "Confira os filtros.");
  const q = parsed.data;
  let query = deps.supabase
    .from("api_audit_log")
    .select(
      "id, created_at, actor_user_id, actor_api_token_id, action, resource_type, resource_id, request_id, metadata",
    )
    .eq("organization_id", deps.organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1);
  if (q.actor_user_id) query = query.eq("actor_user_id", q.actor_user_id);
  if (q.action) query = query.ilike("action", `%${q.action}%`);
  if (q.resource_type) query = query.eq("resource_type", q.resource_type);
  if (q.from) query = query.gte("created_at", q.from);
  if (q.to) query = query.lte("created_at", q.to);
  const { data, error } = await query;
  if (error) throw erroInterno(deps, error.message);
  const rows = ((data ?? []) as unknown as LinhaDeAuditoria[]);
  const hasMore = rows.length > q.limit;
  return { entries: hasMore ? rows.slice(0, q.limit) : rows, has_more: hasMore };
}
