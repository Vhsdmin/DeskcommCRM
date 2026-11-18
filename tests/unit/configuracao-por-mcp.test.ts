/**
 * Capacidades de CONFIGURAÇÃO operadas por pessoa pela MCP.
 *
 * Três coisas se provam aqui, contra os handlers REAIS com o client stub:
 *
 * 1. A TRAVA: toda capacidade de configuração exige `mcp:config`, papel acima do
 *    agente e está marcada `apenasHumano`. O token efêmero do agente, que nasce
 *    com `mcp:read`/`mcp:write`, é recusado pelo mesmo `ensureScope` do servidor.
 * 2. A REGRA: a organização sai do contexto, nunca do input; o que não vem no
 *    patch não é tocado (condições da regra, estoque do produto); segredo não
 *    sai na leitura nem entra no audit.
 * 3. O DEFEITO QUE MOTIVOU: `.partial()` no Zod 4 reaplica `.default()`; o
 *    schema de alteração de regra zerava as condições e o de produto zerava o
 *    estoque. Os dois testes abaixo ficam vermelhos se alguém voltar ao `.partial()`.
 */
import { describe, expect, it, vi } from "vitest";

// Escrita em `organizations` passa pelo cliente admin (gate do repositório); nos
// testes ele é o mesmo stub que o contexto usa, para as capturas caírem num lugar só.
const estado = vi.hoisted(() => ({ admin: {} as unknown }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.admin }));
vi.mock("@/lib/catalogo/moeda-da-org", () => ({ moedaDaOrganizacao: vi.fn().mockResolvedValue("BRL") }));

import { audit } from "@/lib/audit";
import { ROLE_RANK } from "@/lib/auth/types";
import { deriveActor, ensureScope } from "@/lib/mcp/auth";
import { redactArgs } from "@/lib/mcp/audit";
import { allTools } from "@/lib/mcp/tools";
import { catalogEntry, TOOL_CATALOG } from "@/lib/mcp/tools/catalog";
import { TOOLS_CONFIGURACAO } from "@/lib/mcp/tools/catalogo/configuracao";
import { ligarPacote } from "@/lib/mcp/tools/selecao-por-pacote";
import {
  crmCreateAutomationRule,
  crmCreatePipeline,
  crmCreateProduct,
  crmGetAutomationRule,
  crmListAudit,
  crmSetCanonicalTags,
  crmSetMemberRole,
  crmSetPipelineFields,
  crmUpdateAutomationRule,
  crmUpdateProduct,
  crmUpdateWebhookSource,
} from "@/lib/mcp/tools/configuracao";
import type { McpContext } from "@/lib/mcp/types";
import { criarRegraAutomatica, preservaAssinaturas } from "@/lib/operacao/regras-automaticas";
import { produtoCreateSchema, produtoPatchSchema } from "@/lib/schemas/produtos";
import { updateAutomationRuleSchema } from "@/lib/schemas/webhooks";

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const PIPE = "44444444-4444-4444-8444-444444444444";
const STAGE = "55555555-5555-4555-8555-555555555555";
const RULE = "66666666-6666-4666-8666-666666666666";
const SOURCE = "77777777-7777-4777-8777-777777777777";
const USER = "88888888-8888-4888-8888-888888888888";
const TOKEN = "99999999-9999-4999-8999-999999999999";

interface Consulta {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  values: unknown;
  filters: Array<[string, string, unknown]>;
  select: string | null;
  count: boolean;
  terminal: "maybeSingle" | "single" | "then";
}
type Resolver = (q: Consulta) => { data?: unknown; count?: number; error?: unknown };

interface Capturas {
  consultas: Consulta[];
  rpc: Array<{ fn: string; args: Record<string, unknown> }>;
  rpcResult?: { data: unknown; error: unknown };
}

/** Um client Supabase de mentira: registra a consulta e devolve o que o teste mandar. */
function makeSupabase(resolve: Resolver, cap: Capturas) {
  const from = (table: string) => {
    const q: Consulta = { table, op: "select", values: null, filters: [], select: null, count: false, terminal: "then" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    const filtro = (nome: string) => (col: string, v: unknown) => {
      q.filters.push([nome, col, v]);
      return chain;
    };
    Object.assign(chain, {
      select: (cols: string, opts?: { head?: boolean; count?: string }) => {
        q.select = cols;
        q.count = Boolean(opts?.head);
        return chain;
      },
      insert: (values: unknown) => {
        q.op = "insert";
        q.values = values;
        return chain;
      },
      update: (values: unknown) => {
        q.op = "update";
        q.values = values;
        return chain;
      },
      delete: () => {
        q.op = "delete";
        return chain;
      },
      eq: filtro("eq"),
      is: filtro("is"),
      in: filtro("in"),
      ilike: filtro("ilike"),
      gte: filtro("gte"),
      lte: filtro("lte"),
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => {
        q.terminal = "maybeSingle";
        cap.consultas.push(q);
        return Promise.resolve({ data: null, error: null, ...resolve(q) });
      },
      single: () => {
        q.terminal = "single";
        cap.consultas.push(q);
        return Promise.resolve({ data: null, error: null, ...resolve(q) });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        q.terminal = "then";
        cap.consultas.push(q);
        return Promise.resolve({ data: null, error: null, ...resolve(q) }).then(res, rej);
      },
    });
    return chain;
  };
  return {
    from,
    rpc: (fn: string, args: Record<string, unknown>) => {
      cap.rpc.push({ fn, args });
      return Promise.resolve(cap.rpcResult ?? { data: null, error: null });
    },
    auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
  };
}

function contexto(resolve: Resolver, cap: Capturas, role: "manager" | "admin" = "manager"): McpContext {
  const supabase = makeSupabase(resolve, cap);
  estado.admin = supabase;
  return {
    organizationId: ORG,
    role,
    actor: { type: "api_token", id: TOKEN, role },
    apiTokenId: TOKEN,
    requestId: "req-1",
    supabase: supabase as never,
  };
}

const capturas = (): Capturas => ({ consultas: [], rpc: [] });
const filtraOrg = (q: Consulta) => q.filters.some(([op, col, v]) => op === "eq" && col === "organization_id" && v === ORG);

describe("capacidades de configuração — a trava", () => {
  const nomes = TOOLS_CONFIGURACAO.map((t) => t.name);

  it("existem e estão registradas no servidor (guarda de vacuidade)", () => {
    expect(nomes.length).toBeGreaterThanOrEqual(18);
    for (const nome of nomes) expect(allTools.find((t) => t.name === nome), nome).toBeDefined();
  });

  it("todas exigem mcp:config, papel acima do agente e são operadas por pessoa", () => {
    for (const nome of nomes) {
      const def = allTools.find((t) => t.name === nome)!;
      expect(def.requiresScope, nome).toBe("mcp:config");
      expect(ROLE_RANK[def.requiresRole], nome).toBeGreaterThan(ROLE_RANK.ai_operator);
      expect(catalogEntry(nome)?.apenasHumano, nome).toBe(true);
    }
  });

  it("com gerente e administrador marcados no token, vale o papel mais alto", () => {
    const papel = (scopes: string[]) => (deriveActor(scopes, TOKEN) as { role?: string }).role;
    expect(papel(["mcp:config", "role:manager", "role:admin"])).toBe("admin");
    expect(papel(["role:admin", "role:manager"])).toBe("admin");
    expect(papel(["mcp:read"])).toBe("agent");
  });

  it("o token do agente (mcp:read + mcp:write) é recusado pelo mesmo gate do servidor", () => {
    expect(() => ensureScope(["mcp:read", "mcp:write", "actor:ai_agent", "role:ai_operator"], "mcp:config")).toThrow(
      /mcp:config/,
    );
    expect(() => ensureScope(["mcp:read", "mcp:config", "role:manager"], "mcp:config")).not.toThrow();
  });

  it("ligar o pacote 'organizar' para um agente não marca nenhuma capacidade de pessoa", () => {
    const ligadas = ligarPacote([], TOOL_CATALOG, "organizar");
    expect(ligadas.length).toBeGreaterThan(0);
    for (const nome of nomes) expect(ligadas, nome).not.toContain(nome);
    expect(ligadas).not.toContain("crm_create_stage");
  });

  it("quem muda papel ou dados da empresa precisa ser administrador", () => {
    expect(crmSetMemberRole.requiresRole).toBe("admin");
    expect(allTools.find((t) => t.name === "crm_update_org_settings")?.requiresRole).toBe("admin");
  });
});

describe("schemas de alteração não reaplicam default (o defeito do .partial())", () => {
  it("alterar regra só com is_active não traz conditions", () => {
    const r = updateAutomationRuleSchema.safeParse({ is_active: true });
    expect(r.success).toBe(true);
    if (r.success) {
      expect("conditions" in r.data).toBe(false);
      expect(r.data).toEqual({ is_active: true });
    }
  });

  it("alterar produto só com preço não traz estoque nem situação", () => {
    const r = produtoPatchSchema.safeParse({ preco_cents: 1990 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ preco_cents: 1990 });
    // O schema de criação continua com os defaults — é o de alteração que não os tem.
    const c = produtoCreateSchema.safeParse({ codigo: "SKU-1", nome: "Produto", preco_cents: 100 });
    expect(c.success && c.data.ativo).toBe(true);
  });
});

describe("audit da MCP — segredo não entra em texto", () => {
  it("redige secret em qualquer profundidade e mantém o resto", () => {
    const saida = redactArgs({
      name: "Entrada",
      secret: "minha-assinatura-secreta",
      actions: [{ type: "call_webhook", config: { url: "https://x.example", secret: "s3cr3t", secret_enc: "abc" } }],
    });
    expect(saida.name).toBe("Entrada");
    expect(saida.secret).toBe("[redacted]");
    const acao = (saida.actions as Array<{ config: Record<string, unknown> }>)[0]!;
    expect(acao.config.url).toBe("https://x.example");
    expect(acao.config.secret).toBe("[redacted]");
    expect(acao.config.secret_enc).toBe("[redacted]");
  });
});

describe("funis", () => {
  it("cria o funil COM as etapas iniciais, na organização do contexto, e vira padrão se for o primeiro", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "crm_pipelines" && q.op === "select") return { data: [] };
      if (q.table === "crm_pipelines" && q.op === "insert") return { data: { id: PIPE } };
      return { data: null };
    }, cap);
    const r = (await crmCreatePipeline.handler({ name: "Inscrições" }, ctx)) as { pipeline_id: string };
    expect(r.pipeline_id).toBe(PIPE);
    const insertFunil = cap.consultas.find((q) => q.table === "crm_pipelines" && q.op === "insert")!;
    expect((insertFunil.values as { organization_id: string; is_default: boolean }).organization_id).toBe(ORG);
    expect((insertFunil.values as { is_default: boolean }).is_default).toBe(true);
    const insertEtapas = cap.consultas.find((q) => q.table === "crm_stages" && q.op === "insert")!;
    const etapas = insertEtapas.values as Array<{ organization_id: string; pipeline_id: string }>;
    expect(etapas.length).toBeGreaterThanOrEqual(3);
    expect(etapas.every((e) => e.organization_id === ORG && e.pipeline_id === PIPE)).toBe(true);
    expect(vi.mocked(audit)).toHaveBeenCalledWith(expect.objectContaining({ action: "pipeline.created", actorApiTokenId: TOKEN }));
  });

  it("recusa nome que o usuário leria como duplicado", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "crm_pipelines" && q.op === "select") {
        return { data: [{ id: PIPE, name: "Inscrições", slug: "inscricoes", position: 1000, is_default: true, is_archived: false }] };
      }
      return { data: null };
    }, cap);
    await expect(crmCreatePipeline.handler({ name: "inscricoes" }, ctx)).rejects.toMatchObject({ status: 422 });
    expect(cap.consultas.some((q) => q.op === "insert")).toBe(false);
  });

  it("campos do funil: substitui a lista, preserva o resto das configurações e recusa chave repetida", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "crm_pipelines" && q.terminal === "maybeSingle") {
        return { data: { id: PIPE, name: "Inscrições", vocabulary: { lead: "Inscrito" }, settings: { lost_reasons: ["sem verba"], outra: 1 } } };
      }
      if (q.table === "crm_stages") return { data: [] };
      return { data: null };
    }, cap);
    const fields = [
      { key: "lista", label: "Lista", type: "select", options: [{ value: "vip", label: "VIP" }] },
      { key: "faturamento", label: "Faturamento", type: "text" },
    ];
    await crmSetPipelineFields.handler({ pipeline_id: PIPE, fields } as never, ctx);
    const update = cap.consultas.find((q) => q.table === "crm_pipelines" && q.op === "update")!;
    expect(filtraOrg(update)).toBe(true);
    const valores = update.values as { settings: Record<string, unknown>; vocabulary: Record<string, unknown> };
    expect(valores.settings.fields).toEqual(fields);
    expect(valores.settings.lost_reasons).toEqual(["sem verba"]);
    expect(valores.settings.outra).toBe(1);
    expect(valores.vocabulary).toEqual({ lead: "Inscrito" });

    await expect(
      crmSetPipelineFields.handler(
        { pipeline_id: PIPE, fields: [fields[0], { ...fields[1], key: "LISTA" }] } as never,
        contexto(() => ({ data: null }), capturas()),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("regras automáticas", () => {
  const cifrarSemSegredo = async (acoes: never[]) => acoes;

  it("cria com condições gravadas, pausada por padrão, sem tocar outra organização", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "automation_rules" && q.op === "insert") {
        return {
          data: {
            id: RULE,
            name: "VIP",
            is_active: false,
            trigger_event: "lead.created",
            conditions: (q.values as { conditions: unknown }).conditions,
            actions: (q.values as { actions: unknown }).actions,
            last_run_at: null,
            run_count: 0,
            last_change_actor_kind: "system",
            last_change_at: null,
          },
        };
      }
      return { data: null };
    }, cap);
    const r = await criarRegraAutomatica(
      { supabase: ctx.supabase, organizationId: ORG, actor: ctx.actor, requestId: "req-1" },
      {
        name: "VIP",
        trigger_event: "lead.created",
        conditions: [{ field: "lead.custom_fields.lista", op: "eq", value: "Lista VIP" }],
        actions: [{ type: "add_tag", config: { tags: ["lista-vip"] } }],
      },
      cifrarSemSegredo as never,
    );
    const insert = cap.consultas.find((q) => q.table === "automation_rules" && q.op === "insert")!;
    const valores = insert.values as { organization_id: string; is_active: boolean; conditions: unknown[] };
    expect(valores.organization_id).toBe(ORG);
    expect(valores.is_active).toBe(false);
    expect(valores.conditions).toHaveLength(1);
    expect(r.conditions).toHaveLength(1);
    expect(r.actions[0]!.has_secret).toBe(false);
  });

  it("recusa ação desconhecida sem gravar nada", async () => {
    const cap = capturas();
    const ctx = contexto(() => ({ data: null }), cap);
    await expect(
      crmCreateAutomationRule.handler(
        { name: "X", trigger_event: "lead.created", conditions: [], actions: [{ type: "apagar_tudo", config: {} }], is_active: false } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(cap.consultas.some((q) => q.op === "insert")).toBe(false);
  });

  it("alterar só o estado NÃO manda conditions para o banco", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "automation_rules" && q.terminal === "maybeSingle") return { data: { id: RULE, name: "VIP", is_active: false } };
      if (q.table === "automation_rules" && q.op === "update") {
        return { data: { id: RULE, name: "VIP", is_active: true, trigger_event: "lead.created", conditions: [{ field: "a", op: "eq", value: "b" }], actions: [], run_count: 0 } };
      }
      return { data: null };
    }, cap);
    const r = (await crmUpdateAutomationRule.handler({ rule_id: RULE, is_active: true } as never, ctx)) as { conditions: unknown[] };
    const update = cap.consultas.find((q) => q.table === "automation_rules" && q.op === "update")!;
    expect(Object.keys(update.values as object)).not.toContain("conditions");
    expect(Object.keys(update.values as object)).not.toContain("actions");
    expect(filtraOrg(update)).toBe(true);
    expect(r.conditions).toHaveLength(1);
  });

  it("reenviar as ações sem segredo preserva a assinatura do call_webhook já guardada", async () => {
    const cap = capturas();
    const antigas = [{ type: "call_webhook", config: { url: "https://x.example", secret_enc: "deadbeef" } }];
    const ctx = contexto((q) => {
      if (q.table === "automation_rules" && q.terminal === "maybeSingle") return { data: { id: RULE, name: "Hook", is_active: true, actions: antigas } };
      if (q.table === "automation_rules" && q.op === "update") {
        return { data: { id: RULE, name: "Hook", is_active: true, trigger_event: "lead.created", conditions: [], actions: (q.values as { actions: unknown }).actions, run_count: 0 } };
      }
      return { data: null };
    }, cap);
    const r = (await crmUpdateAutomationRule.handler(
      { rule_id: RULE, actions: [{ type: "call_webhook", config: { url: "https://x.example" } }] } as never,
      ctx,
    )) as { actions: Array<{ has_secret: boolean }> };
    const update = cap.consultas.find((q) => q.table === "automation_rules" && q.op === "update")!;
    const gravadas = (update.values as { actions: Array<{ config: Record<string, unknown> }> }).actions;
    expect(gravadas[0]!.config.secret_enc).toBe("deadbeef");
    expect(r.actions[0]!.has_secret).toBe(true);
    // URL diferente é outra ponta: não herda assinatura nenhuma.
    expect(preservaAssinaturas([{ type: "call_webhook", config: { url: "https://outra.example" } }] as never, antigas as never)[0]!.config).toEqual({ url: "https://outra.example" });
  });

  it("ler regra de outra organização responde 404 e a leitura nunca devolve segredo", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "automation_rules" && q.terminal === "maybeSingle") {
        const daOrg = q.filters.some(([, col, v]) => col === "organization_id" && v === ORG);
        return daOrg
          ? { data: { id: RULE, name: "Hook", is_active: true, trigger_event: "lead.created", conditions: [], actions: [{ type: "call_webhook", config: { url: "https://x.example", secret_enc: "deadbeef" } }], run_count: 0 } }
          : { data: null };
      }
      return { data: null };
    }, cap);
    const r = (await crmGetAutomationRule.handler({ rule_id: RULE }, ctx)) as { actions: Array<{ config: Record<string, unknown>; has_secret: boolean }> };
    expect(r.actions[0]!.has_secret).toBe(true);
    expect(r.actions[0]!.config).toEqual({ url: "https://x.example" });

    const outra = { ...ctx, organizationId: OUTRA_ORG };
    await expect(crmGetAutomationRule.handler({ rule_id: RULE }, outra)).rejects.toMatchObject({ status: 404 });
  });
});

describe("entradas automáticas de contatos", () => {
  it("recusa destino que não é da organização e, sem assinatura nova, não toca no segredo", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "webhook_sources" && q.terminal === "maybeSingle") {
        return { data: { id: SOURCE, name: "Formulários", default_pipeline_id: PIPE, default_stage_id: STAGE, secret_encrypted: "x", is_active: true } };
      }
      if (q.table === "crm_pipelines" && q.terminal === "maybeSingle") return { data: null }; // funil de outra org
      return { data: null };
    }, cap);
    await expect(
      crmUpdateWebhookSource.handler({ source_id: SOURCE, default_pipeline_id: OUTRA_ORG } as never, ctx),
    ).rejects.toMatchObject({ status: 422 });
    expect(cap.consultas.some((q) => q.table === "webhook_sources" && q.op === "update")).toBe(false);

    const cap2 = capturas();
    const ctx2 = contexto((q) => {
      if (q.table === "webhook_sources" && q.terminal === "maybeSingle") {
        return { data: { id: SOURCE, name: "Formulários", default_pipeline_id: PIPE, default_stage_id: STAGE } };
      }
      if (q.table === "webhook_sources" && q.op === "update") {
        return { data: { id: SOURCE, name: "Novo nome", secret_encrypted: "x", field_map: {} } };
      }
      return { data: null };
    }, cap2);
    const r = (await crmUpdateWebhookSource.handler({ source_id: SOURCE, name: "Novo nome" } as never, ctx2)) as Record<string, unknown>;
    const update = cap2.consultas.find((q) => q.table === "webhook_sources" && q.op === "update")!;
    expect(Object.keys(update.values as object)).not.toContain("secret_encrypted");
    expect(filtraOrg(update)).toBe(true);
    expect(r.has_secret).toBe(true);
    expect("secret_encrypted" in r).toBe(false);
  });
});

describe("dados da empresa", () => {
  it("marcadores sugeridos: normaliza, deduplica e substitui a lista na organização do contexto", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "organizations" && q.terminal === "maybeSingle") {
        return { data: { id: ORG, display_name: "Lab", timezone: "America/Sao_Paulo", locale: "pt-BR", currency: "BRL", settings: { agenda: {}, canonical_conversation_tags: ["antigo"] } } };
      }
      return { data: null };
    }, cap);
    const r = (await crmSetCanonicalTags.handler({ tags: ["VIP", "vip", " Fundador "] }, ctx)) as { canonical_conversation_tags: string[] };
    expect(r.canonical_conversation_tags).toEqual(["vip", "fundador"]);
    const update = cap.consultas.find((q) => q.table === "organizations" && q.op === "update")!;
    expect(update.filters).toContainEqual(["eq", "id", ORG]);
    expect((update.values as { settings: { canonical_conversation_tags: string[]; agenda: unknown } }).settings.canonical_conversation_tags).toEqual(["vip", "fundador"]);
    expect((update.values as { settings: { agenda: unknown } }).settings.agenda).toEqual({});
  });
});

describe("equipe", () => {
  it("não rebaixa o último admin e nunca grava em outra organização", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "user_organizations" && q.terminal === "maybeSingle") return { data: { id: "m1", user_id: USER, role: "admin", revoked_at: null } };
      if (q.table === "user_organizations" && q.count) return { count: 1 };
      return { data: null };
    }, cap, "admin");
    await expect(crmSetMemberRole.handler({ user_id: USER, role: "manager" }, ctx)).rejects.toMatchObject({ status: 409 });
    expect(cap.consultas.some((q) => q.op === "update")).toBe(false);
    expect(cap.consultas.filter((q) => q.table === "user_organizations").every(filtraOrg)).toBe(true);
  });
});

describe("produtos", () => {
  it("cria na moeda da organização e altera sem zerar o estoque", async () => {
    const cap = capturas();
    const ctx = contexto((q) => {
      if (q.table === "catalog_products" && q.op === "insert") return { data: { id: "p1", ...(q.values as object) } };
      if (q.table === "catalog_products" && q.op === "update") return { data: { id: "p1", ...(q.values as object) } };
      return { data: null };
    }, cap);
    await crmCreateProduct.handler({ codigo: "SKU-1", nome: "Curso", preco_cents: 19900 } as never, ctx);
    const insert = cap.consultas.find((q) => q.op === "insert")!;
    expect(insert.values).toMatchObject({ organization_id: ORG, moeda: "BRL", origem: "manual", ativo: true, quantidade: 0 });

    await crmUpdateProduct.handler({ product_id: "11111111-1111-4111-8111-111111111111", preco_cents: 24900 } as never, ctx);
    const update = cap.consultas.find((q) => q.op === "update")!;
    expect(update.values).toEqual({ preco_cents: 24900 });
    expect(filtraOrg(update)).toBe(true);
  });
});

describe("leituras de gestão", () => {
  it("auditoria filtra pela organização do contexto e respeita o limite", async () => {
    const cap = capturas();
    const linhas = Array.from({ length: 3 }, (_, i) => ({ id: `a${i}`, action: "mcp.tool_called", created_at: "2026-11-03T00:00:00Z" }));
    const ctx = contexto((q) => (q.table === "api_audit_log" ? { data: linhas } : { data: null }), cap);
    const r = (await crmListAudit.handler({ action: "mcp", limit: 2 } as never, ctx)) as { entries: unknown[]; has_more: boolean };
    expect(r.entries).toHaveLength(2);
    expect(r.has_more).toBe(true);
    const consulta = cap.consultas.find((q) => q.table === "api_audit_log")!;
    expect(filtraOrg(consulta)).toBe(true);
    expect(consulta.filters).toContainEqual(["ilike", "action", "%mcp%"]);
  });
});
