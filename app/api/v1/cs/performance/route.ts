import { randomUUID } from "node:crypto";
import { dashboardQuery, windowUtc } from "@/lib/cs/dashboard";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ok, fail } from "@/lib/api/wrappers";
export async function GET(req: Request) {
  const requestId = randomUUID();
  const parsed = dashboardQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success)
    return fail("validation_failed", "Confira o período e os filtros.", 422, { requestId });
  const auth = await requireRole("viewer", { requestId, resource: "metrics" });
  if (!auth.ok) return auth.response;
  const q = parsed.data,
    window = windowUtc(q.from, q.to),
    db = await createClient();
  const result = await db.rpc("fn_cs_performance", {
    p_org: auth.org.orgId,
    p_from: window.from,
    p_to: window.to,
    p_owner: q.owner ?? null,
    p_silence: q.silence,
    p_focus: q.focus,
    p_offset: q.offset,
  });
  if (result.error)
    return fail(
      result.error.code === "42501" ? "forbidden" : "internal_error",
      result.error.code === "42501"
        ? "Você pode consultar apenas seu desempenho."
        : "Não foi possível carregar o desempenho CS.",
      result.error.code === "42501" ? 403 : 500,
      { requestId },
    );
  return ok(result.data, { requestId, headers: { "Cache-Control": "no-store" } });
}
