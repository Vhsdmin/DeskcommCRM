import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextRequest } from "next/server";

/**
 * "ALGUÉM JÁ ESTÁ FALANDO COM ESTE CLIENTE."
 *
 * A rota junta outra conversa ativa do mesmo contato e a CSM da Carteira, sem
 * contar quem já é dono desta conversa; a tela avisa e oferece transferir.
 */

// ─── a rota ────────────────────────────────────────────────────────────────

const banco = vi.hoisted(() => ({
  conversa: { id: "cv-1", contact_id: "c-1", assigned_to_user_id: "u-eu" } as Record<
    string,
    unknown
  > | null,
  outras: [] as Array<{ id: string; assigned_to_user_id: string }>,
  csm: null as string | null,
  // Membros ativos da org: quem a transferência aceitaria.
  membros: [
    { user_id: "u-ana", role: "agent" },
    { user_id: "u-csm", role: "manager" },
  ] as Array<{ user_id: string; role: string }>,
}));

function consulta(tabela: string) {
  const filtros: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "not", "order", "limit"]) {
    chain[m] = (...args: unknown[]) => {
      filtros.push([m, args]);
      return chain;
    };
  }
  chain.maybeSingle = () =>
    Promise.resolve({
      data: tabela === "conversations" ? banco.conversa : { cs_owner_user_id: banco.csm },
      error: null,
    });
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: banco.outras, error: null });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => consulta(t) }),
}));
vi.mock("@/lib/audit", () => ({ isServiceRoleConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "select", "eq", "in", "is"]) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: banco.membros, error: null });
    return chain;
  },
}));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, org: { orgId: "org-1", role: "agent" } }),
}));
vi.mock("@/lib/users/nome-do-atendente", () => ({
  nomesDosAtendentes: async (ids: string[]) =>
    new Map(ids.map((id) => [id, id === "u-ana" ? "Ana" : id === "u-csm" ? "Náthali" : null])),
}));

async function perguntar() {
  const { GET } = await import("@/app/api/v1/conversations/[id]/quem-ja-atende/route");
  const res = await GET(new NextRequest("http://x/api/v1/conversations/cv-1/quem-ja-atende"), {
    params: Promise.resolve({ id: "cv-1" }),
  });
  return { status: res.status, corpo: (await res.json()) as { data: unknown[] } };
}

beforeEach(() => {
  banco.conversa = { id: "cv-1", contact_id: "c-1", assigned_to_user_id: "u-eu" };
  banco.outras = [];
  banco.csm = null;
  banco.membros = [
    { user_id: "u-ana", role: "agent" },
    { user_id: "u-csm", role: "manager" },
  ];
});

describe("GET /api/v1/conversations/[id]/quem-ja-atende", () => {
  it("aponta a outra conversa aberta e a CSM, juntando quando é a mesma pessoa", async () => {
    banco.outras = [
      { id: "cv-2", assigned_to_user_id: "u-ana" },
      { id: "cv-3", assigned_to_user_id: "u-csm" },
    ];
    banco.csm = "u-csm";
    const { corpo } = await perguntar();
    expect(corpo.data).toEqual([
      {
        user_id: "u-ana",
        nome: "Ana",
        motivos: ["conversa_aberta"],
        conversation_id: "cv-2",
        pode_receber: true,
      },
      {
        user_id: "u-csm",
        nome: "Náthali",
        motivos: ["conversa_aberta", "csm"],
        conversation_id: "cv-3",
        pode_receber: true,
      },
    ]);
  });

  it("não avisa sobre quem já é dono desta conversa", async () => {
    banco.outras = [{ id: "cv-2", assigned_to_user_id: "u-eu" }];
    banco.csm = "u-eu";
    const { corpo } = await perguntar();
    expect(corpo.data).toEqual([]);
  });

  it("só a CSM, sem outra conversa", async () => {
    banco.csm = "u-csm";
    const { corpo } = await perguntar();
    expect(corpo.data).toEqual([
      {
        user_id: "u-csm",
        nome: "Náthali",
        motivos: ["csm"],
        conversation_id: null,
        pode_receber: true,
      },
    ]);
  });

  it("CSM desligada ou rebaixada a viewer segue no aviso, mas não pode receber", async () => {
    banco.csm = "u-csm";
    banco.outras = [{ id: "cv-2", assigned_to_user_id: "u-ana" }];
    banco.membros = [{ user_id: "u-ana", role: "viewer" }];
    const { corpo } = await perguntar();
    expect(corpo.data).toEqual([
      expect.objectContaining({ user_id: "u-ana", pode_receber: false }),
      expect.objectContaining({ user_id: "u-csm", pode_receber: false }),
    ]);
  });

  it("conversa de outra organização ou inexistente é 404", async () => {
    banco.conversa = null;
    const { status } = await perguntar();
    expect(status).toBe(404);
  });
});

// ─── o aviso ───────────────────────────────────────────────────────────────

const { get, transferir, auth } = vi.hoisted(() => ({
  get: vi.fn(),
  transferir: vi.fn(),
  auth: { pode: true, support: null as null | { access_mode: string } },
}));
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
vi.mock("@/hooks/inbox/useTransferConversation", () => ({
  useTransferConversation: () => ({ mutate: transferir, isPending: false }),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { support: auth.support } }),
  usePermission: () => auth.pode,
}));

async function renderAviso() {
  const { AvisoQuemJaAtende } = await import("@/components/inbox/AvisoQuemJaAtende");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AvisoQuemJaAtende conversationId="cv-1" donoAtualId="u-eu" />
    </QueryClientProvider>,
  );
}

describe("AvisoQuemJaAtende", () => {
  beforeEach(() => {
    get.mockReset();
    transferir.mockReset();
    auth.pode = true;
    auth.support = null;
  });

  it("avisa quem já atende e transfere para essa pessoa", async () => {
    get.mockResolvedValue({
      data: [
        {
          user_id: "u-ana",
          nome: "Ana",
          motivos: ["conversa_aberta"],
          conversation_id: "cv-2",
          pode_receber: true,
        },
      ],
    });
    await renderAviso();

    const aviso = await screen.findByTestId("aviso-quem-ja-atende");
    expect(aviso.textContent).toContain("Ana já está falando com este cliente em outra conversa.");
    expect(screen.getByRole("link", { name: "Ver conversa" }).getAttribute("href")).toBe(
      "/app/inbox?id=cv-2",
    );

    fireEvent.click(screen.getByRole("button", { name: "Transferir para Ana" }));
    expect(transferir).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: "cv-1", to_user_id: "u-ana" }),
    );
  });

  it("CSM aparece como CSM", async () => {
    get.mockResolvedValue({
      data: [
        {
          user_id: "u-csm",
          nome: "Náthali",
          motivos: ["csm"],
          conversation_id: null,
          pode_receber: true,
        },
      ],
    });
    await renderAviso();
    expect((await screen.findByTestId("aviso-quem-ja-atende")).textContent).toContain(
      "Náthali é a CSM deste cliente.",
    );
  });

  it("ninguém mais atendendo, nada aparece", async () => {
    get.mockResolvedValue({ data: [] });
    await renderAviso();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("aviso-quem-ja-atende")).toBeNull();
  });

  it("quem não pode transferir vê o aviso sem o botão", async () => {
    auth.pode = false;
    get.mockResolvedValue({
      data: [
        {
          user_id: "u-ana",
          nome: "Ana",
          motivos: ["conversa_aberta"],
          conversation_id: "cv-2",
          pode_receber: true,
        },
      ],
    });
    await renderAviso();
    await screen.findByTestId("aviso-quem-ja-atende");
    expect(screen.queryByRole("button", { name: /Transferir para/ })).toBeNull();
  });

  it("'Seguir atendendo' dispensa o aviso", async () => {
    get.mockResolvedValue({
      data: [
        {
          user_id: "u-ana",
          nome: "Ana",
          motivos: ["conversa_aberta"],
          conversation_id: "cv-2",
          pode_receber: true,
        },
      ],
    });
    await renderAviso();
    await screen.findByTestId("aviso-quem-ja-atende");
    fireEvent.click(screen.getByRole("button", { name: "Seguir atendendo" }));
    expect(screen.queryByTestId("aviso-quem-ja-atende")).toBeNull();
  });

  it("para quem não pode receber, avisa sem oferecer transferir", async () => {
    get.mockResolvedValue({
      data: [
        {
          user_id: "u-csm",
          nome: "Náthali",
          motivos: ["csm"],
          conversation_id: null,
          pode_receber: false,
        },
      ],
    });
    await renderAviso();
    expect((await screen.findByTestId("aviso-quem-ja-atende")).textContent).toContain("Náthali");
    expect(screen.queryByRole("button", { name: /Transferir para/ })).toBeNull();
  });
});
