import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/team/users/route";
const h = vi.hoisted(() => ({
  guard: vi.fn(),
  support: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.guard }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.support }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: h.create, deleteUser: h.remove } },
    from: () => ({ insert: h.insert }),
  }),
}));
const input = {
  nome: "QA Teste",
  email: "qa@example.test",
  senha: "UmaSenhaInicial123!",
  role: "agent",
  acessos: ["/app/tasks"],
};
const request = (body: unknown = input) =>
  new Request("http://localhost/api/v1/team/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.support.mockResolvedValue(null);
  h.guard.mockResolvedValue({ ok: true, user: { id: "actor" }, org: { orgId: "trusted-org" } });
  h.create.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  h.remove.mockResolvedValue({ error: null });
  h.insert.mockReturnValue({ select: () => ({ single: h.single }) });
  h.single.mockResolvedValue({ data: { id: "membership" }, error: null });
});
describe("cadastro direto", () => {
  it("cria usuário confirmado e vínculo ativo no tenant confiável sem registrar a senha", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ email_confirm: true, password: input.senha }),
    );
    expect(h.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "trusted-org",
        module_access: ["/app/tasks"],
        accepted_at: expect.any(String),
      }),
    );
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(input.senha);
    expect(JSON.stringify(await response.json())).not.toContain(input.senha);
  });
  it("recusa não-admin antes de criar conta", async () => {
    h.guard.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request())).status).toBe(403);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("não altera conta existente", async () => {
    h.create.mockResolvedValue({ data: { user: null }, error: { code: "email_exists" } });
    expect((await POST(request())).status).toBe(409);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
  it("compensa falha do vínculo apenas com a conta recém-criada", async () => {
    h.single.mockResolvedValue({ data: null, error: { code: "test" } });
    expect((await POST(request())).status).toBe(500);
    expect(h.remove).toHaveBeenCalledExactlyOnceWith("new-user");
  });
  it("rejeita corpo inválido sem criar nem vazar valores", async () => {
    const response = await POST(request({ ...input, organization_id: "forged" }));
    expect(response.status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(input.senha);
  });
});
