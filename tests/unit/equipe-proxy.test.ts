import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
const h = vi.hoisted(() => ({ getUser: vi.fn(), memberships: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test" },
}));
vi.mock("@/lib/supabase/fetch", () => ({ supabaseFetch: vi.fn() }));
vi.mock("@/lib/supabase/cookie-secure", () => ({ cookieSecure: () => false }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      then: (resolve: (v: unknown) => unknown) => h.memberships().then(resolve),
    };
    return { auth: { getUser: h.getUser }, from: () => chain };
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.getUser.mockResolvedValue({ data: { user: { id: "user" } } });
  h.memberships.mockResolvedValue({
    data: [{ organization_id: "org", role: "agent", module_access: ["/app/tasks"] }],
    error: null,
  });
});
describe("gate real do proxy", () => {
  it("recusa URL e API de módulo não autorizado", async () => {
    expect(
      (await proxy(new NextRequest("http://localhost/app/contacts"))).headers.get("location"),
    ).toBe("http://localhost/403");
    expect((await proxy(new NextRequest("http://localhost/api/v1/team/users"))).status).toBe(403);
  });
  it("sobrescreve o pathname falso antes de encaminhar a requisição", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/app/tasks", { headers: { "x-pathname": "/app/team" } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe("/app/tasks");
  });
  it("inclui rotas duais com cookie no mesmo bloqueio", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/api/v1/contacts", {
        headers: { cookie: "sb-deskcomm-auth.0=test" },
      }),
    );
    expect(response.status).toBe(403);
  });
  it("nega em falha de consulta de permissões", async () => {
    h.memberships.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect((await proxy(new NextRequest("http://localhost/app/tasks"))).status).toBe(503);
  });
  it("preserva a autenticação própria de webhooks e integrações sem cookie", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/api/v1/contacts", {
        headers: { authorization: "Bearer tok_test" },
      }),
    );
    expect(response.status).toBe(200);
    expect(h.getUser).not.toHaveBeenCalled();
  });
});
