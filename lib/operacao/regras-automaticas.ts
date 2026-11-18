/**
 * As REGRAS AUTOMÁTICAS — o que o sistema faz sozinho quando algo acontece
 * (`automation_rules` + `automation_rule_runs`).
 *
 * ⚠️ ESTA É A PEÇA MAIS PERIGOSA QUE O AGENTE ALCANÇA, e a razão é o tempo:
 * uma regra ligada dispara em todo evento que casar, para sempre, sem ninguém
 * assistindo. Ligar uma regra de `call_webhook` manda dado da empresa para fora
 * a cada lead novo; ligar uma de `send_whatsapp_message` fala com clientes de
 * verdade. Nenhuma dessas duas coisas volta atrás. Por isso a capacidade de
 * ligar/desligar é `critico` no catálogo — nunca entra por pacote.
 *
 * ⚠️ O QUE O AGENTE **NÃO** PODE FAZER, e é decisão, não omissão: criar regra,
 * editar o gatilho, editar as ações ou apagar. Ligar uma regra que um humano
 * escreveu e revisou é reversível por um clique na tela e o humano sabe o que
 * ela faz. Deixar o agente ESCREVER a ação seria deixá-lo escolher para qual
 * endereço externo a empresa manda dados — e aí o gate humano vira decorativo.
 *
 * ⚠️ `actions` NUNCA SAI COM `config` CRU. A configuração de `call_webhook`
 * carrega `secret_enc` e a URL de destino. O que sai daqui é a LISTA DE TIPOS de
 * ação — o suficiente para dizer "esta regra manda mensagem e aplica marcador",
 * que é o que alguém precisa saber para decidir se liga.
 */
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { atorParaAuditoria, autoriaDaMudanca } from "@/lib/operacao/autoria";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";
import { createAutomationRuleSchema, updateAutomationRuleSchema } from "@/lib/schemas/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptRuleActionSecrets, type RuleActionInput } from "@/lib/webhooks/secrets";

export interface RegraVisivel {
  id: string;
  name: string;
  is_active: boolean;
  /** O evento que a dispara, no vocabulário do sistema (`lead.created`, …). */
  trigger_event: string;
  /** Só os TIPOS das ações — nunca a configuração. Ver o aviso no topo. */
  acoes: string[];
  quantidade_de_condicoes: number;
  last_run_at: string | null;
  run_count: number;
  last_change_actor_kind: string | null;
  last_change_at: string | null;
}

const COLUNAS =
  "id, name, is_active, trigger_event, conditions, actions, last_run_at, run_count, " +
  "last_change_actor_kind, last_change_at";

function semConfig(linha: Record<string, unknown>): RegraVisivel {
  const acoes = Array.isArray(linha.actions)
    ? (linha.actions as Array<{ type?: unknown }>).map((a) => String(a?.type ?? "desconhecida"))
    : [];
  const condicoes = Array.isArray(linha.conditions) ? linha.conditions.length : 0;
  return {
    id: linha.id as string,
    name: linha.name as string,
    is_active: Boolean(linha.is_active),
    trigger_event: linha.trigger_event as string,
    acoes,
    quantidade_de_condicoes: condicoes,
    last_run_at: (linha.last_run_at as string | null) ?? null,
    run_count: Number(linha.run_count ?? 0),
    last_change_actor_kind: (linha.last_change_actor_kind as string | null) ?? null,
    last_change_at: (linha.last_change_at as string | null) ?? null,
  };
}

export async function listarRegrasAutomaticas(
  deps: DepsDaOperacao,
  opts: { apenasAtivas?: boolean } = {},
): Promise<RegraVisivel[]> {
  let q = deps.supabase
    .from("automation_rules")
    .select(COLUNAS)
    .eq("organization_id", deps.organizationId)
    .order("created_at", { ascending: false });
  if (opts.apenasAtivas) q = q.eq("is_active", true);

  const { data, error } = await q;
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(semConfig);
}

async function regraDaOrg(
  deps: DepsDaOperacao,
  id: string,
): Promise<{ id: string; name: string; is_active: boolean }> {
  const { data, error } = await deps.supabase
    .from("automation_rules")
    .select("id, name, is_active")
    .eq("id", id)
    .eq("organization_id", deps.organizationId)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  if (!data) {
    throw new ApiError(404, "not_found", undefined, deps.requestId, "Essa regra não existe aqui.");
  }
  return data as unknown as { id: string; name: string; is_active: boolean };
}

/** Liga ou desliga a regra. Ver o aviso do topo antes de afrouxar o risco disto. */
export async function definirRegraAtiva(
  deps: DepsDaOperacao,
  input: { id: string; ativa: boolean },
): Promise<RegraVisivel> {
  const antes = await regraDaOrg(deps, input.id);

  const { data: updated, error } = await deps.supabase
    .from("automation_rules")
    .update({
      is_active: input.ativa,
      updated_at: new Date().toISOString(),
      ...autoriaDaMudanca(deps.actor),
    })
    .eq("id", input.id)
    .eq("organization_id", deps.organizationId)
    .select(COLUNAS)
    .single();
  if (error || !updated) {
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      deps.requestId,
      error?.message ?? "automation_rule_update_failed",
    );
  }

  await audit({
    action: "automation.rule_updated",
    actorUserId: deps.actor.type === "user" ? deps.actor.id : null,
    organizationId: deps.organizationId,
    resourceType: "automation_rule",
    resourceId: input.id,
    requestId: deps.requestId,
    metadata: {
      is_active: input.ativa,
      de: antes.is_active,
      name: antes.name,
      actor_type: deps.actor.type,
    },
  });

  return semConfig(updated as unknown as Record<string, unknown>);
}

export interface ExecucaoVisivel {
  id: string;
  regra: string | null;
  status: string;
  quando: string;
  /** Só as que NÃO deram certo — o resto é ruído para quem investiga. */
  falhas: Array<{ acao: string; erro: string }>;
}

/**
 * O que as regras dispararam, e o que falhou.
 *
 * ⚠️ SÓ AS FALHAS VÃO DETALHADAS. `actions_result` traz o resultado de cada ação
 * inclusive nos sucessos, e mandar tudo encheria o contexto do modelo com linhas
 * que não mudam decisão nenhuma (invariante 5 da doutrina: dado que não muda uma
 * decisão é ruído). O status agregado responde "funcionou?"; a lista de falhas
 * responde "o que conserto?".
 */
export async function execucoesDasRegras(
  deps: DepsDaOperacao,
  input: { ruleId?: string; limite: number; apenasFalhas?: boolean },
): Promise<ExecucaoVisivel[]> {
  if (input.ruleId) await regraDaOrg(deps, input.ruleId);

  let q = deps.supabase
    .from("automation_rule_runs")
    .select("id, status, created_at, actions_result, error, rule_id, automation_rules(name)")
    .eq("organization_id", deps.organizationId)
    .order("created_at", { ascending: false })
    .limit(input.limite);
  if (input.ruleId) q = q.eq("rule_id", input.ruleId);
  if (input.apenasFalhas) q = q.in("status", ["failed", "partial"]);

  const { data, error } = await q;
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
    const resultados = Array.isArray(r.actions_result)
      ? (r.actions_result as Array<{ type?: unknown; status?: unknown; error?: unknown }>)
      : [];
    return {
      id: r.id as string,
      regra: nomeDaRegra(r.automation_rules),
      status: r.status as string,
      quando: r.created_at as string,
      falhas: resultados
        .filter((a) => a?.status === "failed")
        .map((a) => ({
          acao: String(a?.type ?? "desconhecida"),
          erro: String(a?.error ?? r.error ?? "sem detalhe"),
        })),
    };
  });
}

/**
 * O nome vindo do join — que o PostgREST devolve como objeto OU array conforme a
 * cardinalidade que ele infere. Tratar só um dos dois formatos deixaria o nome
 * `null` em metade dos casos, e a tela mostraria "Automação removida" para uma
 * regra que existe.
 */
function nomeDaRegra(join: unknown): string | null {
  if (Array.isArray(join)) return (join[0] as { name?: string } | undefined)?.name ?? null;
  if (join && typeof join === "object") return (join as { name?: string }).name ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// ESCREVER regras: OPERADO POR PESSOA. O aviso do topo continua valendo para o
// agente de IA, que não chega aqui: as capacidades que chamam estas funções
// exigem o escopo `mcp:config` (o token efêmero do agente não o carrega) e são
// `apenasHumano` no catálogo (a ponte do turno não as monta). Quem escreve a
// regra por aqui é quem opera o CRM por fora da tela, com um token de gestor.
// ---------------------------------------------------------------------------

export interface AcaoVisivel {
  type: string;
  /** A configuração SEM `secret` e sem `secret_enc`; `has_secret` diz se havia um. */
  config: Record<string, unknown>;
  has_secret: boolean;
}

export interface RegraDetalhada extends RegraVisivel {
  conditions: Array<{ field: string; op: string; value: string }>;
  actions: AcaoVisivel[];
}

function acaoVisivel(a: unknown): AcaoVisivel {
  const acao = (a ?? {}) as { type?: unknown; config?: Record<string, unknown> };
  const { secret: _plain, secret_enc, ...config } = acao.config ?? {};
  return {
    type: String(acao.type ?? "desconhecida"),
    config,
    has_secret: typeof secret_enc === "string" && secret_enc.length > 0,
  };
}

function detalhada(linha: Record<string, unknown>): RegraDetalhada {
  return {
    ...semConfig(linha),
    conditions: Array.isArray(linha.conditions)
      ? (linha.conditions as RegraDetalhada["conditions"])
      : [],
    actions: Array.isArray(linha.actions) ? (linha.actions as unknown[]).map(acaoVisivel) : [],
  };
}

/** Troca `secret` em texto por `secret_enc`; `null` quando a chave de cifra da instalação não está ativa. */
export type CifradorDeAcoes = (acoes: RuleActionInput[]) => Promise<RuleActionInput[] | null>;
const cifradorPadrao: CifradorDeAcoes = (acoes) =>
  encryptRuleActionSecrets(createAdminClient(), acoes);

function recusaDeCifra(deps: DepsDaOperacao): ApiError {
  return new ApiError(
    422,
    "encryption_unavailable",
    undefined,
    deps.requestId,
    "Não foi possível guardar o segredo com segurança: a chave de cifra desta instalação não está ativa. Quem administra o servidor resolve rodando o update.sh, que gera e ativa a chave.",
  );
}

/** A linha inteira, com `actions` como estão no banco (secret_enc incluso). Só para uso interno. */
async function regraCompletaDaOrg(
  deps: DepsDaOperacao,
  id: string,
): Promise<{ actions: RuleActionInput[] }> {
  const { data, error } = await deps.supabase
    .from("automation_rules")
    .select("id, actions")
    .eq("id", id)
    .eq("organization_id", deps.organizationId)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  if (!data) {
    throw new ApiError(404, "not_found", undefined, deps.requestId, "Essa regra não existe aqui.");
  }
  const linha = data as unknown as { actions?: unknown };
  return { actions: Array.isArray(linha.actions) ? (linha.actions as RuleActionInput[]) : [] };
}

/**
 * Quem altera as ações pela leitura de `crm_get_automation_rule` não tem o segredo
 * (a leitura devolve só `has_secret`). Sem isto, mandar as ações de volta sem
 * `secret` apagaria a assinatura do `call_webhook` em silêncio. A assinatura
 * antiga é preservada pela URL quando a nova ação não traz segredo nenhum.
 */
export function preservaAssinaturas(
  novas: RuleActionInput[],
  antigas: RuleActionInput[],
): RuleActionInput[] {
  return novas.map((acao) => {
    if (acao.type !== "call_webhook") return acao;
    const config = (acao.config ?? {}) as Record<string, unknown>;
    if (typeof config.secret === "string" || typeof config.secret_enc === "string") return acao;
    const antiga = antigas.find(
      (a) => a.type === "call_webhook" && (a.config as Record<string, unknown> | undefined)?.url === config.url,
    );
    const herdado = (antiga?.config as Record<string, unknown> | undefined)?.secret_enc;
    if (typeof herdado !== "string") return acao;
    return { ...acao, config: { ...config, secret_enc: herdado } };
  });
}

export async function lerRegraAutomatica(deps: DepsDaOperacao, id: string): Promise<RegraDetalhada> {
  const { data, error } = await deps.supabase
    .from("automation_rules")
    .select(COLUNAS)
    .eq("id", id)
    .eq("organization_id", deps.organizationId)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  if (!data) {
    throw new ApiError(404, "not_found", undefined, deps.requestId, "Essa regra não existe aqui.");
  }
  return detalhada(data as unknown as Record<string, unknown>);
}

export async function criarRegraAutomatica(
  deps: DepsDaOperacao,
  input: unknown,
  cifrar: CifradorDeAcoes = cifradorPadrao,
): Promise<RegraDetalhada> {
  const { is_active, ...resto } = ((input ?? {}) as { is_active?: unknown } & Record<string, unknown>);
  const parsed = createAutomationRuleSchema.safeParse(resto);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsed.error.flatten() as unknown as Record<string, unknown>,
      deps.requestId,
      "Confira o nome, o gatilho, as condições e as ações da regra.",
    );
  }
  const ativa = is_active === true;
  const safeActions = await cifrar(parsed.data.actions as RuleActionInput[]);
  if (safeActions === null) throw recusaDeCifra(deps);
  const { data: created, error } = await deps.supabase
    .from("automation_rules")
    .insert({
      organization_id: deps.organizationId,
      created_by_user_id: deps.actor.type === "user" ? deps.actor.id : null,
      name: parsed.data.name,
      trigger_event: parsed.data.trigger_event,
      conditions: parsed.data.conditions,
      actions: safeActions,
      is_active: ativa,
      ...autoriaDaMudanca(deps.actor),
    })
    .select(COLUNAS)
    .single();
  if (error || !created) {
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      deps.requestId,
      error?.message ?? "automation_rule_insert_failed",
    );
  }
  const linha = created as unknown as Record<string, unknown>;
  await audit({
    action: "automation.rule_created",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "automation_rule",
    resourceId: linha.id as string,
    requestId: deps.requestId,
    metadata: {
      name: parsed.data.name,
      trigger_event: parsed.data.trigger_event,
      is_active: ativa,
      conditions: parsed.data.conditions.length,
      actor_type: deps.actor.type,
    },
  });
  return detalhada(linha);
}

/**
 * O que não vier fica como está, inclusive as condições: o schema de alteração
 * não tem `default([])` de propósito (ver `lib/schemas/webhooks.ts`).
 */
export async function atualizarRegraAutomatica(
  deps: DepsDaOperacao,
  input: { id: string; patch: unknown },
  cifrar: CifradorDeAcoes = cifradorPadrao,
): Promise<RegraDetalhada> {
  const parsed = updateAutomationRuleSchema.safeParse(input.patch ?? {});
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsed.error.flatten() as unknown as Record<string, unknown>,
      deps.requestId,
      "Confira o que você quer alterar na regra.",
    );
  }
  const campos = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (campos.length === 0) {
    throw new ApiError(422, "unprocessable_entity", undefined, deps.requestId, "Nada para alterar.");
  }
  const atual = await regraCompletaDaOrg(deps, input.id);
  const patch: Record<string, unknown> = {
    ...Object.fromEntries(campos),
    updated_at: new Date().toISOString(),
    ...autoriaDaMudanca(deps.actor),
  };
  if (parsed.data.actions !== undefined) {
    const comAssinaturas = preservaAssinaturas(parsed.data.actions as RuleActionInput[], atual.actions);
    const safeActions = await cifrar(comAssinaturas);
    if (safeActions === null) throw recusaDeCifra(deps);
    patch.actions = safeActions;
  }
  const { data: updated, error } = await deps.supabase
    .from("automation_rules")
    .update(patch)
    .eq("id", input.id)
    .eq("organization_id", deps.organizationId)
    .select(COLUNAS)
    .single();
  if (error || !updated) {
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      deps.requestId,
      error?.message ?? "automation_rule_update_failed",
    );
  }
  const { actions: _acoesComSegredo, ...auditavel } = parsed.data;
  await audit({
    action: "automation.rule_updated",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "automation_rule",
    resourceId: input.id,
    requestId: deps.requestId,
    metadata: {
      ...auditavel,
      ...(parsed.data.actions !== undefined ? { actions_changed: true } : {}),
      actor_type: deps.actor.type,
    },
  });
  return detalhada(updated as unknown as Record<string, unknown>);
}
