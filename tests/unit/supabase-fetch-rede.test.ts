import { afterEach, expect, it, vi } from "vitest";
import { supabaseFetch } from "@/lib/supabase/fetch";
afterEach(() => vi.unstubAllGlobals());
it("recupera leitura após fetch failed, sem cache", async () => {
  const f = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockResolvedValueOnce(new Response("{}"));
  vi.stubGlobal("fetch", f);
  expect((await supabaseFetch("https://example.invalid/auth/v1/user")).status).toBe(200);
  expect(f).toHaveBeenCalledTimes(2);
  expect(f).toHaveBeenLastCalledWith(expect.anything(), { cache: "no-store" });
});
it("segunda falha permanece falha, sem loop", async () => {
  const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  vi.stubGlobal("fetch", f);
  await expect(supabaseFetch("https://example.invalid/auth/v1/user")).rejects.toThrow(
    "fetch failed",
  );
  expect(f).toHaveBeenCalledTimes(2);
});
it.each(["POST", "PATCH", "DELETE"])("não repete %s com falha", async (method) => {
  const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  vi.stubGlobal("fetch", f);
  await expect(supabaseFetch("https://example.invalid", { method })).rejects.toThrow();
  expect(f).toHaveBeenCalledTimes(1);
});
it("não repete HTTP 401 ou credencial rejeitada", async () => {
  const f = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", f);
  expect((await supabaseFetch("https://example.invalid")).status).toBe(401);
  expect(f).toHaveBeenCalledTimes(1);
});
it("não repete cancelamento explícito", async () => {
  const c = new AbortController();
  c.abort();
  const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  vi.stubGlobal("fetch", f);
  await expect(supabaseFetch("https://example.invalid", { signal: c.signal })).rejects.toThrow();
  expect(f).toHaveBeenCalledTimes(1);
});
