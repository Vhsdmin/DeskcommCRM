import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ok, fail } from "@/lib/api/wrappers";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const query = z
    .object({ page: z.coerce.number().int().min(0).max(100000).default(0) })
    .strict()
    .safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!z.uuid().safeParse(id).success || !query.success)
    return fail("validation_failed", "Confira o funil.", 422, { requestId });
  const auth = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!auth.ok) return auth.response;
  const db = await createClient();
  const pipeline = await db
    .from("crm_pipelines")
    .select("id")
    .eq("id", id)
    .eq("organization_id", auth.org.orgId)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();
  if (pipeline.error)
    return fail("internal_error", "Não foi possível carregar a jornada.", 500, { requestId });
  if (!pipeline.data) return fail("not_found", "Funil indisponível.", 404, { requestId });
  const start = query.data.page * 100;
  const result = await db
    .from("contacts")
    .select("id,organization_id,name,display_name,cs_phase,cs_owner_user_id,cs_revision", {
      count: "exact",
    })
    .eq("organization_id", auth.org.orgId)
    .eq("is_anonymized", false)
    .is("is_merged_into", null)
    .not("cs_phase", "is", null)
    .order("id", { ascending: true })
    .range(start, start + 99);
  if (result.error)
    return fail("internal_error", "Não foi possível carregar a jornada.", 500, { requestId });
  return ok({ customers: result.data ?? [], total: result.count ?? 0 }, { requestId });
}
