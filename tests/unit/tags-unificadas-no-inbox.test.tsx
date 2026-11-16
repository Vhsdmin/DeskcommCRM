import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextRequest } from "next/server";

import { filtrarSugestoes } from "@/components/inbox/SugestoesDeTags";

/**
 * A ETIQUETA CRIADA EM QUALQUER LUGAR APARECE NOS EDITORES DO INBOX.
 *
 * Os editores de etiqueta da conversa e do contato só conheciam as etiquetas de
 * conversa (o do contato, nenhuma). `GET /api/v1/conversation-tags?todas=1` soma
 * as que estão em uso em clientes e leads; sem o parâmetro, a rota segue igual,
 * porque é ela que alimenta o FILTRO da lista de conversas.
 */

// ─── a rota ────────────────────────────────────────────────────────────────

const linhasPorTabela: Record<string, Array<{ tags: string[] | null }>> = {};
const tabelasLidas: string[] = [];

function consulta(tabela: string) {
  const resultado = { data: linhasPorTabela[tabela] ?? [], error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "order"]) chain[m] = () => chain;
  chain.range = () => {
    tabelasLidas.push(tabela);
    return Promise.resolve(resultado);
  };
  chain.maybeSingle = () =>
    Promise.resolve({ data: { settings: { canonical_conversation_tags: ["urgente"] } }, error: null });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => consulta(tabela),
    rpc: async () => ({ data: [{ tag: "suporte" }], error: null }),
  }),
}));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, org: { orgId: "org-1", role: "agent" } }),
}));

async function chamarRota(url: string): Promise<string[]> {
  const { GET } = await import("@/app/api/v1/conversation-tags/route");
  const res = await GET(new NextRequest(url));
  const corpo = (await res.json()) as { data: string[] };
  return corpo.data;
}

beforeEach(() => {
  tabelasLidas.length = 0;
  linhasPorTabela.contacts = [{ tags: ["vip", "seller-novo"] }, { tags: ["vip"] }];
  linhasPorTabela.crm_leads = [{ tags: ["indicacao"] }, { tags: null }];
});

describe("GET /api/v1/conversation-tags", () => {
  it("com ?todas=1 soma as etiquetas de clientes e leads, sem repetir", async () => {
    const tags = await chamarRota("http://x/api/v1/conversation-tags?todas=1");
    expect(tags).toEqual(["indicacao", "seller-novo", "suporte", "urgente", "vip"]);
  });

  it("sem o parâmetro, segue só com as de conversa (é o vocabulário do filtro)", async () => {
    const tags = await chamarRota("http://x/api/v1/conversation-tags");
    expect(tags).toEqual(["suporte", "urgente"]);
    expect(tabelasLidas).toEqual([]);
  });
});

// ─── as sugestões ──────────────────────────────────────────────────────────

describe("filtrarSugestoes", () => {
  const vocabulario = ["indicacao", "seller-novo", "suporte", "urgente", "VIP"];

  it("tira as que a pessoa já tem, sem diferenciar maiúsculas", () => {
    expect(filtrarSugestoes(vocabulario, ["vip", "suporte"], "")).toEqual([
      "indicacao",
      "seller-novo",
      "urgente",
    ]);
  });

  it("filtra pelo que está sendo digitado", () => {
    expect(filtrarSugestoes(vocabulario, [], "se")).toEqual(["seller-novo"]);
    expect(filtrarSugestoes(vocabulario, [], "ur")).toEqual(["urgente"]);
  });

  it("oferece no máximo oito", () => {
    const muitas = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    expect(filtrarSugestoes(muitas, [], "")).toHaveLength(8);
  });
});

// ─── o editor do contato ───────────────────────────────────────────────────

const mutate = vi.fn();
vi.mock("@/hooks/contacts/useUpdateContact", () => ({
  useUpdateContact: () => ({ mutate, isPending: false }),
}));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  CHAVE_DE_TODAS_AS_TAGS: "tag-vocabulary-todas",
  useTodasAsTags: () => ({ data: ["seller-novo", "vip"] }),
}));

describe("ContactTagsEditor", () => {
  it("oferece as etiquetas que já existem e aplica a escolhida", async () => {
    const { ContactTagsEditor } = await import("@/components/inbox/ContactTagsEditor");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ContactTagsEditor contactId="c-1" orgId="org-1" tags={["vip"]} />
      </QueryClientProvider>,
    );

    const sugestoes = screen.getByTestId("sugestoes-de-tags");
    expect(sugestoes.textContent).toContain("seller-novo");
    expect(sugestoes.textContent).not.toContain("vip");

    fireEvent.click(screen.getByRole("button", { name: "+ seller-novo" }));
    expect(mutate).toHaveBeenCalledWith({ tags: ["vip", "seller-novo"] }, expect.any(Object));
  });
});
