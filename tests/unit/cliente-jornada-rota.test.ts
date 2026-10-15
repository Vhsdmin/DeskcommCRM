import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  db: vi.fn(),
  rpc: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mock.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mock.support }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.db }));
vi.mock("@/lib/audit", () => ({ audit: mock.audit }));
import { PATCH } from "@/app/api/v1/contacts/[id]/journey/route";
const id = "70b96720-17b5-44ba-9ab2-19750677f90e";
const input = { phase: "onboarding", owner_user_id: null, revision: 0 };
const call = (body: unknown) =>
  PATCH(
    new Request("http://localhost/api/v1/contacts/" + id + "/journey", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  mock.support.mockResolvedValue(null);
  mock.role.mockResolvedValue({ ok: true, org: { orgId: "active-org" }, user: { id: "actor" } });
  mock.db.mockResolvedValue({ rpc: mock.rpc });
  mock.rpc.mockResolvedValue({ data: { status: "saved", revision: 1 }, error: null });
});
describe("jornada do cliente existente", () => {
  it("bloqueia suporte somente leitura antes do banco", async () => {
    mock.support.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await call(input)).status).toBe(403);
    expect(mock.db).not.toHaveBeenCalled();
  });
  it("recusa organização externa, fase desconhecida e revisão ausente", async () => {
    for (const body of [
      { ...input, organization_id: "foreign" },
      { ...input, phase: "invalid" },
      { phase: "onboarding", owner_user_id: null },
    ])
      expect((await call(body)).status).toBe(422);
    expect(mock.db).not.toHaveBeenCalled();
  });
  it("usa a organização da sessão e audita apenas sucesso", async () => {
    expect((await call(input)).status).toBe(200);
    expect(mock.role).toHaveBeenCalledWith("agent", expect.anything());
    expect(mock.rpc).toHaveBeenCalledWith("fn_update_contact_cs", {
      p_org: "active-org",
      p_contact: id,
      p_phase: "onboarding",
      p_owner: null,
      p_revision: 0,
    });
    expect(mock.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "active-org",
        actorUserId: "actor",
        resourceId: id,
      }),
    );
  });
  it.each([
    ["conflict", 409],
    ["not_found", 404],
    ["invalid_owner", 422],
  ])("retorna %s sem auditar sucesso", async (status, code) => {
    mock.rpc.mockResolvedValue({ data: { status }, error: null });
    expect((await call(input)).status).toBe(code);
    expect(mock.audit).not.toHaveBeenCalled();
  });
  it("não expõe erro do banco", async () => {
    mock.rpc.mockResolvedValue({ error: { code: "XX000", message: "private db detail" } });
    const r = await call(input);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("private db detail");
  });
});
