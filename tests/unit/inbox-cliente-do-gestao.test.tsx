import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ClienteDoGestao, type ClienteGestao } from "@/components/inbox/ClienteDoGestao";

/**
 * "CLIENTE CADASTRADO" É QUEM VEIO DO GESTÃO.
 *
 * O selo mostra o que o Gestão diz do contato; contato sem vínculo aparece como
 * novo, e quem é gestor pode juntá-lo ao cliente do Gestão — que fica.
 */

const { get, mutate, podeVincular } = vi.hoisted(() => ({
  get: vi.fn(),
  mutate: vi.fn(),
  podeVincular: { valor: true },
}));
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
vi.mock("@/hooks/contacts/useMergeContacts", () => ({
  useMergeContacts: () => ({ mutate, isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  usePermission: (acao: string) => (acao === "contact.merge" ? podeVincular.valor : false),
}));

const CLIENTE: ClienteGestao = {
  conta_id: "acc-1",
  gmv_30d_centavos: 4_500_000,
  ultima_venda_em: "2026-11-10T12:00:00Z",
  faixa: "Náthali",
  csm_nome: "Náthali",
};

beforeEach(() => {
  get.mockReset();
  mutate.mockReset();
  podeVincular.valor = true;
});

function renderSelo(cliente: ClienteGestao | null, onVinculado = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ClienteDoGestao contactId="c-whats" cliente={cliente} carregando={false} onVinculado={onVinculado} />
    </QueryClientProvider>,
  );
  return { onVinculado };
}

describe("selo do cliente do Gestão", () => {
  it("cliente do Gestão mostra faixa, faturamento, última venda e CSM", () => {
    renderSelo(CLIENTE);
    const selo = screen.getByTestId("selo-cliente-gestao");
    expect(selo.textContent).toContain("Cliente VendePay");
    expect(selo.textContent).toContain("Náthali");
    expect(selo.textContent).toMatch(/R\$\s?45\.000,00/);
    expect(selo.textContent).toContain("10/11/2026");
  });

  it("contato sem vínculo aparece como novo", () => {
    renderSelo(null);
    expect(screen.getByTestId("selo-contato-novo").textContent).toContain("Contato novo");
  });

  it("quem não pode juntar cadastros não vê o botão, e sabe a quem pedir", () => {
    podeVincular.valor = false;
    renderSelo(null);
    expect(screen.queryByRole("button", { name: "Vincular a cliente do Gestão" })).toBeNull();
    expect(screen.getByText(/peça a um gestor/)).toBeTruthy();
  });

  it("vincula buscando só clientes do Gestão e mantém o cadastro de lá", async () => {
    get.mockResolvedValue({
      data: [
        { id: "c-gestao", name: "Loja da Ana", display_name: null, email: "ana@loja.com", phone_number: null },
        { id: "c-whats", name: "O próprio", display_name: null, email: null, phone_number: null },
      ],
    });
    mutate.mockImplementation((_input, opts: { onSuccess: () => void }) => opts.onSuccess());
    const { onVinculado } = renderSelo(null);

    fireEvent.click(screen.getByRole("button", { name: "Vincular a cliente do Gestão" }));
    fireEvent.change(screen.getByLabelText("Buscar cliente do Gestão"), { target: { value: "ana" } });

    const opcao = await screen.findByText("Loja da Ana");
    // O próprio contato não aparece como alvo.
    expect(screen.queryByText("O próprio")).toBeNull();
    expect(get.mock.calls[0]![0]).toBe("/api/v1/contacts?search=ana&source=gestao&limit=10");

    fireEvent.click(opcao);
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    await waitFor(() => expect(onVinculado).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0]![0]).toEqual({
      primary_contact_id: "c-gestao",
      secondary_contact_ids: ["c-whats"],
    });
  });
});
