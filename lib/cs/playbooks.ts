/**
 * Playbooks de CS (migration 0275): a sequência de tarefas que cada tipo de
 * sinal dispara enquanto está aberto.
 *
 * O banco executa (`fn_cs_aplicar_playbooks`, chamada no recálculo dos sinais);
 * aqui mora o formato dos passos — validado na única porta de escrita — e os
 * modelos sugeridos que a tela oferece para começar.
 */
import { z } from "zod";

import { SEVERIDADES, type TipoDeSinal } from "@/lib/cs/sinais";

/** `tarefa_vencida` fica de fora: tarefa gerando tarefa. */
export const TIPOS_COM_PLAYBOOK = [
  "mudanca_de_faixa",
  "sem_venda",
  "detrator_sem_retorno",
  "onboarding_parado",
  "sem_contato",
  "sem_responsavel",
] as const satisfies readonly TipoDeSinal[];
export type TipoComPlaybook = (typeof TIPOS_COM_PLAYBOOK)[number];

export const PRIORIDADES = ["low", "medium", "high", "urgent"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];
export const ROTULO_DA_PRIORIDADE: Record<Prioridade, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

export const passoSchema = z.object({
  chave: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/),
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().max(2000).nullish().transform((v) => v || null),
  dias: z.number().int().min(0).max(90),
  prioridade: z.enum(PRIORIDADES),
  severidade_minima: z.enum(SEVERIDADES),
  responsavel_user_id: z.string().uuid().nullable(),
});
export type PassoDoPlaybook = z.infer<typeof passoSchema>;

export const playbookSchema = z.object({
  ativo: z.boolean(),
  passos: z
    .array(passoSchema)
    .max(10)
    .superRefine((passos, ctx) => {
      const chaves = passos.map((p) => p.chave);
      if (new Set(chaves).size !== chaves.length) {
        ctx.addIssue({ code: "custom", message: "Cada passo precisa de uma chave diferente." });
      }
    }),
});
export type Playbook = z.infer<typeof playbookSchema>;

/** Chave estável de um passo novo: é ela que impede a mesma tarefa de nascer duas vezes. */
export function novaChave(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const passo = (
  chave: string,
  titulo: string,
  dias: number,
  prioridade: Prioridade,
  severidade_minima: PassoDoPlaybook["severidade_minima"] = "media",
  descricao: string | null = null,
): PassoDoPlaybook => ({ chave, titulo, descricao, dias, prioridade, severidade_minima, responsavel_user_id: null });

/** Ponto de partida sugerido; nada é gravado até quem administra salvar. */
export const PLAYBOOK_SUGERIDO: Record<TipoComPlaybook, PassoDoPlaybook[]> = {
  mudanca_de_faixa: [
    passo("apresentacao", "Ligação de apresentação como responsável da conta", 1, "high", "media",
      "Apresente-se como a nova responsável, entenda o momento do cliente e combine o próximo contato."),
    passo("alinhamento", "Reunião de alinhamento: objetivos e próximos passos", 7, "medium"),
  ],
  sem_venda: [
    passo("whatsapp", "Contato pelo WhatsApp: entender por que parou de vender", 0, "medium", "media"),
    passo("ligacao", "Ligação para o cliente", 1, "high", "alta"),
    passo("escalar", "Escalar para o head de CS", 0, "urgent", "critica",
      "30 dias sem vender. Registre o que já foi tentado e defina o plano com o head."),
  ],
  detrator_sem_retorno: [
    passo("retorno", "Retornar ao detrator e registrar o motivo da nota", 1, "urgent", "media"),
  ],
  onboarding_parado: [
    passo("ativacao", "Revisar o checklist de ativação com o cliente", 2, "high"),
  ],
  sem_contato: [
    passo("relacionamento", "Contato de relacionamento", 3, "medium", "media"),
    passo("reuniao", "Agendar reunião de acompanhamento", 7, "high", "alta"),
  ],
  sem_responsavel: [],
};
