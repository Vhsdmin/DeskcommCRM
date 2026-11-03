/**
 * Capacidades de CONFIGURAR O CRM por fora da tela — funis e seus campos,
 * regras automáticas, entradas automáticas de contatos, dados da empresa,
 * agenda, equipe, produtos e leituras de gestão.
 *
 * ⚠️ OPERADAS POR PESSOA, NUNCA PELO AGENTE. Três travas, de propósito
 * redundantes: (1) `requiresScope: "mcp:config"`, que o token efêmero do agente
 * não carrega (`lib/ai/runtime/agent.ts`, `lib/agent-engine/edge/crm/mcp-tools.ts`);
 * (2) `requiresRole` de gestor ou administrador, acima de `ai_operator`;
 * (3) `apenasHumano: true` no catálogo, que faz a ponte do turno nem montar a
 * ferramenta (`lib/ai/runtime/tools.ts`). Quem chega aqui é quem emitiu um token
 * na tela Configurações › API Tokens marcando "configurar".
 *
 * ⚠️ TODA REGRA VIVE EM `lib/operacao/`, `lib/agenda/`, `lib/team/` e
 * `lib/catalogo/`. Aqui há tradução de argumento e nada mais. A organização
 * sai SEMPRE de `ctx.organizationId`: o client do contexto é service role.
 *
 * ⚠️ O QUE FICOU DE FORA, E POR QUÊ. Prazos da agenda e marca da organização
 * passam por um portão de MFA da sessão da pessoa (`fn_agenda_settings` exige
 * `auth.uid()` e `fn_session_mfa_proven()`); um token não tem sessão. Convidar
 * está desligado no produto e criar usuário recebe senha, que cairia no audit
 * da chamada. O painel de CS (`fn_cs_performance`) também exige `auth.uid()`.
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/types";
import { criarTipoDeAtendimento, camposDoTipo } from "@/lib/agenda/tipos-de-atendimento";
import { atualizarProduto, criarProduto } from "@/lib/catalogo/produtos-operacao";
import {
  atualizarEntradaAutomatica,
  type DepsDaOperacao,
} from "@/lib/operacao/entradas-automaticas";
import {
  atualizarFunil,
  configurarFunil,
  criarFunil,
  lerConfiguracaoDoFunil,
} from "@/lib/operacao/funis";
import {
  atividadesQuerySchema,
  auditoriaQuerySchema,
  desempenhoDaEquipe,
  desempenhoQuerySchema,
  listarAuditoria,
  relatorioDeAtividades,
} from "@/lib/operacao/leituras-de-gestao";
import {
  atualizarOrganizacao,
  definirMarcadoresCanonicos,
  lerConfiguracoesDaOrganizacao,
  organizacaoPatchSchema,
} from "@/lib/operacao/organizacao";
import {
  atualizarRegraAutomatica,
  criarRegraAutomatica,
  lerRegraAutomatica,
} from "@/lib/operacao/regras-automaticas";
import { produtoCreateSchema, produtoPatchSchema } from "@/lib/schemas/produtos";
import { customFieldSchema } from "@/lib/schemas/settings";
import { ROLES } from "@/lib/schemas/team";
import { actionSchema, conditionSchema, TRIGGER_EVENTS } from "@/lib/schemas/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { alterarPapelDoMembro } from "@/lib/team/papel-do-membro";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import type { McpContext, McpToolDefinition } from "../types";

/** O contexto MCP traduzido para o que as operações pedem. */
function deps(ctx: McpContext): DepsDaOperacao {
  return {
    supabase: ctx.supabase,
    organizationId: ctx.organizationId,
    actor: ctx.actor,
    requestId: ctx.requestId,
  };
}

const SO_PESSOA =
  " Capacidade operada por pessoa: exige token com escopo mcp:config e papel de gestor.";

// ---------------------------------------------------------------------------
// Funis
// ---------------------------------------------------------------------------

const createPipelineShape = {
  name: z.string().min(1).max(80),
  description: z.string().max(280).nullable().optional(),
};

export const crmCreatePipeline: McpToolDefinition<typeof createPipelineShape> = {
  name: "crm_create_pipeline",
  description:
    "Cria um funil novo com as etapas iniciais (Novo, Em contato, Qualificado, Ganho, Perdido). " +
    "Recusa nome que o usuário leria como duplicado. O primeiro funil ativo da organização nasce como padrão." +
    SO_PESSOA,
  inputSchema: createPipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => criarFunil(deps(ctx), input),
};

const updatePipelineShape = {
  pipeline_id: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).nullable().optional(),
  /** true torna este o funil padrão; false é recusado (o padrão se muda, não se apaga). */
  is_default: z.boolean().optional(),
};

export const crmUpdatePipeline: McpToolDefinition<typeof updatePipelineShape> = {
  name: "crm_update_pipeline",
  description:
    "Renomeia um funil, muda a descrição ou o torna o funil padrão da organização. Não reordena nem arquiva; " +
    "isso fica na tela. Informe só o que quer mudar." + SO_PESSOA,
  inputSchema: updatePipelineShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) =>
    atualizarFunil(deps(ctx), {
      pipelineId: input.pipeline_id,
      name: input.name,
      description: input.description,
      is_default: input.is_default,
    }),
};

const getPipelineConfigShape = { pipeline_id: z.string().uuid() };

export const crmGetPipelineConfig: McpToolDefinition<typeof getPipelineConfigShape> = {
  name: "crm_get_pipeline_config",
  description:
    "Devolve a configuração de um funil: etapas (com is_won/is_lost e ordem), campos personalizados dos negócios " +
    "(key, label, type, options), vocabulário e motivos de perda. Use antes e depois de configurar, para conferir." +
    SO_PESSOA,
  inputSchema: getPipelineConfigShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => lerConfiguracaoDoFunil(deps(ctx), input.pipeline_id),
};

const setPipelineFieldsShape = {
  pipeline_id: z.string().uuid(),
  /** Substitui a LISTA INTEIRA de campos (até 50). Omita para não mexer. */
  fields: z.array(customFieldSchema).max(50).optional(),
  vocabulary: z
    .object({
      lead: z.string().min(1).max(40).optional(),
      deal: z.string().min(1).max(40).optional(),
      won: z.string().min(1).max(40).optional(),
      lost: z.string().min(1).max(40).optional(),
    })
    .optional(),
  /** Substitui a lista inteira de motivos de perda (até 50). Omita para não mexer. */
  lost_reasons: z.array(z.string().min(1).max(80)).max(50).optional(),
};

export const crmSetPipelineFields: McpToolDefinition<typeof setPipelineFieldsShape> = {
  name: "crm_set_pipeline_fields",
  description:
    "Define os campos personalizados dos negócios de um funil (a lista inteira: key em snake_case, label, type entre " +
    "text/textarea/number/date/select/multiselect/boolean/email/phone/url, options para select), o vocabulário e os " +
    "motivos de perda. Cada lista enviada SUBSTITUI a anterior; lista omitida fica como está. Leia com " +
    "crm_get_pipeline_config antes, para não perder campos existentes." + SO_PESSOA,
  inputSchema: setPipelineFieldsShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) =>
    configurarFunil(deps(ctx), {
      pipelineId: input.pipeline_id,
      fields: input.fields,
      vocabulary: input.vocabulary,
      lost_reasons: input.lost_reasons,
    }),
};

// ---------------------------------------------------------------------------
// Regras automáticas
// ---------------------------------------------------------------------------

const getAutomationRuleShape = { rule_id: z.string().uuid() };

export const crmGetAutomationRule: McpToolDefinition<typeof getAutomationRuleShape> = {
  name: "crm_get_automation_rule",
  description:
    "Devolve uma regra automática por dentro: gatilho, condições (field/op/value) e ações com a configuração, " +
    "menos segredos (sai has_secret). Use para conferir as condições antes de ligar com crm_set_automation_rule_active." +
    SO_PESSOA,
  inputSchema: getAutomationRuleShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => lerRegraAutomatica(deps(ctx), input.rule_id),
};

const createAutomationRuleShape = {
  name: z.string().min(1).max(120),
  trigger_event: z.enum(TRIGGER_EVENTS),
  /** Até 10 condições; todas precisam valer. Campo no formato lead.custom_fields.<chave>, lead.<coluna>, contact.<coluna>. */
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(10),
  /** Nasce pausada por padrão; true já liga. */
  is_active: z.boolean().default(false),
};

export const crmCreateAutomationRule: McpToolDefinition<typeof createAutomationRuleShape> = {
  name: "crm_create_automation_rule",
  description:
    "Cria uma regra automática com gatilho, condições e ações, gravando tudo numa chamada só. Ações: add_tag, " +
    "create_or_move_lead (pipeline_id e stage_id da MESMA organização), assign_owner, send_whatsapp_message, " +
    "send_ai_message, call_webhook (secret em texto é cifrado no servidor), start_message_flow. is_active=true liga " +
    "na hora; confira com crm_get_automation_rule." + SO_PESSOA,
  inputSchema: createAutomationRuleShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => criarRegraAutomatica(deps(ctx), input),
};

const updateAutomationRuleShape = {
  rule_id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  trigger_event: z.enum(TRIGGER_EVENTS).optional(),
  /** Substitui as condições. Omita para manter as atuais. */
  conditions: z.array(conditionSchema).max(10).optional(),
  /** Substitui as ações. Omita para manter as atuais. */
  actions: z.array(actionSchema).min(1).max(10).optional(),
  is_active: z.boolean().optional(),
};

export const crmUpdateAutomationRule: McpToolDefinition<typeof updateAutomationRuleShape> = {
  name: "crm_update_automation_rule",
  description:
    "Altera nome, gatilho, condições, ações ou estado de uma regra automática. Campo omitido fica como está, " +
    "inclusive as condições. Ao reenviar ações de call_webhook sem secret, a assinatura já guardada para a mesma URL " +
    "é preservada. Para só ligar ou desligar, crm_set_automation_rule_active basta." + SO_PESSOA,
  inputSchema: updateAutomationRuleShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => {
    const { rule_id, ...patch } = input;
    return atualizarRegraAutomatica(deps(ctx), { id: rule_id, patch });
  },
};

// ---------------------------------------------------------------------------
// Entradas automáticas de contatos
// ---------------------------------------------------------------------------

const updateWebhookSourceShape = {
  source_id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  default_pipeline_id: z.string().uuid().optional(),
  default_stage_id: z.string().uuid().optional(),
  redirect_to: z.string().url().max(2000).nullable().optional(),
  field_map: z
    .object({
      name: z.array(z.string()).optional(),
      phone: z.array(z.string()).optional(),
      email: z.array(z.string()).optional(),
    })
    .optional(),
  /** Nova assinatura (16 a 200 caracteres), cifrada no servidor; null remove a assinatura; omita para manter. */
  secret: z.string().min(16).max(200).nullable().optional(),
  is_active: z.boolean().optional(),
};

export const crmUpdateWebhookSource: McpToolDefinition<typeof updateWebhookSourceShape> = {
  name: "crm_update_webhook_source",
  description:
    "Altera uma entrada automática de contatos: nome, funil e etapa de destino (validados na organização), " +
    "redirecionamento, mapeamento de campos (name/phone/email), assinatura e estado. Campo omitido fica como está. " +
    "A assinatura nunca é devolvida; a resposta traz has_secret." + SO_PESSOA,
  inputSchema: updateWebhookSourceShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => {
    const { source_id, secret, field_map, ...resto } = input;
    let secretEncrypted: string | null | undefined;
    if (secret === null) secretEncrypted = null;
    else if (typeof secret === "string") {
      const enc = await encryptWebhookSecret(createAdminClient(), secret);
      if (enc === null) {
        throw new ApiError(
          422,
          "encryption_unavailable",
          undefined,
          ctx.requestId,
          "Não foi possível guardar a assinatura com segurança: a chave de cifra desta instalação não está ativa. Quem administra o servidor resolve rodando o update.sh.",
        );
      }
      secretEncrypted = enc;
    }
    return atualizarEntradaAutomatica(deps(ctx), {
      id: source_id,
      ...resto,
      field_map: field_map as Record<string, string[]> | undefined,
      secret_encrypted: secretEncrypted,
    });
  },
};

// ---------------------------------------------------------------------------
// Dados da empresa
// ---------------------------------------------------------------------------

const vazio = {};

export const crmGetOrgSettings: McpToolDefinition<typeof vazio> = {
  name: "crm_get_org_settings",
  description:
    "Devolve os dados da empresa: nome, razão social, CNPJ, fuso, idioma, moeda, retenção de mídia em dias, e-mail do " +
    "encarregado de dados, política de privacidade, motivos de perda extras, marcadores sugeridos e prazos da agenda." +
    SO_PESSOA,
  inputSchema: vazio,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (_input, ctx) => lerConfiguracoesDaOrganizacao(deps(ctx)),
};

const updateOrgSettingsShape = organizacaoPatchSchema.shape;

export const crmUpdateOrgSettings: McpToolDefinition<typeof updateOrgSettingsShape> = {
  name: "crm_update_org_settings",
  description:
    "Altera os dados da empresa: display_name, legal_name, cnpj, timezone, locale, currency, media_retention_days " +
    "(30 a 3650), dpo_email, privacy_policy_url e lost_reasons_extra. Só o que for informado muda. Marca visual e " +
    "prazos da agenda não passam por aqui: exigem a sessão de uma pessoa com segundo fator." + SO_PESSOA,
  inputSchema: updateOrgSettingsShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => atualizarOrganizacao(deps(ctx), input),
};

const setCanonicalTagsShape = {
  /** A lista inteira (até 50, cada um até 40 caracteres); substitui a anterior. */
  tags: z.array(z.string().min(1).max(40)).max(50),
};

export const crmSetCanonicalTags: McpToolDefinition<typeof setCanonicalTagsShape> = {
  name: "crm_set_canonical_tags",
  description:
    "Define a lista de marcadores sugeridos nas conversas (organizations.settings.canonical_conversation_tags). " +
    "Normaliza para minúsculas, remove duplicatas e SUBSTITUI a lista anterior inteira. Leia a atual com " +
    "crm_get_org_settings antes." + SO_PESSOA,
  inputSchema: setCanonicalTagsShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => definirMarcadoresCanonicos(deps(ctx), input.tags),
};

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export const crmCreateEventType: McpToolDefinition<typeof camposDoTipo> = {
  name: "crm_create_event_type",
  description:
    "Cria um tipo de atendimento na agenda (name, category, duration_minutes, location_kind e opcionais como " +
    "buffers, antecedência mínima, janela de agendamento e lembretes). O slug sai do nome e é estável. Nome repetido " +
    "é recusado." + SO_PESSOA,
  inputSchema: camposDoTipo,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => criarTipoDeAtendimento(deps(ctx), input),
};

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------

const setMemberRoleShape = {
  user_id: z.string().uuid(),
  role: z.enum(ROLES),
};

export const crmSetMemberRole: McpToolDefinition<typeof setMemberRoleShape> = {
  name: "crm_set_member_role",
  description:
    "Muda o papel de um membro da equipe (viewer, agent, manager, admin). Recusa membro revogado e nunca rebaixa o " +
    "último admin; quem deixa de ser admin perde os acessos por módulo. Liste os membros com crm_list_team_members." +
    " Exige token com papel de administrador.",
  inputSchema: setMemberRoleShape,
  category: "write",
  requiresRole: "admin",
  requiresScope: "mcp:config",
  handler: async (input, ctx) =>
    alterarPapelDoMembro(deps(ctx), { userId: input.user_id, role: input.role }),
};

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

const createProductShape = produtoCreateSchema.shape;

export const crmCreateProduct: McpToolDefinition<typeof createProductShape> = {
  name: "crm_create_product",
  description:
    "Cadastra um produto no catálogo (codigo, nome, preco_cents em centavos, opcionais descricao, marca, categoria, " +
    "custo_cents, controla_estoque, quantidade, ativo, imagem_url). A moeda é a da organização. Código repetido é " +
    "recusado." + SO_PESSOA,
  inputSchema: createProductShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => criarProduto(deps(ctx), input),
};

const updateProductShape = { product_id: z.string().uuid(), ...produtoPatchSchema.shape };

export const crmUpdateProduct: McpToolDefinition<typeof updateProductShape> = {
  name: "crm_update_product",
  description:
    "Altera um produto do catálogo pelo product_id. Só o que for informado muda (preço, estoque, situação, " +
    "descrição, código). Código repetido é recusado." + SO_PESSOA,
  inputSchema: updateProductShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => {
    const { product_id, ...patch } = input;
    return atualizarProduto(deps(ctx), { id: product_id, patch });
  },
};

// ---------------------------------------------------------------------------
// Leituras de gestão
// ---------------------------------------------------------------------------

const getPerformanceShape = desempenhoQuerySchema.shape;

export const crmGetPerformance: McpToolDefinition<typeof getPerformanceShape> = {
  name: "crm_get_performance",
  description:
    "Desempenho da equipe num período (padrão: últimos 30 dias): funil por etapa e, por atendente, negócios ganhos e " +
    "perdidos, conversas atendidas e tempo médio da primeira resposta. from/to em ISO-8601 com fuso; owner_user_id " +
    "filtra uma pessoa." + SO_PESSOA,
  inputSchema: getPerformanceShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => desempenhoDaEquipe(deps(ctx), input),
};

const listActivitiesShape = atividadesQuerySchema.shape;

export const crmListActivities: McpToolDefinition<typeof listActivitiesShape> = {
  name: "crm_list_activities",
  description:
    "Relatório de atividades dos últimos N dias (1 a 90, padrão 7) no fuso informado: total, por quem fez (pessoas, " +
    "agentes, automático), por tipo, por dia e os últimos itens." + SO_PESSOA,
  inputSchema: listActivitiesShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => relatorioDeAtividades(deps(ctx), input),
};

const listAuditShape = auditoriaQuerySchema.shape;

export const crmListAudit: McpToolDefinition<typeof listAuditShape> = {
  name: "crm_list_audit",
  description:
    "Lista o registro de auditoria da organização, do mais recente ao mais antigo, com filtros por action " +
    "(trecho), resource_type, actor_user_id e período, até 100 por chamada." + SO_PESSOA,
  inputSchema: listAuditShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:config",
  handler: async (input, ctx) => listarAuditoria(deps(ctx), input),
};
