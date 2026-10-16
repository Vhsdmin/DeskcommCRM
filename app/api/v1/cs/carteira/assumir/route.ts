import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/cs/carteira/assumir — a CSM da faixa nova (ou um gestor) assume o
 * cliente que subiu de faixa. A regra mora em `fn_cs_assumir_cliente` (0274): só
 * sobe, registra no histórico do cliente e o alerta se resolve no recálculo
 * feito logo em seguida.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { recalcularSinais } from "@/lib/cs/sinais";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpo = z.object({ contact_id: z.string().uuid() }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "contacts" });
  if (!auth.ok) return auth.response;
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Cliente inválido.", 422, { requestId });

  const db = await createClient();
  const { data, error } = await db.rpc("fn_cs_assumir_cliente", {
    p_org: auth.org.orgId,
    p_contact: parsed.data.contact_id,
  });
  if (error) {
    if (error.code === "42501") {
      return fail("forbidden", "Só a responsável pela faixa nova (ou um gestor) pode assumir este cliente.", 403, { requestId });
    }
    return fail("internal_error", "Não foi possível assumir o cliente.", 500, { requestId });
  }
  const status = (data as { status?: string } | null)?.status;
  if (status === "not_found") return fail("not_found", "Cliente não encontrado.", 404, { requestId });
  if (status === "sem_faixas") return fail("state_conflict", "A carteira ainda não tem faixas configuradas.", 409, { requestId });
  if (status === "sem_mudanca") return fail("state_conflict", "Este cliente não subiu de faixa.", 409, { requestId });

  await audit({
    action: "cs.cliente_assumido",
    actorUserId: auth.user.id,
    organizationId: auth.org.orgId,
    resourceType: "contacts",
    resourceId: parsed.data.contact_id,
    requestId,
    metadata: { faixa: (data as { faixa?: string } | null)?.faixa ?? null },
  });
  try {
    await recalcularSinais(createAdminClient(), auth.org.orgId);
  } catch (err) {
    logger.error("[cs.carteira] recálculo após assumir falhou", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return ok({ assumido: true, faixa: (data as { faixa?: string } | null)?.faixa ?? null }, { requestId });
}
