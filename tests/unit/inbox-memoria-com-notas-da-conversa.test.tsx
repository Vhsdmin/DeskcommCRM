import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CRMSidePanel } from "@/components/inbox/CRMSidePanel";

/**
 * A MEMÓRIA DO CONTATO MOSTRA AS NOTAS INTERNAS DA CONVERSA.
 *
 * Ela lia só `lead_notes`; a nota escrita no compositor da conversa vai para
 * `conversation_notes` e nunca aparecia ali. A rota `crm-summary` agora devolve
 * as duas, e o painel recarrega quando a thread ganha nota nova.
 */

const CONTACT = "c0000000-0000-4000-8000-000000000001";

const conversation = {
  id: "cv-1",
  organization_id: "org-1",
  contact_id: CONTACT,
  tags: [],
  contacts: { id: CONTACT, display_name: "Fulana", name: null, phone_number: "5511999", tags: [] },
} as unknown as React.ComponentProps<typeof CRMSidePanel>["conversation"];

const RESPOSTA = {
  leads: [],
  orders: [],
  activities: [],
  demandas: [],
  fatos: [],
  historico: [],
  notas_da_conversa: [
    {
      id: "n-1",
      body: "Prefere ser chamada à tarde",
      created_at: "2026-11-10T15:00:00Z",
      created_by_name: "Náthali",
      conversation_id: "cv-1",
    },
    {
      id: "n-2",
      body: "Reclamou da taxa no mês passado",
      created_at: "2026-10-02T15:00:00Z",
      created_by_name: null,
      conversation_id: "cv-antiga",
    },
  ],
};

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));
vi.mock("@/hooks/pipelines/useDefaultPipeline", () => ({
  useDefaultPipeline: () => ({ data: null, isError: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useUpdateConversationTags: () => ({ mutate: vi.fn(), isPending: false }),
  useConversationTagVocabulary: () => ({ data: [] }),
  useTodasAsTags: () => ({ data: [] }),
  CHAVE_DE_TODAS_AS_TAGS: "tag-vocabulary-todas",
}));
vi.mock("@/hooks/contacts/useUpdateContact", () => ({
  useUpdateContact: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => ({ user: { support: null } }) }));

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: RESPOSTA });
});

function renderPainel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CRMSidePanel conversation={conversation} />
    </QueryClientProvider>,
  );
  return client;
}

describe("Memória do contato — notas internas das conversas", () => {
  it("mostra as notas de todas as conversas do contato, com autor e origem", async () => {
    renderPainel();

    const bloco = await screen.findByTestId("inbox-memoria-notas");
    expect(within(bloco).getByText("Prefere ser chamada à tarde")).toBeTruthy();
    expect(within(bloco).getByText("Reclamou da taxa no mês passado")).toBeTruthy();
    expect(within(bloco).getByText(/Náthali · .* · nesta conversa/)).toBeTruthy();
    // Nota de outra conversa não leva o selo, e autor ausente não vira vazio.
    expect(within(bloco).getByText(/^Alguém · /)).toBeTruthy();
  });

  it("sem notas na conversa, o bloco não aparece", async () => {
    get.mockResolvedValue({ data: { ...RESPOSTA, notas_da_conversa: [] } });
    renderPainel();

    await screen.findByText("Nenhum fato durável registrado.");
    expect(screen.queryByTestId("inbox-memoria-notas")).toBeNull();
  });

  it("recarrega o resumo quando a thread ganha uma nota nova", async () => {
    const client = renderPainel();
    await screen.findByTestId("inbox-memoria-notas");
    const chamadasAntes = get.mock.calls.length;

    // É o que acontece quando a thread refaz a consulta depois de criar a nota.
    act(() => {
      client.setQueryData(["notes", "cv-1"], { data: [{ id: "nova" }] });
    });

    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(chamadasAntes));
    expect(get.mock.calls.at(-1)?.[0]).toBe(`/api/v1/contacts/${CONTACT}/crm-summary`);
  });
});
