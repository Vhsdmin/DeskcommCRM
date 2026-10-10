import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  db: vi.fn(),
  rpc: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: m.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: m.support }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.db }));
vi.mock("@/lib/audit", () => ({ audit: m.audit }));
import { POST } from "@/app/api/v1/contacts/[id]/nps/route";
import { npsClass } from "@/lib/contacts/nps";
const id = "70b96720-17b5-44ba-9ab2-19750677f90e";
const call = (body: unknown) =>
  POST(
    new Request("http://localhost/api/v1/contacts/" + id + "/nps", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.support.mockResolvedValue(null);
  m.role.mockResolvedValue({ ok: true, org: { orgId: "active-org" }, user: { id: "actor" } });
  m.db.mockResolvedValue({ rpc: m.rpc });
  m.rpc.mockResolvedValue({ data: { status: "saved", id: "survey" }, error: null });
});
it("bloqueia suporte somente leitura", async () => {
  m.support.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await call({ action: "create" })).status).toBe(403);
  expect(m.db).not.toHaveBeenCalled();
});
it("não aceita org, token ou nota de quem gera o link", async () => {
  expect((await call({ action: "create", organization_id: "foreign" })).status).toBe(422);
  expect((await call({ action: "create", score: 9 })).status).toBe(422);
  expect(m.db).not.toHaveBeenCalled();
});
it("cria caminho público individual, guarda hash e não registra token na auditoria", async () => {
  const r = await call({ action: "create" });
  const body = await r.json();
  expect(body.data.path).toMatch(/^\/pesquisa\/nps#[a-f0-9]{64}$/);
  const params = m.rpc.mock.calls[0]?.[1];
  expect(params.p_org).toBe("active-org");
  expect(params.p_contact).toBe(id);
  expect(params.p_hash).not.toBe(body.data.path.split("#")[1]);
  expect(JSON.stringify(m.audit.mock.calls)).not.toContain(body.data.path.split("#")[1]);
});
it("cancelamento usa pesquisa, organização e contato autenticados", async () => {
  const survey_id = "b5a195e9-e166-45e5-bdbb-99ad617970d3";
  expect((await call({ action: "cancel", survey_id })).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    "fn_manage_customer_nps",
    expect.objectContaining({
      p_org: "active-org",
      p_contact: id,
      p_action: "cancel",
      p_survey: survey_id,
      p_hash: null,
    }),
  );
});
it.each([
  ["conflict", 409],
  ["not_found", 404],
])("recusa %s sem auditar sucesso", async (status, code) => {
  m.rpc.mockResolvedValue({ data: { status }, error: null });
  expect((await call({ action: "create" })).status).toBe(code);
  expect(m.audit).not.toHaveBeenCalled();
});
it.each([
  [0, "Detrator"],
  [6, "Detrator"],
  [7, "Neutro"],
  [8, "Neutro"],
  [9, "Promotor"],
  [10, "Promotor"],
])("classifica %s como %s", (score, label) => expect(npsClass(score as number)).toBe(label));
