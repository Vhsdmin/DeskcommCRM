import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/v1/team/[user_id]/acessos/route";
const h = vi.hoisted(() => ({
  guard: vi.fn(),
  support: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.guard }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.support }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    let writing = false;
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => {
        h.eq(...args);
        return chain;
      },
      is: () => chain,
      update: (body: unknown) => {
        writing = true;
        h.update(body);
        return chain;
      },
      maybeSingle: () => (writing ? h.save() : h.read()),
    };
    return { from: () => chain };
  },
}));
const actor = "c7610000-0000-4000-8000-000000000001",
  target = "c7610000-0000-4000-8000-000000000002";
const request = (acessos: string[] = ["/app/tasks"]) =>
  new Request("http://localhost/api/v1/team/member/acessos", {
    method: "PATCH",
    body: JSON.stringify({ acessos }),
  });
const ctx = (user_id = target) => ({ params: Promise.resolve({ user_id }) });
beforeEach(() => {
  vi.clearAllMocks();
  h.support.mockResolvedValue(null);
  h.guard.mockResolvedValue({ ok: true, user: { id: actor }, org: { orgId: "trusted-org" } });
  h.read.mockResolvedValue({ data: { id: "membership", role: "agent" }, error: null });
  h.save.mockResolvedValue({ data: { id: "membership" }, error: null });
});
describe("administração de acessos", () => {
  it("salva na organização confiável e compara o papel na atualização", async () => {
    expect((await PATCH(request(), ctx())).status).toBe(200);
    expect(h.eq).toHaveBeenCalledWith("organization_id", "trusted-org");
    expect(h.eq).toHaveBeenCalledWith("role", "agent");
    expect(h.update).toHaveBeenCalledWith({ module_access: ["/app/tasks"] });
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "team.access_changed", organizationId: "trusted-org" }),
    );
  });
  it("nega não-admin e acompanhamento somente leitura antes de consultar", async () => {
    h.support.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await PATCH(request(), ctx())).status).toBe(403);
    expect(h.guard).not.toHaveBeenCalled();
    h.support.mockResolvedValue(null);
    h.guard.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await PATCH(request(), ctx())).status).toBe(403);
    expect(h.read).not.toHaveBeenCalled();
  });
  it("não restringe a própria conta", async () => {
    expect((await PATCH(request(), ctx(actor))).status).toBe(403);
    expect(h.read).not.toHaveBeenCalled();
  });
  it("recusa membro de outra organização, revogado ou inexistente", async () => {
    h.read.mockResolvedValue({ data: null, error: null });
    expect((await PATCH(request(), ctx())).status).toBe(404);
    expect(h.update).not.toHaveBeenCalled();
  });
  it("não finge restringir admin nem permite acessos acima do papel", async () => {
    h.read.mockResolvedValueOnce({ data: { id: "membership", role: "admin" }, error: null });
    expect((await PATCH(request(), ctx())).status).toBe(400);
    expect((await PATCH(request(["/app/settings/api-tokens"]), ctx())).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
  it("não informa sucesso se o vínculo mudou durante a edição", async () => {
    h.save.mockResolvedValue({ data: null, error: null });
    expect((await PATCH(request(), ctx())).status).toBe(409);
    expect(h.audit).not.toHaveBeenCalled();
  });
});
