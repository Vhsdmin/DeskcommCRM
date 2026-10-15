/**
 * GET /api/v1/cs/central?escopo=meus|equipe — a Central de Prioridades.
 *
 * Recalcula os sinais da organização (a regra é do banco, `cs-sinais-v1`) e
 * devolve os abertos, na ordem de trabalho. O recálculo aqui garante que o que
 * o CSM acabou de fazer (registrar atendimento, concluir tarefa) já tire o sinal
 * da lista; o cron `cs-sinais` mantém tudo em dia e tira a fotografia diária
 * mesmo quando ninguém abre a tela.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { compararSinais, recalcularSinais } from "@/lib/cs/sinais";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const query = z.object({ escopo: z.enum(["meus", "equipe"]).default("meus") }).strict();

export async function GET(req: Request): Promise<Response> {
  const requestId = randomUUID();
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return fail("validation_failed", "Filtro inválido.", 422, { requestId });
  const auth = await requireRole("viewer", { requestId, resource: "metrics" });
  if (!auth.ok) return auth.response;
  const orgId = auth.org.orgId;

  const admin = createAdminClient();
  try {
    await recalcularSinais(admin, orgId);
  } catch (err) {
    // Falha no recálculo não esconde a Central: mostra o último estado gravado.
    logger.error("[cs.central] recálculo falhou", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const db = await createClient();
  let consulta = db
    .from("cs_sinais")
    .select(
      "id, contact_id, tipo, severidade, motivo, evidencia, dono_user_id, prazo, detectado_em, contacts!cs_sinais_contact_id_fkey(name, display_name, cs_phase)",
    )
    .eq("organization_id", orgId)
    .is("resolvido_em", null);
  if (parsed.data.escopo === "meus") consulta = consulta.eq("dono_user_id", auth.user.id);
  const [{ data, error }, vendas] = await Promise.all([
    consulta.limit(1000),
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .not("gestao_ultima_venda_em", "is", null),
  ]);
  if (error) return fail("internal_error", "Não foi possível carregar a Central.", 500, { requestId });

  const sinais = [...(data ?? [])].sort(compararSinais);
  return ok(
    {
      sinais,
      vendas_conectadas: (vendas.count ?? 0) > 0,
      escopo: parsed.data.escopo,
      atualizado_em: new Date().toISOString(),
    },
    { requestId, headers: { "Cache-Control": "no-store" } },
  );
}
