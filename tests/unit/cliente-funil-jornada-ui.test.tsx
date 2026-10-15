import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: m }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
import { JornadaCSBoard } from "@/components/kanban/JornadaCSBoard";
const customer = {
  id: "customer",
  name: "Cliente teste",
  cs_phase: "entrada",
  cs_revision: 4,
  cs_owner_user_id: "owner",
  organization_id: "org",
};
beforeEach(() => {
  m.get.mockResolvedValue({ data: { customers: [customer], total: 1 } });
  m.patch.mockResolvedValue({ data: { status: "saved" } });
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
      <JornadaCSBoard pipelineId="pipeline" name="Jornada" canEdit={canEdit} />
    </QueryClientProvider>,
  );
}
it("consome envelope REST e posiciona cliente na fase da ficha", async () => {
  mount();
  expect(
    await within(await screen.findByRole("region", { name: "Entrada" })).findByRole("link", {
      name: "Cliente teste",
    }),
  ).toHaveAttribute("href", "/app/contacts/customer");
  expect(
    within(screen.getByRole("region", { name: "Onboarding" })).queryByRole("link", {
      name: "Cliente teste",
    }),
  ).toBeNull();
});
it("muda fase preservando dono e revisão e recarrega o quadro", async () => {
  mount();
  const select = await screen.findByRole("combobox", { name: "Fase da jornada: Cliente teste" });
  fireEvent.change(select, { target: { value: "adocao" } });
  await waitFor(() =>
    expect(m.patch).toHaveBeenCalledWith("/api/v1/contacts/customer/journey", {
      phase: "adocao",
      owner_user_id: "owner",
      revision: 4,
    }),
  );
  await waitFor(() => expect(m.get.mock.calls.length).toBeGreaterThan(1));
});
it("somente leitura oferece ficha mas não mudança de fase", async () => {
  mount(false);
  expect(await screen.findByRole("link", { name: "Abrir ficha do cliente" })).toBeVisible();
  expect(screen.queryByRole("combobox")).toBeNull();
});
