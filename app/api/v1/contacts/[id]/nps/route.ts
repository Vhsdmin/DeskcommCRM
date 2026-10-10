import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { NPS_SURVEY_COLUMNS } from "@/lib/contacts/nps";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Context) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success)
    return fail("validation_failed", "Cliente inválido.", 422, { requestId });
  const auth = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!auth.ok) return auth.response;
  const db = await createClient();
  const r = await db
    .from("customer_nps_surveys")
    .select(NPS_SURVEY_COLUMNS)
    .eq("organization_id", auth.org.orgId)
    .eq("contact_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (r.error)
    return fail("internal_error", "Não foi possível carregar o NPS.", 500, { requestId });
  return ok({ surveys: r.data ?? [], as_of: new Date().toISOString() }, { requestId });
}
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }).strict(),
  z.object({ action: z.literal("cancel"), survey_id: z.uuid() }).strict(),
]);
export async function POST(req: Request, ctx: Context) {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !body.success)
    return fail("validation_failed", "Confira a pesquisa.", 422, { requestId });
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const auth = await requireRole("agent", { requestId, resource: "contacts" });
  if (!auth.ok) return auth.response;
  const token = body.data.action === "create" ? randomBytes(32).toString("hex") : null;
  const db = await createClient();
  const r = await db.rpc("fn_manage_customer_nps", {
    p_org: auth.org.orgId,
    p_contact: id,
    p_action: body.data.action,
    p_hash: token ? createHash("sha256").update(token).digest("hex") : null,
    p_survey: body.data.action === "cancel" ? body.data.survey_id : null,
  });
  if (r.error)
    return fail(
      r.error.code === "42501" ? "forbidden" : "internal_error",
      r.error.code === "42501"
        ? "Somente o criador ou um gestor pode substituir ou cancelar um link pendente."
        : "Não foi possível alterar a pesquisa.",
      r.error.code === "42501" ? 403 : 500,
      { requestId },
    );
  if (r.data?.status === "not_found")
    return fail("not_found", "Pesquisa ou cliente indisponível.", 404, { requestId });
  if (r.data?.status === "conflict")
    return fail("conflict", "A pesquisa já foi respondida ou cancelada. Atualize a ficha.", 409, {
      requestId,
    });
  if (r.data?.status !== "saved")
    return fail("internal_error", "Não foi possível alterar a pesquisa.", 500, { requestId });
  await audit({
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    action: "contact.updated",
    resourceType: "contacts",
    resourceId: id,
    requestId,
    metadata: {
      operation: body.data.action === "create" ? "customer.nps_created" : "customer.nps_cancelled",
      survey_id: r.data.id,
    },
  });
  return ok({ ...r.data, ...(token ? { path: `/pesquisa/nps#${token}` } : {}) }, { requestId });
}
