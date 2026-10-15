import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: m.auth }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc }) }));
import { GET as nps } from "@/app/api/v1/cs/nps/route";
import { GET as performance } from "@/app/api/v1/cs/performance/route";
import { presetDates, windowUtc } from "@/lib/cs/dashboard";
const org = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ ok: true, user: { id: "actor" }, org: { orgId: org, role: "admin" } });
  m.rpc.mockResolvedValue({ data: { summary: { total: 1011 }, rows: [] }, error: null });
});
const req = (q = "from=2026-10-01&to=2026-10-12") =>
  new Request(`http://localhost/api/v1/cs/nps?${q}`);
it.each([
  "from=bad&to=2026-01-01",
  "from=2026-02-30&to=2026-03-01",
  "from=2026-10-13&to=2026-10-12",
  "from=2023-01-01&to=2026-01-01",
  "from=2026-01-01&to=2026-01-02&offset=-1",
  "from=2026-01-01&to=2026-01-02&status=bad",
  "from=2026-01-01&to=2026-01-02&organization_id=foreign",
])("rejeita consulta inválida %s", async (q) => {
  expect((await nps(req(q))).status).toBe(422);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("período civil inclui dia final no fuso sem deslocar data", () => {
  expect(windowUtc("2026-10-12", "2026-10-12")).toEqual({
    from: "2026-10-12T00:00:00-03:00",
    to: "2026-10-13T00:00:00-03:00",
  });
  expect(presetDates(30, new Date("2026-10-13T01:00:00Z"))).toEqual({
    from: "2026-09-13",
    to: "2026-10-12",
  });
});
it("passa org da sessão, filtros e paginação; totais não são derivados da página", async () => {
  const r = await nps(
    req("from=2026-10-01&to=2026-10-12&status=answered&category=detractor&offset=25"),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("Cache-Control")).toBe("no-store");
  expect((await r.json()).data.summary.total).toBe(1011);
  expect(m.rpc).toHaveBeenCalledWith("fn_cs_nps_dashboard", {
    p_org: org,
    p_from: "2026-10-01T00:00:00-03:00",
    p_to: "2026-10-13T00:00:00-03:00",
    p_status: "answered",
    p_class: "detractor",
    p_offset: 25,
    p_owner: null,
  });
});
it.each([nps, performance])("falha fechada sem sessão", async (handler) => {
  m.auth.mockResolvedValue({ ok: false, response: new Response("", { status: 401 }) });
  expect((await handler(req())).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("não expõe SQL/erro interno", async () => {
  m.rpc.mockResolvedValue({ error: { code: "XX", message: "private schema SQL" }, data: null });
  const r = await nps(req());
  expect(r.status).toBe(500);
  expect(await r.text()).not.toContain("private schema");
});
it("desempenho usa janela e critérios explícitos e recusa acesso alheio", async () => {
  m.rpc.mockResolvedValue({ error: { code: "42501" }, data: null });
  expect(
    (await performance(req("from=2026-10-01&to=2026-10-12&silence=14&focus=detractor"))).status,
  ).toBe(403);
  expect(m.rpc).toHaveBeenCalledWith(
    "fn_cs_performance",
    expect.objectContaining({ p_org: org, p_silence: 14, p_focus: "detractor" }),
  );
});
