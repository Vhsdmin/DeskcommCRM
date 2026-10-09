import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TarefasClient } from "./TarefasClient";
const { useTasks, criarTarefa } = vi.hoisted(() => ({ useTasks: vi.fn(), criarTarefa: vi.fn() }));
vi.mock("@/hooks/tasks/useTasks", () => ({ useTasks }));
vi.mock("./ListaDeTarefas", () => ({ ListaDeTarefas: () => null }));
vi.mock("./CalendarioDeTarefas", () => ({ CalendarioDeTarefas: () => null }));
vi.mock("./FormularioDeTarefa", () => ({
  FormularioDeTarefa: ({
    aberto,
    aoSalvar,
  }: {
    aberto: boolean;
    aoSalvar: (input: unknown) => Promise<unknown>;
  }) =>
    aberto ? (
      <button
        onClick={() => void aoSalvar({ title: "Retorno combinado", contact_id: "outro-cliente" })}
      >
        Salvar exemplo
      </button>
    ) : null,
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  criarTarefa.mockResolvedValue({});
  useTasks.mockReturnValue({
    tarefas: [],
    carregando: false,
    falhou: false,
    recarregar: vi.fn(),
    criarTarefa,
    editarTarefa: vi.fn(),
    apagarTarefa: vi.fn(),
    alternarConcluida: vi.fn(),
  });
});
describe("tarefas no detalhe do cliente", () => {
  it("consulta somente as tarefas do cliente e mantém o vínculo na criação", async () => {
    render(<TarefasClient podeEditar contactId="cliente-atual" />);
    expect(useTasks).toHaveBeenLastCalledWith({ aberto: true, contact_id: "cliente-atual" });
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar exemplo" }));
    await waitFor(() =>
      expect(criarTarefa).toHaveBeenCalledWith({
        title: "Retorno combinado",
        contact_id: "cliente-atual",
      }),
    );
  });
  it("preserva a consulta geral e impede criação na visualização sem edição", () => {
    render(<TarefasClient podeEditar={false} />);
    expect(useTasks).toHaveBeenLastCalledWith({ aberto: true, contact_id: undefined });
    expect(screen.queryByRole("button", { name: "Nova tarefa" })).toBeNull();
  });
});
