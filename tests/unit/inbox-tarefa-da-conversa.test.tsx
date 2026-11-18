import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TarefasDaConversa } from "@/components/inbox/TarefasDaConversa";

/**
 * CRIAR TAREFA SEM SAIR DA CONVERSA.
 *
 * A tarefa nasce ligada ao contato e ao lead que o painel mostra, com quem a
 * criou como responsável, e as pendentes do cliente ficam visíveis ali.
 */

const { useTasks, criarTarefa } = vi.hoisted(() => ({ useTasks: vi.fn(), criarTarefa: vi.fn() }));
vi.mock("@/hooks/tasks/useTasks", () => ({ useTasks }));
const { usePermission } = vi.hoisted(() => ({ usePermission: vi.fn() }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ usePermission }));

const AGORA = Date.now();
const TAREFAS = [
  {
    id: "t-1",
    title: "Ligar para fechar a proposta",
    due_date: new Date(AGORA - 86_400_000).toISOString(),
    status: "pending",
  },
  { id: "t-2", title: "Enviar contrato", due_date: null, status: "in_progress" },
];

beforeEach(() => {
  criarTarefa.mockReset();
  criarTarefa.mockResolvedValue({ task: { id: "nova" } });
  usePermission.mockReset();
  usePermission.mockReturnValue(true);
  useTasks.mockReset();
  useTasks.mockReturnValue({ tarefas: TAREFAS, carregando: false, falhou: false, criarTarefa });
});

function renderSecao(props: Partial<React.ComponentProps<typeof TarefasDaConversa>> = {}) {
  render(
    <TarefasDaConversa
      contactId="c-1"
      leadId="l-1"
      usuarioId="u-1"
      somenteLeitura={false}
      {...props}
    />,
  );
}

describe("Tarefas da conversa", () => {
  it("lista as pendentes do cliente, dizendo a atrasada e a sem prazo", () => {
    renderSecao();
    expect(useTasks).toHaveBeenCalledWith({ contact_id: "c-1", aberto: true });
    expect(screen.getByText("Ligar para fechar a proposta")).toBeTruthy();
    expect(screen.getByText(/Atrasada/)).toBeTruthy();
    expect(screen.getByText("Sem prazo")).toBeTruthy();
  });

  it("cria a tarefa ligada ao contato e ao lead, com quem criou como responsável", async () => {
    renderSecao();
    fireEvent.click(screen.getByRole("button", { name: /Nova tarefa/ }));
    fireEvent.change(screen.getByLabelText("O que precisa ser feito"), {
      target: { value: "Retornar sobre a taxa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(criarTarefa).toHaveBeenCalledTimes(1));
    expect(criarTarefa.mock.calls[0]![0]).toMatchObject({
      title: "Retornar sobre a taxa",
      contact_id: "c-1",
      lead_id: "l-1",
      assigned_to: "u-1",
    });
  });

  it("sem pendentes, diz isso em vez de ficar em branco", () => {
    useTasks.mockReturnValue({ tarefas: [], carregando: false, falhou: false, criarTarefa });
    renderSecao();
    expect(screen.getByText("Nenhuma tarefa pendente.")).toBeTruthy();
  });

  it("no acompanhamento só de leitura, não oferece criar", () => {
    renderSecao({ somenteLeitura: true });
    expect(screen.queryByRole("button", { name: /Nova tarefa/ })).toBeNull();
  });

  it("quem só visualiza não vê o botão que a rota negaria", () => {
    usePermission.mockImplementation((acao: string) => acao !== "task.create");
    renderSecao();
    expect(screen.queryByRole("button", { name: /Nova tarefa/ })).toBeNull();
  });
});
