import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ signIn: vi.fn(), fail: vi.fn(), audit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword: m.signIn } }),
}));
vi.mock("@/lib/audit", () => ({ audit: m.audit, hashEmail: () => "hash" }));
vi.mock("@/lib/auth/rate-limit", () => ({
  authRateLimited: async () => false,
  contaBloqueadaPorFalhas: async () => false,
  registrarFalhaDeLogin: m.fail,
  AUTH_LIMITS: { login: {} },
}));
import { signInWithPassword } from "@/app/actions/auth/signInWithPassword";
beforeEach(() => vi.clearAllMocks());
it("rede indisponível não informa senha errada nem incrementa bloqueio", async () => {
  m.signIn.mockResolvedValue({
    data: { user: null },
    error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" },
  });
  expect(
    await signInWithPassword({ email: "fixture@example.invalid", password: "Fixture#2026" }),
  ).toEqual({ ok: false, error: "service_unavailable" });
  expect(m.fail).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it("senha incorreta mantém contador e auditoria", async () => {
  m.signIn.mockResolvedValue({
    data: { user: null },
    error: { name: "AuthApiError", status: 400, message: "Invalid credentials" },
  });
  expect(
    await signInWithPassword({ email: "fixture@example.invalid", password: "Fixture#2026" }),
  ).toEqual({ ok: false, error: "invalid_credentials" });
  expect(m.fail).toHaveBeenCalledTimes(1);
  expect(m.audit).toHaveBeenCalledTimes(1);
});
