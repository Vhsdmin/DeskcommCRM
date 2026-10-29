/**
 * Sidebar agrupado por objetivo. O que estes testes protegem:
 *
 *  - a hierarquia existe (o usuário reclamou de 17 itens no mesmo peso visual);
 *  - Funis é alcançável sem passar por Configurações — o achado que originou tudo;
 *  - agrupar não criou cabeçalho órfão (grupo cujos filhos a permissão filtrou);
 *  - colapsado não renderiza título nenhum: 6 rótulos em 64px seria ilegível.
 *
 * A regra de quem-vê-o-quê é do registro e está coberta em
 * `navegacao-registry.test.ts`; aqui é a superfície.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Sidebar, SidebarContent } from "@/components/shell/Sidebar";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";

const pathnameRef = vi.hoisted(() => ({ value: "/app/central" }));

const authRef: { user: Pick<AuthUser, "is_platform_admin">; activeOrg: ActiveOrg | null } = {
  user: { is_platform_admin: false },
  activeOrg: null,
};

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => authRef,
  usePermission: () => false,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.value,
}));
vi.mock("@/components/connections/ConnectionHealthDot", () => ({
  ConnectionHealthDot: () => null,
}));
vi.mock("@/app/actions/shell/toggleSidebar", () => ({
  toggleSidebar: vi.fn(),
}));
// Busca a versão via react-query; sem QueryClientProvider ele lança, e o
// rodapé de versão não é o que estes testes examinam.
vi.mock("@/components/shell/VersionFooter", () => ({
  VersionFooter: () => null,
}));

function comoPapel(role: ActiveOrg["role"]) {
  authRef.user = { is_platform_admin: false };
  authRef.activeOrg = { orgId: "org-1", name: "Org", role };
}

afterEach(() => {
  cleanup();
  pathnameRef.value = "/app/central";
});

describe("Sidebar com lista principal", () => {
  it("mostra apenas os dez menus na ordem pedida, sem grupos", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect(screen.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Central de Prioridades",
      "Agenda",
      "Funil",
      "Clientes",
      "Tarefas",
      "Dashboard NPS",
      "Assistente de IA",
      "Desempenho",
      "Atividades",
      "Configurações",
    ]);
  });
  it("recolhido mantém destinos e nomes acessíveis", () => {
    comoPapel("admin");
    render(<Sidebar collapsed />);
    expect(screen.getByRole("link", { name: "Central de Prioridades" })).toHaveAttribute(
      "href",
      "/app/central",
    );
    expect(screen.getByRole("link", { name: "Configurações" })).toHaveAttribute(
      "href",
      "/app/settings",
    );
  });
  it("marca só a rota atual", () => {
    comoPapel("admin");
    render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("link", { name: "Central de Prioridades" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Funil" })).not.toHaveAttribute("aria-current");
  });
  it("respeita a seleção por vínculo sem perder a porta de configurações", () => {
    comoPapel("admin");
    authRef.activeOrg = {
      ...authRef.activeOrg!,
      interface_settings: { preset: "completa", destinos: ["/app/products"] },
    };
    render(<Sidebar collapsed={false} />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Configurações"]);
  });
  it("mantém Configurações ativo ao abrir um recurso movido", () => {
    comoPapel("admin");
    pathnameRef.value = "/app/ai/agents/agente-1";
    render(<Sidebar collapsed={false} />);
    expect(screen.getByRole("link", { name: "Configurações" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Assistente de IA" })).not.toHaveAttribute(
      "aria-current",
    );
  });
  it("o conteúdo mobile fecha a gaveta ao navegar", () => {
    comoPapel("admin");
    const onNavigate = vi.fn();
    render(
      <SidebarContent collapsed={false} showCollapseControl={false} onNavigate={onNavigate} />,
    );
    screen.getByRole("link", { name: "Agenda" }).click();
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Recolher sidebar" })).toBeNull();
  });
});
