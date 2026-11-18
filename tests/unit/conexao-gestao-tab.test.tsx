import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O segredo da conexão com o Gestão vem do core da VendePay: a tela não gera nem
 * exibe segredo, só pede que seja colado e diz se já foi.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));

import { ConexaoGestaoTab } from "@/app/app/webhooks/_components/ConexaoGestaoTab";

const SEGREDO_DO_CORE = "Zx8kQ2mV7pL1nR4tY6wB9cD3fG5hJ0aE-sU_iO8qW2e";

function conexao(temSegredo: boolean) {
  return {
    id: "c1",
    path_token: "t".repeat(32),
    is_active: true,
    last_received_at: null,
    created_at: "2026-11-17T12:00:00.000Z",
    tem_segredo: temSegredo,
  };
}

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cliente}>
      <ConexaoGestaoTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("Receber dados › Gestão VendePay", () => {
  it("sem segredo, avisa e só salva o segredo colado", async () => {
    api.get.mockResolvedValue({ data: { conexao: conexao(false), envios: [] } });
    api.patch.mockResolvedValue({ data: { conexao: conexao(true) } });
    renderizar();

    expect(await screen.findByText(/Falta o segredo gerado na Gestão/)).toBeInTheDocument();
    const salvar = screen.getByRole("button", { name: "Salvar segredo" });
    expect(salvar).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Segredo gerado na Gestão"), `  ${SEGREDO_DO_CORE} `);
    await userEvent.click(salvar);

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("/api/v1/integracoes/gestao", { segredo: SEGREDO_DO_CORE }),
    );
    expect(screen.getByLabelText("Segredo gerado na Gestão")).toHaveValue("");
  });

  it("com segredo, não exibe valor e oferece trocar", async () => {
    api.get.mockResolvedValue({ data: { conexao: conexao(true), envios: [] } });
    renderizar();

    expect(await screen.findByText(/Guardado cifrado/)).toBeInTheDocument();
    expect(screen.queryByText(/Falta o segredo/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trocar segredo" })).toBeDisabled();
  });

  it("criar a conexão não devolve segredo", async () => {
    api.get.mockResolvedValue({ data: { conexao: null, envios: [] } });
    api.post.mockResolvedValue({ data: { conexao: conexao(false) } });
    renderizar();

    await userEvent.click(await screen.findByRole("button", { name: "Criar conexão com o Gestão" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/integracoes/gestao", {}));
  });
});
