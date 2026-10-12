import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: m }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/team/useTeamMembers", () => ({ useTeamMembers: () => ({ data: { data: [] } }) }));
import { NpsDashboard } from "@/components/cs/NpsDashboard";
import { DesempenhoCS } from "@/components/cs/DesempenhoCS";
import { VelocimetroNps } from "@/components/cs/VelocimetroNps";
const fixture = {
  summary: {
    total: 1011,
    answered: 1000,
    pending: 5,
    expired: 4,
    cancelled: 2,
    detractors: 100,
    neutrals: 200,
    promoters: 700,
    average_100: 85,
    nps: 60,
  },
  filtered_total: 1011,
  as_of: "2026-10-12T15:00:00Z",
  rows: [
    {
      id: "survey",
      contact_id: "contact",
      name: "Fixture",
      created_at: "2026-10-01",
      answered_at: "2026-10-02",
      expires_at: "2026-11-01",
      score: 0,
      comment: "<script>não executar</script>",
      status: "answered",
    },
  ],
};
function mount(ui: React.ReactNode) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  m.get.mockResolvedValue({ data: fixture });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("usa agregado global, zero detrator e comentário como texto; liga às tarefas", async () => {
  mount(<NpsDashboard canCompare={false} />);
  expect(await screen.findByText("1011")).toBeVisible();
  expect(screen.getByText("0/10")).toBeVisible();
  expect(screen.getByText("<script>não executar</script>")).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByRole("link", { name: "Planejar contato" })).toHaveAttribute(
    "href",
    "/app/contacts/contact?aba=tasks",
  );
  expect(screen.getByText("60")).toBeVisible();
});
it("pagina e troca filtros, reiniciando a página sem alterar a régua dos totais", async () => {
  mount(<NpsDashboard canCompare={false} />);
  await screen.findByText("1011");
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  await waitFor(() => expect(m.get).toHaveBeenLastCalledWith(expect.stringContaining("offset=25")));
  fireEvent.change(await screen.findByRole("combobox", { name: "Situação da pesquisa" }), {
    target: { value: "pending" },
  });
  await waitFor(() =>
    expect(m.get).toHaveBeenLastCalledWith(expect.stringMatching(/status=pending.*offset=0/)),
  );
  fireEvent.click(screen.getByRole("button", { name: "60 dias" }));
  await waitFor(() => expect(m.get).toHaveBeenCalledTimes(4));
});
it("período personalizado só consulta após aplicar datas válidas", async () => {
  mount(<NpsDashboard canCompare={false} />);
  await screen.findByText("1011");
  fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));
  fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-10-03" } });
  expect(m.get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Aplicar período" }));
  await waitFor(() =>
    expect(m.get).toHaveBeenLastCalledWith(
      expect.stringContaining("from=2026-10-01&to=2026-10-03"),
    ),
  );
});
it("sem resposta mostra ausência e não desenha ponteiro enganoso", () => {
  render(<VelocimetroNps value={null} />);
  expect(screen.getByRole("img")).toHaveAccessibleName("Sem respostas para calcular a média");
  expect(screen.queryByTestId("nps-needle")).toBeNull();
});
it.each([0, 100])("ponteiro alcança extremo %s e mantém valor zero", (value) => {
  render(<VelocimetroNps value={value} />);
  expect(screen.getByRole("img")).toHaveAccessibleName(`Nota média consolidada: ${value} / 100`);
  expect(screen.getByTestId("nps-needle")).toHaveAttribute("x2", String(value === 0 ? 72 : 248));
});
it("erros não viram zeros ou dados antigos", async () => {
  m.get.mockRejectedValue(new Error("private"));
  mount(<NpsDashboard canCompare={false} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não foi possível carregar o dashboard NPS.",
  );
  expect(screen.queryByText("NPS tradicional")).toBeNull();
});
it("desempenho preserva critério de registros e acesso à ação", async () => {
  m.get.mockResolvedValue({
    data: {
      performance: [
        {
          user_id: "actor",
          supports: 3,
          meetings: 2,
          ebr: 1,
          qbr: 1,
          contacted_clients: 2,
          portfolio: 5,
          overdue_tasks: 1,
          silent_clients: 1,
          unattended_detractors: 0,
        },
      ],
      attention: [
        {
          id: "contact",
          name: "Fixture",
          cs_owner_user_id: "actor",
          cs_phase: "Entrada",
          last_contact: null,
          created_at: "2026-01-01",
          detractor_since: null,
        },
      ],
      attention_total: 1,
      as_of: "2026-10-12T15:00:00Z",
    },
  });
  mount(<DesempenhoCS canCompare={false} currentUserId="actor" />);
  expect(await screen.findByText("Seu desempenho")).toBeVisible();
  expect(screen.getByText(/Agendamentos não contam/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Planejar contato" })).toHaveAttribute(
    "href",
    "/app/contacts/contact?aba=tasks",
  );
  fireEvent.change(screen.getByLabelText("Dias sem contato"), { target: { value: "7" } });
  await waitFor(() => expect(m.get).toHaveBeenLastCalledWith(expect.stringContaining("silence=7")));
});
