/**
 * Os DADOS DA EMPRESA — o que a tela Configurações › Organização grava em
 * `organizations` e em `organizations.settings` (motivos de perda extras,
 * marcadores sugeridos de conversa).
 *
 * ⚠️ MESMA REGRA DA ACTION. `app/actions/settings/updateTenant.ts` valida com
 * `tenantSchema` e grava as mesmas colunas; aqui a validação é a mesma, campo a
 * campo, mas PARCIAL e sem defaults: o que não vier não muda. Um `.partial()`
 * sobre o schema da tela reaplicaria o `default([])` dos motivos extras e
 * apagaria a lista de quem só quis trocar o fuso.
 *
 * ⚠️ O QUE DELIBERADAMENTE NÃO ESTÁ AQUI: a marca da organização e os prazos da
 * agenda. As duas passam por um portão de MFA da sessão da pessoa
 * (`mfaEmDivida()` na action; `fn_session_mfa_proven()` dentro de
 * `fn_agenda_settings`). Um token de API não tem sessão para provar, e gravar
 * por fora do portão seria desfazer uma decisão de segurança por conveniência.
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { atorParaAuditoria } from "@/lib/operacao/autoria";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";
import { conversationTagSchema } from "@/lib/schemas/messaging";
import { agendaSettingsSchema, tenantSchema } from "@/lib/schemas/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * ⚠️ ESCRITA EM `organizations` É SEMPRE POR UMA VARIÁVEL VINDA DE
 * `createAdminClient()`. A RLS da tabela só deixa escrever platform admin; com
 * cliente de sessão o update casa zero linhas e o PostgREST devolve sucesso
 * (gate em `tests/unit/escrita-em-organizations-usa-cliente-admin.test.ts`, que
 * reconhece o padrão `const admin = createAdminClient()` pelo nome da variável).
 * Pela MCP o `deps.supabase` já é o admin, mas a regra é do arquivo, não do
 * chamador; o filtro `.eq("id", deps.organizationId)` é o que separa os tenants.
 */

const COLUNAS =
  "id, display_name, legal_name, cnpj, timezone, locale, currency, media_retention_days, " +
  "dpo_email, privacy_policy_url, settings";

export interface ConfiguracoesDaOrganizacao {
  organization_id: string;
  display_name: string;
  legal_name: string | null;
  cnpj: string | null;
  timezone: string;
  locale: string;
  currency: string;
  media_retention_days: number;
  dpo_email: string | null;
  privacy_policy_url: string | null;
  lost_reasons_extra: string[];
  canonical_conversation_tags: string[];
  agenda: z.infer<typeof agendaSettingsSchema>;
}

/** Os campos da tela, cada um opcional, SEM default. */
export const organizacaoPatchSchema = z
  .object({
    display_name: tenantSchema.shape.display_name.optional(),
    legal_name: tenantSchema.shape.legal_name.optional(),
    cnpj: tenantSchema.shape.cnpj,
    timezone: tenantSchema.shape.timezone.optional(),
    locale: tenantSchema.shape.locale.optional(),
    currency: tenantSchema.shape.currency.optional(),
    media_retention_days: tenantSchema.shape.media_retention_days.optional(),
    dpo_email: tenantSchema.shape.dpo_email,
    privacy_policy_url: tenantSchema.shape.privacy_policy_url,
    lost_reasons_extra: z.array(z.string().min(1).max(80)).max(50).optional(),
  })
  .strict();
export type OrganizacaoPatch = z.infer<typeof organizacaoPatchSchema>;

/** Igual a `canonicalConversationTagsSchema`, mas SEM o `.catch([])`: quem configura precisa do erro. */
export const marcadoresCanonicosSchema = z
  .array(conversationTagSchema)
  .max(50)
  .transform((tags) => Array.from(new Set(tags)));

function erroInterno(deps: DepsDaOperacao, mensagem: string): ApiError {
  return new ApiError(500, "internal_error", undefined, deps.requestId, mensagem);
}

function montar(row: Record<string, unknown>): ConfiguracoesDaOrganizacao {
  const settings = (row.settings as Record<string, unknown> | null) ?? {};
  const extras = Array.isArray(settings.lost_reasons_extra)
    ? (settings.lost_reasons_extra as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  const canonicos = marcadoresCanonicosSchema.safeParse(settings.canonical_conversation_tags ?? []);
  return {
    organization_id: row.id as string,
    display_name: row.display_name as string,
    legal_name: (row.legal_name as string | null) ?? null,
    cnpj: (row.cnpj as string | null) ?? null,
    timezone: row.timezone as string,
    locale: row.locale as string,
    currency: row.currency as string,
    media_retention_days: Number(row.media_retention_days ?? 0),
    dpo_email: (row.dpo_email as string | null) ?? null,
    privacy_policy_url: (row.privacy_policy_url as string | null) ?? null,
    lost_reasons_extra: extras,
    canonical_conversation_tags: canonicos.success ? canonicos.data : [],
    agenda: agendaSettingsSchema.parse(settings.agenda),
  };
}

async function linhaDaOrg(deps: DepsDaOperacao): Promise<Record<string, unknown>> {
  const { data, error } = await deps.supabase
    .from("organizations")
    .select(COLUNAS)
    .eq("id", deps.organizationId)
    .maybeSingle();
  if (error) throw erroInterno(deps, error.message);
  if (!data) {
    throw new ApiError(404, "not_found", undefined, deps.requestId, "Organização não encontrada.");
  }
  return data as unknown as Record<string, unknown>;
}

export async function lerConfiguracoesDaOrganizacao(
  deps: DepsDaOperacao,
): Promise<ConfiguracoesDaOrganizacao> {
  return montar(await linhaDaOrg(deps));
}

export async function atualizarOrganizacao(
  deps: DepsDaOperacao,
  input: unknown,
): Promise<ConfiguracoesDaOrganizacao> {
  const parsed = organizacaoPatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsed.error.flatten() as unknown as Record<string, unknown>,
      deps.requestId,
      "Confira os dados da empresa.",
    );
  }
  const campos = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  if (campos.length === 0) {
    throw new ApiError(422, "unprocessable_entity", undefined, deps.requestId, "Nada para alterar.");
  }
  const atual = await linhaDaOrg(deps);
  const colunas: Record<string, unknown> = {};
  for (const [chave, valor] of campos) {
    if (chave === "lost_reasons_extra") continue;
    colunas[chave] = valor;
  }
  if (parsed.data.lost_reasons_extra !== undefined) {
    colunas.settings = {
      ...((atual.settings as Record<string, unknown> | null) ?? {}),
      lost_reasons_extra: parsed.data.lost_reasons_extra,
    };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update(colunas)
    .eq("id", deps.organizationId);
  if (error) throw erroInterno(deps, error.message);
  await audit({
    action: "org.updated",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "organization",
    resourceId: deps.organizationId,
    requestId: deps.requestId,
    metadata: { fields_changed: campos.map(([k]) => k), actor_type: deps.actor.type },
  });
  return montar(await linhaDaOrg(deps));
}

/**
 * Os marcadores sugeridos de conversa (`settings.canonical_conversation_tags`).
 * Não há tela para isto hoje; a lista inteira é substituída pela que vier.
 */
export async function definirMarcadoresCanonicos(
  deps: DepsDaOperacao,
  input: unknown,
): Promise<{ canonical_conversation_tags: string[] }> {
  const parsed = marcadoresCanonicosSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsed.error.flatten() as unknown as Record<string, unknown>,
      deps.requestId,
      "Cada marcador tem de 1 a 40 caracteres, e a lista vai até 50.",
    );
  }
  const atual = await linhaDaOrg(deps);
  const settings = {
    ...((atual.settings as Record<string, unknown> | null) ?? {}),
    canonical_conversation_tags: parsed.data,
  };
  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ settings })
    .eq("id", deps.organizationId);
  if (error) throw erroInterno(deps, error.message);
  // `org.updated` é a ação que a tela de organização já grava; o campo tocado
  // vai em `fields_changed`, como lá. Ação nova no audit exige entrar no enum.
  await audit({
    action: "org.updated",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "organization",
    resourceId: deps.organizationId,
    requestId: deps.requestId,
    metadata: {
      fields_changed: ["canonical_conversation_tags"],
      count: parsed.data.length,
      actor_type: deps.actor.type,
    },
  });
  return { canonical_conversation_tags: parsed.data };
}
