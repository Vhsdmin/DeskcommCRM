import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PUT /api/v1/cs/playbooks/[tipo] — grava o playbook de um tipo de sinal
 * (gestor). Em seguida recalcula os sinais: os passos já valem para os sinais
 * abertos agora, e um playbook desligado deixa de criar tarefas (as já criadas
 * seguem com quem as recebeu).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { TIPOS_COM_PLAYBOOK, playbookSchema, type TipoComPlaybook } from "@/lib/cs/playbooks";
import { recalcularSinais } from "@/lib/cs/sinais";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ tipo: string }> }): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("manager", { requestId, resource: "contacts" });
  if (!auth.ok) return auth.response;
  const orgId = auth.org.orgId;

  const { tipo } = await ctx.params;
  if (!TIPOS_COM_PLAYBOOK.includes(tipo as TipoComPlaybook)) {
    return fail("not_found", "Este tipo de alerta não tem playbook.", 404, { requestId });
  }
  const parsed = playbookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Playbook inválido.", 422, { requestId });
  }
  const db = await createClient();

  // Responsável fixo de um passo precisa ser membro ativo da organização.
  const responsaveis = [
    ...new Set(parsed.data.passos.map((p) => p.responsavel_user_id).filter(Boolean)),
  ] as string[];
  if (responsaveis.length > 0) {
    const { data: membros } = await db
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", orgId)
      .is("revoked_at", null)
      .in("user_id", responsaveis);
    const validos = new Set((membros ?? []).map((m) => m.user_id as string));
    if (responsaveis.some((r) => !validos.has(r))) {
      return fail("validation_failed", "Escolha responsáveis que fazem parte da equipe.", 422, { requestId });
    }
  }

  const { error } = await db.from("cs_playbooks").upsert(
    {
      organization_id: orgId,
      tipo_sinal: tipo,
      ativo: parsed.data.ativo,
      passos: parsed.data.passos,
      atualizado_por: auth.user.id,
    },
    { onConflict: "organization_id,tipo_sinal" },
  );
  if (error) return fail("internal_error", "Não foi possível salvar o playbook.", 500, { requestId });

  await audit({
    action: "cs.playbook_atualizado",
    actorUserId: auth.user.id,
    organizationId: orgId,
    resourceType: "cs_playbooks",
    requestId,
    metadata: {
      tipo_sinal: tipo,
      ativo: parsed.data.ativo,
      passos: parsed.data.passos.map((p) => ({ chave: p.chave, dias: p.dias, severidade_minima: p.severidade_minima })),
    },
  });
  try {
    await recalcularSinais(createAdminClient(), orgId);
  } catch (err) {
    logger.error("[cs.playbooks] recálculo após salvar playbook falhou", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return ok({ salvo: true }, { requestId });
}
