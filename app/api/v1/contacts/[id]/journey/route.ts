import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
const journeySchema = z
  .object({
    phase: z
      .enum(["entrada", "onboarding", "ativacao", "adocao", "expansao", "renovacao"])
      .nullable(),
    owner_user_id: z.uuid().nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "contacts" });
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const parsed = journeySchema.safeParse(await req.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success)
    return fail("validation_failed", "Confira a fase e o responsável.", 422, { requestId });
  const db = await createClient();
  const result = await db.rpc("fn_update_contact_cs", {
    p_org: auth.org.orgId,
    p_contact: id,
    p_phase: parsed.data.phase,
    p_owner: parsed.data.owner_user_id,
    p_revision: parsed.data.revision,
  });
  if (result.error)
    return fail(
      result.error.code === "42501" ? "forbidden" : "internal_error",
      "Não foi possível salvar a jornada.",
      result.error.code === "42501" ? 403 : 500,
      { requestId },
    );
  const status = result.data?.status;
  if (status === "not_found")
    return fail("not_found", "Cliente indisponível para alterações.", 404, { requestId });
  if (status === "conflict")
    return fail("conflict", "A jornada mudou. Atualize o cliente antes de salvar.", 409, {
      requestId,
    });
  if (status === "invalid_owner")
    return fail("validation_failed", "Escolha um responsável ativo da equipe.", 422, { requestId });
  if (status !== "saved")
    return fail("internal_error", "Não foi possível salvar a jornada.", 500, { requestId });
  await audit({
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    action: "contact.updated",
    resourceType: "contacts",
    resourceId: id,
    requestId,
    metadata: {
      operation: "customer.journey_updated",
      phase: parsed.data.phase,
      owner_user_id: parsed.data.owner_user_id,
      revision: result.data.revision,
    },
  });
  return ok(result.data, { requestId });
}
