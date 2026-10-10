import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: m }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
import { NpsDoCliente } from "@/components/contacts/NpsDoCliente";
beforeEach(() => {
  m.get.mockResolvedValue({
    data: {
      surveys: [
        {
          id: "survey",
          created_at: "2026-01-01",
          expires_at: "2026-02-01",
          score: 0,
          answered_at: "2026-01-02",
          comment: "Resposta teste",
          cancelled_at: null,
        },
      ],
      as_of: "2026-01-02",
    },
  });
  m.post.mockResolvedValue({ data: { path: "/pesquisa/nps#" + "b".repeat(64) } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount(canEdit = true) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NpsDoCliente contactId="customer" canEdit={canEdit} manager={true} actorId="actor" />
    </QueryClientProvider>,
  );
}
it("mostra resposta zero como detrator e comentário", async () => {
  mount();
  expect(await screen.findByText("0/10 · Detrator")).toBeVisible();
  expect(screen.getByText("Resposta teste")).toBeVisible();
});
it("gera link no endereço público do navegador", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Gerar link NPS" }));
  const input = await screen.findByRole("textbox", { name: "Link da pesquisa" });
  expect(input).toHaveValue(window.location.origin + "/pesquisa/nps#" + "b".repeat(64));
  expect(m.post).toHaveBeenCalledWith("/api/v1/contacts/customer/nps", { action: "create" });
});
it("não mantém o link anterior visível enquanto gera outro", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Gerar link NPS" }));
  await screen.findByRole("textbox", { name: "Link da pesquisa" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Gerar link NPS" })).toBeEnabled());
  m.post.mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Gerar link NPS" }));
  expect(screen.queryByRole("textbox", { name: "Link da pesquisa" })).toBeNull();
});
it("somente leitura vê resposta e não cria link", async () => {
  mount(false);
  expect(await screen.findByText("0/10 · Detrator")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Gerar link NPS" })).toBeNull();
});
