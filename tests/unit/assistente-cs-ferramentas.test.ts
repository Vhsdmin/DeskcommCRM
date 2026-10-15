import { describe, expect, it, vi } from "vitest";

import { ferramentasDoAssistente, type FonteCitada } from "@/lib/assistente-cs/ferramentas";

vi.mock("@/lib/ai/knowledge/busca", () => ({
  buscarConhecimento: vi.fn(async () => ({
    trechos: [{ chunk_id: "c1", knowledge_source_id: "k1", source_name: "Manual do Produto", content: "Prazo D+30", similarity: 0.8 }],
    melhorSimilaridade: 0.8,
  })),
}));

const ORG = "00000000-0000-4000-8000-0000000000aa";
const CLIENTE = "00000000-0000-4000-8000-0000000000c1";

/** Client falso que registra cada filtro aplicado e devolve o dado da tabela. */
function supabaseFalso(dados: Record<string, unknown>) {
  const filtros: Array<[string, string, unknown]> = [];
  const escritas: string[] = [];
  const from = (tabela: string) => {
    const q: Record<string, unknown> = {};
    const cadeia = () => q;
    for (const m of ["select", "order", "limit", "or", "in", "is"]) q[m] = cadeia;
    q.eq = (col: string, v: unknown) => {
      filtros.push([tabela, col, v]);
      return q;
    };
    for (const m of ["insert", "update", "delete", "upsert"]) q[m] = () => {
      escritas.push(tabela);
      return q;
    };
    q.maybeSingle = async () => ({ data: dados[tabela] ?? null, error: null });
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: Array.isArray(dados[tabela]) ? dados[tabela] : [], error: null });
    return q;
  };
  return { client: { from } as never, filtros, escritas };
}

const opcoes = { toolCallId: "t", messages: [] } as never;

describe("ferramentas do assistente dos CSMs", () => {
  it("sem documentos marcados, a busca nos documentos nem entra na conversa", () => {
    const { client } = supabaseFalso({});
    const f = ferramentasDoAssistente({ supabase: client, organizationId: ORG, knowledgeSourceIds: [], fontes: [] });
    expect(Object.keys(f).sort()).toEqual(["buscar_clientes", "detalhe_do_cliente"]);
  });

  it("com documentos, busca e cita o documento como fonte", async () => {
    const { client } = supabaseFalso({});
    const fontes: FonteCitada[] = [];
    const f = ferramentasDoAssistente({ supabase: client, organizationId: ORG, knowledgeSourceIds: ["k1"], fontes });
    const r = (await f.buscar_documentos!.execute!({ pergunta: "prazo de liberação" }, opcoes)) as {
      trechos: unknown[];
    };
    expect(r.trechos).toHaveLength(1);
    expect(fontes).toEqual([{ tipo: "documento", nome: "Manual do Produto" }]);
  });

  it("detalhe do cliente filtra a organização em TODAS as consultas e não escreve nada", async () => {
    const { client, filtros, escritas } = supabaseFalso({
      contacts: { id: CLIENTE, name: "Loja X" },
      crm_lead_activities: [{ type: "customer_qbr", performed_at: "2026-10-01", payload: { summary: "QBR ok" } }],
      crm_tasks: [],
      customer_nps_surveys: [],
    });
    const fontes: FonteCitada[] = [];
    const f = ferramentasDoAssistente({ supabase: client, organizationId: ORG, knowledgeSourceIds: [], fontes });
    const r = (await f.detalhe_do_cliente!.execute!({ cliente_id: CLIENTE }, opcoes)) as {
      atividades: Array<{ resumo: string | null }>;
    };
    expect(r.atividades[0]?.resumo).toBe("QBR ok");
    for (const tabela of ["contacts", "crm_lead_activities", "crm_tasks", "customer_nps_surveys"]) {
      expect(filtros).toContainEqual([tabela, "organization_id", ORG]);
    }
    expect(escritas).toEqual([]);
    expect(fontes).toEqual([{ tipo: "cliente", id: CLIENTE, nome: "Loja X" }]);
  });

  it("cliente fora do alcance da sessão vira mensagem, não erro", async () => {
    const { client } = supabaseFalso({});
    const f = ferramentasDoAssistente({ supabase: client, organizationId: ORG, knowledgeSourceIds: [], fontes: [] });
    const r = await f.detalhe_do_cliente!.execute!({ cliente_id: CLIENTE }, opcoes);
    expect(r).toEqual({ erro: "Cliente não encontrado ou sem permissão." });
  });
});
