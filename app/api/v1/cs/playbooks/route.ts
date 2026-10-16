/**
 * GET /api/v1/cs/playbooks — o playbook de cada tipo de sinal (os não
 * configurados vêm vazios e inativos) e quantas tarefas cada um tem em aberto.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { TIPOS_COM_PLAYBOOK, type PassoDoPlaybook } from "@/lib/cs/playbooks";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!auth.ok) return auth.response;
  const orgId = auth.org.orgId;
  const db = await createClient();

  const [playbooks, abertas] = await Promise.all([
    db
      .from("cs_playbooks")
      .select("tipo_sinal, ativo, passos, atualizado_em, atualizado_por")
      .eq("organization_id", orgId),
    db
      .from("crm_tasks")
      .select("cs_sinal_id, cs_sinais!inner(tipo)")
      .eq("organization_id", orgId)
      .not("cs_sinal_id", "is", null)
      .in("status", ["pending", "in_progress"])
      .limit(5000),
  ]);
  if (playbooks.error) return fail("internal_error", "Não foi possível carregar os playbooks.", 500, { requestId });

  const porTipo = new Map((playbooks.data ?? []).map((p) => [p.tipo_sinal as string, p]));
  const tarefasAbertas = new Map<string, number>();
  for (const t of (abertas.data ?? []) as unknown as Array<{ cs_sinais: { tipo: string } | null }>) {
    const tipo = t.cs_sinais?.tipo;
    if (tipo) tarefasAbertas.set(tipo, (tarefasAbertas.get(tipo) ?? 0) + 1);
  }

  return ok(
    {
      playbooks: TIPOS_COM_PLAYBOOK.map((tipo) => {
        const p = porTipo.get(tipo);
        return {
          tipo_sinal: tipo,
          configurado: Boolean(p),
          ativo: p?.ativo ?? false,
          passos: (p?.passos ?? []) as PassoDoPlaybook[],
          atualizado_em: p?.atualizado_em ?? null,
          tarefas_abertas: tarefasAbertas.get(tipo) ?? 0,
        };
      }),
    },
    { requestId },
  );
}
