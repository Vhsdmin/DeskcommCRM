import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  post: vi.fn().mockResolvedValue({ data: { id: "created" } }),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post: m.post } }));
vi.mock("@/components/agenda/AgendasConectadas", () => ({ AgendasConectadas: () => null }));
vi.mock("@/components/agenda/PrazosDePresenca", () => ({ PrazosDePresenca: () => null }));
vi.mock("@/components/agenda/DiasBloqueados", () => ({ DiasBloqueados: () => null }));
import { TiposDeAgendamentoClient } from "@/app/app/settings/tenant/agenda/_client";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function mount(podeEditar = true) {
  render(
    <TiposDeAgendamentoClient
      tiposIniciais={[]}
      pessoas={[{ id: "actor", papel: "admin", nome: "Filipe" }]}
      podeEditar={podeEditar}
      usuarioAtualId="actor"
      podeConfigurarGoogle={false}
    />,
  );
}
it("prepara QBR editável e grava apenas ao confirmar, com dono correto", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Preparar QBR" }));
  expect(m.post).not.toHaveBeenCalled();
  expect(screen.getByTestId("novo-tipo-nome")).toHaveValue("Reunião QBR");
  expect(screen.getByTestId("novo-tipo-duracao")).toHaveValue(60);
  fireEvent.change(screen.getByTestId("novo-tipo-duracao"), { target: { value: "45" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar tipo" }));
  await waitFor(() =>
    expect(m.post).toHaveBeenCalledWith(
      "/api/v1/agenda/tipos",
      expect.objectContaining({
        name: "Reunião QBR",
        duration_minutes: 45,
        category: "reuniao",
        default_owner_user_id: "actor",
      }),
    ),
  );
  expect(m.post.mock.calls[0]?.[1]).not.toHaveProperty("reminder_enabled");
});
it("oferece modelo EBR sem gravar ao cancelar e mantém dono na próxima criação", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Preparar EBR" }));
  expect(screen.getByTestId("novo-tipo-nome")).toHaveValue("Reunião EBR");
  expect(screen.getByTestId("novo-tipo-duracao")).toHaveValue(30);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Novo tipo de agendamento" }));
  expect(screen.getByTestId("novo-tipo-nome")).toHaveValue("");
  expect(screen.getByTestId("novo-tipo-dono")).toHaveValue("actor");
  expect(m.post).not.toHaveBeenCalled();
});
it("não oferece criação a quem só pode ler", () => {
  mount(false);
  expect(screen.queryByRole("button", { name: "Preparar QBR" })).toBeNull();
});
