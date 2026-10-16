/**
 * Vocabulário dos sinais de CS (migration 0273, regras `cs-sinais-v1`).
 *
 * A regra mora no banco (`fn_cs_sinais_candidatos`); aqui ficam só os rótulos,
 * a ordem de exibição e a chamada de recálculo — para a Central, o cron e quem
 * mais ler sinais falarem a mesma língua.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const TIPOS_DE_SINAL = [
  "sem_venda",
  "detrator_sem_retorno",
  "tarefa_vencida",
  "sem_contato",
  "onboarding_parado",
  "sem_responsavel",
] as const;
export type TipoDeSinal = (typeof TIPOS_DE_SINAL)[number];

export const SEVERIDADES = ["critica", "alta", "media"] as const;
export type Severidade = (typeof SEVERIDADES)[number];

export const ROTULO_DO_SINAL: Record<TipoDeSinal, { titulo: string; descricao: string }> = {
  sem_venda: { titulo: "Sem vender", descricao: "7 dias = média, 15 = alta, 30 = crítica" },
  detrator_sem_retorno: { titulo: "Detratores sem retorno", descricao: "NPS 0–6 sem atendimento depois" },
  tarefa_vencida: { titulo: "Tarefas vencidas", descricao: "Prazo passou e a tarefa segue aberta" },
  sem_contato: { titulo: "Sem contato", descricao: "Sem atendimento ou reunião há 30+ dias" },
  onboarding_parado: { titulo: "Onboarding parado", descricao: "Em Entrada/Onboarding há 14+ dias" },
  sem_responsavel: { titulo: "Sem responsável", descricao: "Na jornada sem CSM definido" },
};

export const ROTULO_DA_SEVERIDADE: Record<Severidade, string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Média",
};

/** Ordem de trabalho: severidade primeiro, depois o prazo mais próximo. */
export function compararSinais(
  a: { severidade: string; prazo: string },
  b: { severidade: string; prazo: string },
): number {
  const sa = SEVERIDADES.indexOf(a.severidade as Severidade);
  const sb = SEVERIDADES.indexOf(b.severidade as Severidade);
  if (sa !== sb) return sa - sb;
  return Date.parse(a.prazo) - Date.parse(b.prazo);
}

/** Recalcula os sinais de UMA organização. Só com o admin client (service_role). */
export async function recalcularSinais(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ abertos: number; resolvidos: number }> {
  const { data, error } = await admin.rpc("fn_cs_recalcular_sinais", { p_org: organizationId });
  if (error) throw new Error(error.message);
  return data as { abertos: number; resolvidos: number };
}
