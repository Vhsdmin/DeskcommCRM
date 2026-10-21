import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { acessosSchema, acessosValidos } from "@/lib/auth/acessos";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/lib/auth/types";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ user_id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "team" });
  if (!auth.ok) return auth.response;
  const { user_id } = await ctx.params;
  const parsed = z
    .object({ acessos: acessosSchema })
    .strict()
    .safeParse(await req.json().catch(() => null));
  if (!z.uuid().safeParse(user_id).success || !parsed.success)
    return fail("validation_error", "Acessos inválidos.", 400, { requestId });
  if (user_id === auth.user.id)
    return fail("forbidden", "Você não pode restringir seu próprio acesso.", 403, { requestId });
  const db = await createClient();
  const { data: member, error: readError } = await db
    .from("user_organizations")
    .select("id, role")
    .eq("organization_id", auth.org.orgId)
    .eq("user_id", user_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (readError)
    return fail("internal_error", "Não foi possível consultar o membro.", 500, { requestId });
  if (!member) return fail("not_found", "Membro ativo não encontrado.", 404, { requestId });
  if (member.role === "admin")
    return fail(
      "validation_error",
      "Administradores têm acesso completo. Altere o papel antes de restringir áreas.",
      400,
      { requestId },
    );
  if (!acessosValidos(parsed.data.acessos, member.role as Role))
    return fail("validation_error", "Há acessos incompatíveis com o papel.", 400, { requestId });
  const { data: saved, error } = await db
    .from("user_organizations")
    .update({ module_access: parsed.data.acessos })
    .eq("id", member.id)
    .eq("organization_id", auth.org.orgId)
    .eq("role", member.role)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error)
    return fail("internal_error", "Não foi possível salvar os acessos.", 500, { requestId });
  if (!saved)
    return fail("conflict", "O vínculo mudou. Atualize e tente novamente.", 409, { requestId });
  void audit({
    action: "team.access_changed",
    actorUserId: auth.user.id,
    organizationId: auth.org.orgId,
    resourceType: "membership",
    resourceId: member.id,
    requestId,
    metadata: { user_id, acessos: parsed.data.acessos },
  });
  return ok({ user_id, acessos: parsed.data.acessos }, { requestId });
}
