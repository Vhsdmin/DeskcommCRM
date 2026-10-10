import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const m = vi.hoisted(() => ({ rpc: vi.fn(), admin: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/auth/rate-limit", () => ({ authRateLimited: m.limit }));
import { POST } from "@/app/api/v1/public/nps/route";
const token = "a".repeat(64);
const call = (body: unknown) =>
  POST(
    new Request("http://localhost/api/v1/public/nps", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.limit.mockResolvedValue(false);
  m.admin.mockReturnValue({ rpc: m.rpc });
  m.rpc.mockResolvedValue({
    data: { status: "saved", organization_id: "never expose" },
    error: null,
  });
});
it.each([-1, 11, 1.5])("recusa nota %s antes de alcançar banco", async (score) => {
  expect((await call({ action: "answer", token, score, comment: "" })).status).toBe(422);
  expect(m.admin).not.toHaveBeenCalled();
});
it("recusa token inválido e identidade/organização enviados no body", async () => {
  for (const body of [
    { action: "status", token: "invalid" },
    { action: "status", token, organization_id: "foreign" },
  ])
    expect((await call(body)).status).toBe(422);
  expect(m.admin).not.toHaveBeenCalled();
});
it("aceita zero sem cookie e passa somente hash à RPC, sem expor dados da linha", async () => {
  const r = await call({ action: "answer", token, score: 0, comment: "Comentário" });
  expect(r.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("fn_public_customer_nps", {
    p_hash: createHash("sha256").update(token).digest("hex"),
    p_score: 0,
    p_comment: "Comentário",
  });
  const response = await r.text();
  expect(response).not.toContain(token);
  expect(response).not.toContain("organization_id");
  expect(r.headers.get("Cache-Control")).toBe("no-store");
});
it("verifica estado do link sem ler resposta anterior", async () => {
  m.rpc.mockResolvedValue({
    data: { status: "answered", score: 9, comment: "private" },
    error: null,
  });
  const r = await call({ action: "status", token });
  expect(await r.json()).toMatchObject({ data: { status: "answered" } });
  expect(m.rpc).toHaveBeenCalledWith(
    "fn_public_customer_nps",
    expect.objectContaining({ p_score: null, p_comment: null }),
  );
});
it("limita tentativas antes do banco", async () => {
  m.limit.mockResolvedValue(true);
  expect((await call({ action: "status", token })).status).toBe(429);
  expect(m.admin).not.toHaveBeenCalled();
});
it("não expõe erro do banco", async () => {
  m.rpc.mockResolvedValue({ error: { message: "private database" } });
  const r = await call({ action: "status", token });
  expect(r.status).toBe(500);
  expect(await r.text()).not.toContain("private database");
});

it("só dispensa sessão nas duas URLs públicas exatas", async () => {
  const { isPublicPath } = await import("@/lib/auth/public-paths");
  expect(isPublicPath("/pesquisa/nps")).toBe(true);
  expect(isPublicPath("/api/v1/public/nps")).toBe(true);
  expect(isPublicPath("/api/v1/public/nps/export")).toBe(false);
  expect(isPublicPath("/api/v1/contacts/70b96720-17b5-44ba-9ab2-19750677f90e/nps")).toBe(false);
});
