import { describe, expect, it } from "vitest";

import {
  NAV_DESTINATIONS,
  NAV_GROUPS,
  canSee,
  hubSections,
  searchable,
  sidebarItems,
} from "@/lib/navigation/registry";

/**
 * O registro é a fonte única da navegação. Estes testes cobrem as projeções
 * puras — quem renderiza (sidebar, hub, ⌘K) não decide nada, só desenha o que
 * sai daqui. A completude do registro contra as rotas de verdade é assunto de
 * `navegacao-completude.test.ts`.
 */

const ADMIN = { platform: false, role: "admin" as const };
const MANAGER = { platform: false, role: "manager" as const };
const AGENT = { platform: false, role: "agent" as const };
const VIEWER = { platform: false, role: "viewer" as const };

function dest(href: string) {
  const d = NAV_DESTINATIONS.find((x) => x.href === href);
  if (!d) throw new Error(`destino ausente do registro: ${href}`);
  return d;
}

describe("integridade do registro", () => {
  it("não tem href duplicado", () => {
    const vistos = new Map<string, number>();
    for (const d of NAV_DESTINATIONS) vistos.set(d.href, (vistos.get(d.href) ?? 0) + 1);
    const duplicados = [...vistos.entries()].filter(([, n]) => n > 1).map(([href]) => href);
    expect(duplicados).toEqual([]);
  });

  it("todo destino aponta para um grupo declarado", () => {
    const ids = new Set(NAV_GROUPS.map((g) => g.id));
    const orfaos = NAV_DESTINATIONS.filter((d) => !ids.has(d.group)).map((d) => d.href);
    expect(orfaos).toEqual([]);
  });

  it("todo destino tem descrição — é o que o hub e o ⌘K mostram", () => {
    const semTexto = NAV_DESTINATIONS.filter((d) => d.description.trim() === "").map((d) => d.href);
    expect(semTexto).toEqual([]);
  });

  it("todo destino de um grupo com hub declara sua seção", () => {
    const comHub = new Set(NAV_GROUPS.filter((g) => g.hub).map((g) => g.id));
    const semSecao = NAV_DESTINATIONS.filter((d) => comHub.has(d.group) && !d.section).map(
      (d) => d.href,
    );
    expect(semSecao).toEqual([]);
  });
});

describe("canSee", () => {
  it("nega quem está abaixo do minRole", () => {
    expect(canSee(dest("/app/audit"), MANAGER.platform, MANAGER.role)).toBe(true);
    expect(canSee(dest("/app/audit"), AGENT.platform, AGENT.role)).toBe(false);
  });

  it("destino sem minRole é visível até para viewer", () => {
    expect(canSee(dest("/app/inbox"), VIEWER.platform, VIEWER.role)).toBe(true);
  });

  it("platform admin vê tudo, inclusive sem org ativa", () => {
    for (const d of NAV_DESTINATIONS) expect(canSee(d, true, null)).toBe(true);
  });

  it("sem papel e sem ser platform admin não vê nada", () => {
    expect(canSee(dest("/app/inbox"), false, null)).toBe(false);
  });
});

describe("sidebarItems", () => {
  it("segue exatamente a hierarquia solicitada", () => {
    expect(sidebarItems(true, null).map((d) => d.label)).toEqual([
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
  it("preserva permissões e não mostra configuração na lista principal", () => {
    expect(sidebarItems(false, "viewer").map((d) => d.href)).not.toContain("/app/assistente");
    expect(sidebarItems(false, "admin").map((d) => d.href)).not.toContain("/app/ai/agents");
    expect(sidebarItems(false, null)).toEqual([]);
  });
  it("configurações recebe todo destino visível que saiu da lateral", () => {
    const main = sidebarItems(true, null).map((d) => d.href);
    const settings = hubSections("organizacao", true, null).flatMap((s) => s.items);
    expect(settings.map((d) => d.href).sort()).toEqual(
      searchable(true, null)
        .filter((d) => !main.includes(d.href))
        .map((d) => d.href)
        .sort(),
    );
    expect(settings.every((d) => d.label && d.description)).toBe(true);
    expect(settings.map((d) => d.href)).toEqual(
      expect.arrayContaining([
        "/app/ai/agents",
        "/app/connections",
        "/app/webhooks",
        "/app/carteira",
        "/app/playbooks",
        "/app/products",
        "/app/settings/tenant/pipelines",
        "/app/audit",
      ]),
    );
    expect(settings.map((d) => d.href)).not.toContain("/app/radar");
    expect(settings.map((d) => d.href)).not.toContain("/app/templates");
  });
});

describe("hubSections", () => {
  it("o hub do CRM inclui consolidação NPS e as telas existentes", () => {
    // As seções são a régua do sidebar escrita por extenso — o que se abre todo
    // dia contra o que se define uma vez. Lista EXATA: `toContain` deixaria uma
    // tela nova entrar sem que ninguém decidisse de que lado dela ela cai.
    const secoes = hubSections("crm", true, null);
    expect(secoes.map((s) => s.section)).toEqual([
      "Relacionamento e sucesso do cliente",
      "O dia a dia da venda",
      "Preparar a venda",
    ]);
    expect(secoes.flatMap((s) => s.items.map((i) => i.href))).toEqual([
      "/app/central",
      "/app/carteira",
      "/app/playbooks",
      "/app/nps",
      "/app/kanban",
      "/app/contacts",
      "/app/tasks",
      "/app/products",
      "/app/settings/tenant/pipelines",
    ]);
  });

  it("agrupa a IA nas três etapas da jornada, na ordem", () => {
    const secoes = hubSections("ia", true, null).map((s) => s.section);
    expect(secoes).toEqual([
      "Usar o assistente",
      "Montar o agente",
      "Ensinar o agente",
      "Acompanhar o agente",
    ]);
  });

  it("o hub mostra também o que já está no sidebar — é inventário, não sobra", () => {
    const hrefs = hubSections("ia", true, null).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toContain("/app/ai/agents");
    expect(hrefs).toContain("/app/ai/knowledge/sources");
  });

  it("não vaza destino acima do papel", () => {
    const hrefs = hubSections("organizacao", VIEWER.platform, VIEWER.role).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(hrefs).not.toContain("/app/settings/api-tokens");
    expect(hrefs).toContain("/app/settings/profile");
  });

  it("some com a seção que ficou vazia pela permissão", () => {
    const secoes = hubSections("organizacao", VIEWER.platform, VIEWER.role).map((s) => s.section);
    expect(secoes).not.toContain("Dados e acesso");
  });
});

describe("searchable", () => {
  it("expõe todo destino visível, do sidebar ou não", () => {
    const hrefs = searchable(ADMIN.platform, ADMIN.role).map((d) => d.href);
    expect(hrefs).toContain("/app/ai/knowledge/sources");
    expect(hrefs).not.toContain("/app/inbox");
  });

  it("respeita o papel", () => {
    const hrefs = searchable(AGENT.platform, AGENT.role).map((d) => d.href);
    expect(hrefs).not.toContain("/app/audit");
  });
});
