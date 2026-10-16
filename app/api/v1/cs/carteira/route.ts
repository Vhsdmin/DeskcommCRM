/**
 * GET /api/v1/cs/carteira — as faixas da carteira e os clientes acompanhados com
 * faixa atual, responsável, GMV de 30 dias e se subiram de faixa (aguardando
 * alguém assumir).
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { comFim } from "@/lib/cs/carteira";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!auth.ok) return auth.response;
  const orgId = auth.org.orgId;
  const db = await createClient();

  const [faixas, clientes, subidas] = await Promise.all([
    db
      .from("cs_carteira_faixas")
      .select("id, nome, inicio_centavos, tipo, responsavel_user_id")
      .eq("organization_id", orgId),
    db
      .from("contacts")
      .select("id, name, display_name, carteira_faixa_id, cs_owner_user_id, gestao_gmv_30d_centavos, gestao_gmv_30d_em, cs_phase")
      .eq("organization_id", orgId)
      .eq("is_anonymized", false)
      .is("is_merged_into", null)
      .or("cs_phase.not.is.null,gestao_account_id.not.is.null")
      .order("gestao_gmv_30d_centavos", { ascending: false, nullsFirst: false })
      .limit(1000),
    db
      .from("cs_sinais")
      .select("contact_id, evidencia, dono_user_id")
      .eq("organization_id", orgId)
      .eq("tipo", "mudanca_de_faixa")
      .is("resolvido_em", null),
  ]);
  if (faixas.error || clientes.error || subidas.error) {
    return fail("internal_error", "Não foi possível carregar a carteira.", 500, { requestId });
  }
  const pendentes = new Map(
    (subidas.data ?? []).map((s) => [
      s.contact_id as string,
      { faixa_nova: (s.evidencia as { faixa_nova?: string } | null)?.faixa_nova ?? null, dono_user_id: s.dono_user_id },
    ]),
  );
  return ok(
    {
      faixas: comFim(faixas.data ?? []),
      clientes: (clientes.data ?? []).map((c) => ({ ...c, subiu_de_faixa: pendentes.get(c.id as string) ?? null })),
    },
    { requestId, headers: { "Cache-Control": "no-store" } },
  );
}
