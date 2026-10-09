import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), support: vi.fn(), db: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: m.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: m.support }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.db }));
vi.mock("@/lib/audit", () => ({ audit: m.audit }));
import { PATCH, DELETE } from "@/app/api/v1/contacts/[id]/timeline/[activityId]/route";
const id = "70b96720-17b5-44ba-9ab2-19750677f90e";
const activityId = "70b96720-17b5-44ba-9ab2-19750677f90f";
const input = {
  kind: "qbr",
  summary: "Corrigido",
  next_steps: "Retornar",
  performed_at: "2026-01-01T12:00:00Z",
  revision: 0,
};
const existing = {
  id: activityId,
  type: "customer_qbr",
  revision: 0,
  performed_by_user_id: "actor",
  payload: { summary: "Anterior" },
  performed_at: input.performed_at,
};
function call(remove = false, body: unknown = remove ? { revision: 0 } : input) {
  return (remove ? DELETE : PATCH)(
    new NextRequest("http://localhost/api/activity", {
      method: remove ? "DELETE" : "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id, activityId }) },
  );
}
function setup(data: unknown = existing, count = 1) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    then: (resolve: (value: { count: number; error: null }) => unknown) =>
      Promise.resolve({ count, error: null }).then(resolve),
  };
  const contact = {
    ...q,
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { id, is_anonymized: false, is_merged_into: null }, error: null }),
  };
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  m.db.mockResolvedValue({ from: (table: string) => (table === "contacts" ? contact : q), rpc });
  return { q, rpc };
}
beforeEach(() => {
  vi.clearAllMocks();
  m.support.mockResolvedValue(null);
  m.role.mockResolvedValue({
    ok: true,
    org: { orgId: "org", role: "agent" },
    user: { id: "actor" },
  });
  m.audit.mockResolvedValue(undefined);
});
it("preserva autor e registra estado anterior na auditoria", async () => {
  const { q } = setup();
  expect((await call()).status).toBe(200);
  expect(q.update).toHaveBeenCalledWith(
    expect.objectContaining({ revision: 1, edited_by_user_id: "actor" }),
    { count: "exact" },
  );
  expect(q.update.mock.calls[0][0]).not.toHaveProperty("performed_by_user_id");
  expect(m.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({
        previous: expect.objectContaining({ payload: { summary: "Anterior" } }),
      }),
    }),
  );
});
it("agente não altera atividade de outra pessoa", async () => {
  const { q, rpc } = setup({ ...existing, performed_by_user_id: "other" });
  expect((await call()).status).toBe(403);
  expect(q.update).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
it("gestor pode corrigir atividade da equipe", async () => {
  setup({ ...existing, performed_by_user_id: "other" });
  m.role.mockResolvedValue({
    ok: true,
    org: { orgId: "org", role: "manager" },
    user: { id: "actor" },
  });
  expect((await call()).status).toBe(200);
});
it("recusa versão desatualizada e concorrência", async () => {
  setup({ ...existing, revision: 1 });
  expect((await call()).status).toBe(409);
  setup(existing, 0);
  expect((await call()).status).toBe(409);
});
it("exclui por operação restrita e recusa identidade enviada", async () => {
  const { q, rpc } = setup();
  expect((await call(true)).status).toBe(200);
  expect(q.update).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("fn_delete_customer_activity", {
    p_id: activityId,
    p_contact: id,
    p_org: "org",
    p_revision: 0,
  });
  expect((await call(true, { revision: 0, organization_id: "other" })).status).toBe(422);
});
it("bloqueia modo somente leitura antes de acessar banco", async () => {
  m.support.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await call()).status).toBe(403);
  expect(m.db).not.toHaveBeenCalled();
});
