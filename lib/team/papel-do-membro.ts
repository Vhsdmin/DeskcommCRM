/**
 * O PAPEL de quem está na equipe (`user_organizations.role`).
 *
 * ⚠️ MESMAS REGRAS DE `app/api/v1/team/[user_id]/_shared.ts`: membro revogado
 * não muda; o último admin não é rebaixado; quem deixa de ser admin perde os
 * acessos por módulo que tinha (eram concedidos pelo papel). A rota continua
 * com a cópia dela por ser presa ao `NextRequest`; a regra de negócio é esta.
 *
 * ⚠️ POR QUE SÓ O PAPEL. Convidar está desligado no produto
 * (`CONVITES_DE_EQUIPE_ATIVOS = false`) e criar usuário recebe uma senha, que
 * cairia nos argumentos auditados da chamada. Essas duas ficam na tela.
 */
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { atorParaAuditoria } from "@/lib/operacao/autoria";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";
import { changeRoleSchema } from "@/lib/schemas/team";

export interface PapelAlterado {
  user_id: string;
  role: string;
  previous_role: string;
  acessos_redefinidos: boolean;
}

export async function alterarPapelDoMembro(
  deps: DepsDaOperacao,
  input: { userId: string; role: unknown },
): Promise<PapelAlterado> {
  const parsed = changeRoleSchema.safeParse({ role: input.role });
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsed.error.flatten() as unknown as Record<string, unknown>,
      deps.requestId,
      "Papel inválido. Use viewer, agent, manager ou admin.",
    );
  }
  const { data: alvo, error: fetchErr } = await deps.supabase
    .from("user_organizations")
    .select("id, user_id, role, revoked_at")
    .eq("organization_id", deps.organizationId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (fetchErr) throw new ApiError(500, "internal_error", undefined, deps.requestId, fetchErr.message);
  if (!alvo) throw new ApiError(404, "not_found", undefined, deps.requestId, "Membro não encontrado.");
  const membro = alvo as unknown as { id: string; user_id: string; role: string; revoked_at: string | null };
  if (membro.revoked_at) {
    throw new ApiError(409, "state_conflict", undefined, deps.requestId, "Membro está revogado.");
  }
  const rebaixaAdmin = membro.role === "admin" && parsed.data.role !== "admin";
  if (rebaixaAdmin) {
    const { count, error: countErr } = await deps.supabase
      .from("user_organizations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", deps.organizationId)
      .eq("role", "admin")
      .is("revoked_at", null);
    if (countErr) throw new ApiError(500, "internal_error", undefined, deps.requestId, countErr.message);
    if ((count ?? 0) <= 1) {
      throw new ApiError(
        409,
        "state_conflict",
        undefined,
        deps.requestId,
        "Não é possível rebaixar o último admin da organização.",
      );
    }
  }
  const { error: updErr } = await deps.supabase
    .from("user_organizations")
    .update({
      role: parsed.data.role,
      ...(rebaixaAdmin ? { module_access: [] as string[] } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", membro.id)
    .eq("organization_id", deps.organizationId);
  if (updErr) throw new ApiError(500, "internal_error", undefined, deps.requestId, updErr.message);
  await audit({
    action: "team.role_changed",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "membership",
    resourceId: membro.id,
    requestId: deps.requestId,
    metadata: {
      target_user_id: input.userId,
      old_role: membro.role,
      new_role: parsed.data.role,
      ...(rebaixaAdmin ? { acessos_redefinidos: true } : {}),
      actor_type: deps.actor.type,
    },
  });
  return {
    user_id: input.userId,
    role: parsed.data.role,
    previous_role: membro.role,
    acessos_redefinidos: rebaixaAdmin,
  };
}
