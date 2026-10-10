import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: m }));
import { NpsPublico } from "@/app/pesquisa/nps/_client";
beforeEach(() => {
  window.history.replaceState(null, "", "/pesquisa/nps#" + "a".repeat(64));
  m.post.mockImplementation((_url: string, body: { action: string }) =>
    Promise.resolve({ data: { status: body.action === "status" ? "ready" : "saved" } }),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <NpsPublico />
    </QueryClientProvider>,
  );
}
it("oferece escala tradicional e permite enviar zero com comentário", async () => {
  mount();
  const zero = await screen.findByRole("radio", { name: "Nota 0" });
  expect(screen.getAllByRole("radio")).toHaveLength(11);
  expect(screen.getByRole("button", { name: "Enviar resposta" })).toBeDisabled();
  fireEvent.click(zero);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Teste" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
  await waitFor(() =>
    expect(m.post).toHaveBeenCalledWith("/api/v1/public/nps", {
      action: "answer",
      token: "a".repeat(64),
      score: 0,
      comment: "Teste",
    }),
  );
  expect(await screen.findByRole("heading", { name: "Obrigado pela sua resposta!" })).toBeVisible();
});
it("link respondido não oferece formulário ou resposta anterior", async () => {
  m.post.mockResolvedValue({ data: { status: "answered" } });
  mount();
  expect(await screen.findByRole("heading", { name: "Obrigado pela sua resposta!" })).toBeVisible();
  expect(screen.queryByRole("radio")).toBeNull();
});
it("link inválido não chama a API e oferece orientação", async () => {
  window.history.replaceState(null, "", "/pesquisa/nps#invalid");
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Este link não está mais disponível");
  expect(m.post).not.toHaveBeenCalled();
});

it("abrir outro convite na mesma página não reaproveita confirmação anterior", async () => {
  m.post.mockImplementation((_url: string, body: { token: string }) =>
    Promise.resolve({ data: { status: body.token === "a".repeat(64) ? "answered" : "ready" } }),
  );
  mount();
  expect(await screen.findByRole("heading", { name: "Obrigado pela sua resposta!" })).toBeVisible();
  window.history.replaceState(null, "", "/pesquisa/nps#" + "b".repeat(64));
  fireEvent(window, new Event("hashchange"));
  expect(await screen.findByRole("radio", { name: "Nota 0" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Obrigado pela sua resposta!" })).toBeNull();
});
