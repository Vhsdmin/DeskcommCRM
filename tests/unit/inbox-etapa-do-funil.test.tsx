import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { EtapaDoFunil, type EtapaDoLead } from "@/components/inbox/EtapaDoFunil";

/**
 * A ETAPA DO FUNIL SE ESCOLHE NA CONVERSA.
 *
 * O seletor move pela rota de lote (o banco posiciona o card) e não oferece
 * etapa de perda, que exige motivo e continua no Funil.
 */

const { post, showApiError } = vi.hoisted(() => ({ post: vi.fn(), showApiError: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError }));

const ETAPAS: EtapaDoLead[] = [
  { id: "s-entrada", name: "Entrada", is_won: false, is_lost: false },
  { id: "s-proposta", name: "Proposta", is_won: false, is_lost: false },
  { id: "s-ganho", name: "Ganho", is_won: true, is_lost: false },
  { id: "s-perdido", name: "Perdido", is_won: false, is_lost: true },
];

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: { updated_count: 1 } });
  showApiError.mockReset();
});

function renderSeletor(props: Partial<React.ComponentProps<typeof EtapaDoFunil>> = {}) {
  const onMovido = vi.fn();
  render(
    <EtapaDoFunil
      leadId="l-1"
      status="open"
      etapaAtualId="s-entrada"
      etapas={ETAPAS}
      onMovido={onMovido}
      {...props}
    />,
  );
  return { onMovido };
}

describe("EtapaDoFunil", () => {
  it("mostra a etapa atual e oferece as do funil, menos a de perda", () => {
    renderSeletor();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("s-entrada");
    const nomes = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(nomes).toEqual(["Entrada", "Proposta", "Ganho"]);
  });

  it("trocar a etapa move o lead pela rota de lote e recarrega o painel", async () => {
    const { onMovido } = renderSeletor();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s-proposta" } });

    await waitFor(() => expect(onMovido).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/leads/bulk", {
      action: "move",
      lead_ids: ["l-1"],
      params: { stage_id: "s-proposta" },
    });
  });

  it("falha ao mover avisa e não finge que moveu", async () => {
    post.mockRejectedValue(new Error("conflito"));
    const { onMovido } = renderSeletor();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s-proposta" } });

    await waitFor(() => expect(showApiError).toHaveBeenCalledTimes(1));
    expect(onMovido).not.toHaveBeenCalled();
  });

  it("lead já fechado mostra a etapa sem oferecer troca", () => {
    renderSeletor({ status: "lost", etapaAtualId: "s-perdido" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Perdido")).toBeTruthy();
  });

  it("funil sem etapas não desenha nada", () => {
    renderSeletor({ etapas: [] });
    expect(screen.queryByTestId("inbox-etapa-do-funil")).toBeNull();
  });
});
