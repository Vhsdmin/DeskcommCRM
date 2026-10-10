import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: m.role }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.db }));
import { GET } from "@/app/api/v1/pipelines/[id]/journey/route";
const id = "13e4e283-7c1f-4262-96b3-c79fd24c2f6c";
const call = (search = "") =>
  GET(new Request("http://localhost/api/v1/pipelines/" + id + "/journey" + search), {
    params: Promise.resolve({ id }),
  });
function query(result: unknown) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    range: vi.fn().mockResolvedValue(result),
  };
  return q;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ ok: true, org: { orgId: "active-org" }, user: { id: "actor" } });
});
describe("funil da jornada existente", () => {
  it("requer sessão e não aceita organização pela query", async () => {
    expect((await call("?organization_id=foreign")).status).toBe(422);
    expect(m.db).not.toHaveBeenCalled();
  });
  it("recusa funil fora da organização ou que não seja jornada padrão", async () => {
    const p = query({ data: null, error: null });
    m.db.mockResolvedValue({ from: () => p });
    expect((await call()).status).toBe(404);
    expect(p.eq).toHaveBeenCalledWith("organization_id", "active-org");
    expect(p.eq).toHaveBeenCalledWith("is_default", true);
  });
  it("lista clientes da sessão com fase, sem criar leads e pagina sem truncar em silêncio", async () => {
    const p = query({ data: { id }, error: null });
    const c = query({ data: [{ id: "customer", cs_phase: "entrada" }], count: 201, error: null });
    const from = vi.fn((table: string) => (table === "contacts" ? c : p));
    m.db.mockResolvedValue({ from });
    const r = await call("?page=1");
    expect(r.status).toBe(200);
    expect(c.eq).toHaveBeenCalledWith("organization_id", "active-org");
    expect(c.eq).toHaveBeenCalledWith("is_anonymized", false);
    expect(c.is).toHaveBeenCalledWith("is_merged_into", null);
    expect(c.not).toHaveBeenCalledWith("cs_phase", "is", null);
    expect(c.range).toHaveBeenCalledWith(100, 199);
    expect(from).not.toHaveBeenCalledWith("crm_leads");
    expect(await r.json()).toMatchObject({
      data: { total: 201, customers: [{ cs_phase: "entrada" }] },
    });
  });
  it("não expõe erros internos", async () => {
    m.db.mockResolvedValue({
      from: () => query({ data: null, error: { message: "private database detail" } }),
    });
    const r = await call();
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("private database detail");
  });
});
