/**
 * GET/POST /api/v1/cron/cs-sinais — recalcula os sinais de CS de toda
 * organização com clientes acompanhados e tira a fotografia do dia.
 *
 * Sem isto, um sinal só nasceria quando alguém abrisse a Central — e "ninguém
 * abriu" seria indistinguível de "está tudo em dia". Agendado no `scheduler`
 * (docker/scheduler/entrypoint.sh) e em `vercel.ts`, a cada hora.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET | INTERNAL_SECRET, fail-closed.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { recalcularSinais } from "@/lib/cs/sinais";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ORG_LIMIT = 200;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("contacts")
    .select("organization_id")
    .or("cs_phase.not.is.null,gestao_account_id.not.is.null")
    .is("is_merged_into", null)
    .limit(50000);
  if (error) {
    logger.error("[cs-sinais] listagem falhou", { requestId, error: error.message });
    return fail("internal_error", "Failed to list organizations.", 500, { requestId });
  }
  const orgs = [...new Set((rows ?? []).map((r) => r.organization_id as string))].slice(0, ORG_LIMIT);

  let abertos = 0;
  let resolvidos = 0;
  const comErro: string[] = [];
  for (const org of orgs) {
    try {
      const r = await recalcularSinais(admin, org);
      abertos += r.abertos;
      resolvidos += r.resolvidos;
    } catch (e) {
      // Uma org que falha não congela as outras.
      comErro.push(org);
      logger.error("[cs-sinais] org falhou", {
        requestId,
        organizationId: org,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  // Rodada sem efeito não é mutação de usuário: não audita (doutrina do audit log).
  return ok({ organizacoes: orgs.length, abertos, resolvidos, com_erro: comErro.length }, { requestId });
}

export const GET = handle;
export const POST = handle;
