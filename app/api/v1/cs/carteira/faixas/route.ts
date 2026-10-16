import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PUT /api/v1/cs/carteira/faixas — substitui o conjunto de faixas da carteira
 * (gestor). Faixa removida deixa seus clientes sem faixa; o próximo recálculo os
 * coloca na faixa do GMV. Depois de salvar, recalcula os sinais da organização.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { faixasSchema } from "@/lib/cs/carteira";
import { recalcularSinais } from "@/lib/cs/sinais";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("manager", { requestId, resource: "contacts" });
  if (!auth.ok) return auth.response;
  const orgId = auth.org.orgId;

  const parsed = faixasSchema.safeParse((await req.json().catch(() => null))?.faixas);
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Faixas inválidas.", 422, { requestId });
  }
  const db = await createClient();

  // Responsáveis precisam ser membros ativos da organização.
  const responsaveis = [...new Set(parsed.data.map((f) => f.responsavel_user_id).filter(Boolean))] as string[];
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

  const { data: atuais, error: erroAtuais } = await db
    .from("cs_carteira_faixas")
    .select("id")
    .eq("organization_id", orgId);
  if (erroAtuais) return fail("internal_error", "Não foi possível salvar as faixas.", 500, { requestId });
  const manter = new Set(parsed.data.map((f) => f.id).filter(Boolean));
  const remover = (atuais ?? []).map((f) => f.id as string).filter((id) => !manter.has(id));

  // Remove primeiro (libera os inícios) e grava depois; a unicidade do início
  // por organização segura o resto. Início temporário negativo não é aceito pelo
  // CHECK, então trocas de início entre faixas existentes passam pelo delete.
  if (remover.length > 0) {
    const { error } = await db.from("cs_carteira_faixas").delete().eq("organization_id", orgId).in("id", remover);
    if (error) return fail("internal_error", "Não foi possível salvar as faixas.", 500, { requestId });
  }
  for (const f of parsed.data) {
    const linha = {
      organization_id: orgId,
      nome: f.nome,
      inicio_centavos: f.inicio_centavos,
      tipo: f.tipo,
      responsavel_user_id: f.responsavel_user_id,
    };
    const { error } = f.id
      ? await db.from("cs_carteira_faixas").update(linha).eq("organization_id", orgId).eq("id", f.id)
      : await db.from("cs_carteira_faixas").insert(linha);
    if (error) {
      const msg = error.code === "23505" ? "Duas faixas não podem começar no mesmo valor." : "Não foi possível salvar as faixas.";
      return fail(error.code === "23505" ? "validation_failed" : "internal_error", msg, error.code === "23505" ? 422 : 500, { requestId });
    }
  }

  await audit({
    action: "cs.carteira_faixas_atualizadas",
    actorUserId: auth.user.id,
    organizationId: orgId,
    resourceType: "cs_carteira_faixas",
    requestId,
    metadata: { faixas: parsed.data.map((f) => ({ nome: f.nome, inicio_centavos: f.inicio_centavos, tipo: f.tipo })) },
  });
  try {
    await recalcularSinais(createAdminClient(), orgId);
  } catch (err) {
    logger.error("[cs.carteira] recálculo após salvar faixas falhou", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return ok({ salvo: true }, { requestId });
}
