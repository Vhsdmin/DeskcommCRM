/**
 * Os TIPOS DE ATENDIMENTO da agenda (`calendar_event_types`): o schema dos
 * campos, o slug estável e a criação.
 *
 * ⚠️ POR QUE SAIU DA ROTA. `app/api/v1/agenda/tipos/route.ts` declarava os
 * campos e o slug como constantes locais, e um arquivo `route.ts` não pode
 * exportar nada além dos handlers. A capacidade de configuração operada por
 * pessoa (`lib/mcp/tools/configuracao.ts`) precisa do MESMO schema, senão a
 * tela e a MCP divergiriam no primeiro limite alterado. A rota importa daqui.
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { atorParaAuditoria } from "@/lib/operacao/autoria";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";

/** As dez do CHECK da tabela. Fora daqui o Postgres recusa; melhor recusar antes. */
export const CATEGORIAS_DE_ATENDIMENTO = [
  "consulta", "procedimento", "retorno", "visita", "vistoria",
  "reuniao", "call", "orcamento", "demonstracao", "outro",
] as const;

export const LOCAIS_DE_ATENDIMENTO = ["in_person", "phone", "whatsapp", "video_link", "google_meet"] as const;

/**
 * Os limites são os MESMOS do CHECK do banco, e isso é deliberado.
 *
 * Zod aqui não substitui a constraint: ela é a verdade e continua valendo para
 * quem escrever por SQL. O que a validação faz é transformar um 500 de constraint
 * numa recusa que diz qual campo e qual limite.
 */
export const camposDoTipo = {
  name: z.string().trim().min(2).max(80),
  category: z.enum(CATEGORIAS_DE_ATENDIMENTO),
  duration_minutes: z.number().int().min(5).max(1440),
  location_kind: z.enum(LOCAIS_DE_ATENDIMENTO),
  description: z.string().trim().max(500).nullish(),
  location_details: z.string().trim().max(300).nullish(),
  default_owner_user_id: z.string().uuid().nullish(),
  requires_confirmation: z.boolean().optional(),
  buffer_before_minutes: z.number().int().min(0).max(720).optional(),
  buffer_after_minutes: z.number().int().min(0).max(720).optional(),
  minimum_notice_minutes: z.number().int().min(0).max(43_200).optional(),
  booking_window_days: z.number().int().min(1).max(365).optional(),
  reminder_enabled: z.boolean().optional(),
  reminder_minutes_before: z
    .number()
    .int()
    .min(15, { message: "O lembrete precisa sair pelo menos 15 minutos antes do compromisso." })
    .max(10_080, { message: "O lembrete não pode sair mais de 7 dias (10080 minutos) antes." })
    .optional(),
  reminder_extra_offsets_minutes: z
    .array(
      z
        .number()
        .int()
        .min(15, { message: "O lembrete precisa sair pelo menos 15 minutos antes do compromisso." })
        .max(10_080, { message: "O lembrete não pode sair mais de 7 dias (10080 minutos) antes." }),
    )
    .max(3, { message: "No máximo 3 lembretes adicionais por tipo." })
    // Duplicata não é erro de quem preenche, é ruído: dois degraus iguais
    // produziriam o mesmo aviso duas vezes. Some aqui, uma vez.
    .transform((v) => [...new Set(v)].sort((a, b) => b - a))
    .optional(),
};

export const tipoDeAtendimentoSchema = z.object(camposDoTipo);
export type TipoDeAtendimentoInput = z.infer<typeof tipoDeAtendimentoSchema>;

/**
 * O slug sai do NOME, e é estável depois de criado.
 *
 * A ferramenta MCP aceita `event_type_slug`, então o slug é endereço público: se
 * ele mudasse ao renomear o tipo, todo playbook e toda automação que o citam
 * parariam de achar, em silêncio. Por isso a alteração nunca o toca.
 */
export function slugDoTipo(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "tipo";
}

export async function criarTipoDeAtendimento(
  deps: DepsDaOperacao,
  input: unknown,
): Promise<{ id: string; slug: string; name: string }> {
  const parsed = tipoDeAtendimentoSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsed.error.flatten() as unknown as Record<string, unknown>,
      deps.requestId,
      parsed.error.issues[0]?.message ?? "Confira os campos do tipo de atendimento.",
    );
  }
  const slug = slugDoTipo(parsed.data.name);
  const { data, error } = await deps.supabase
    .from("calendar_event_types")
    .insert({ ...parsed.data, organization_id: deps.organizationId, slug })
    .select("id, slug")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      throw new ApiError(
        409,
        "conflict",
        undefined,
        deps.requestId,
        `Já existe um tipo com o nome "${parsed.data.name}".`,
      );
    }
    throw new ApiError(500, "internal_error", undefined, deps.requestId, error?.message ?? "event_type_insert_failed");
  }
  const criado = data as unknown as { id: string; slug: string };
  await audit({
    action: "agenda.tipo_criado",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "calendar_event_types",
    resourceId: criado.id,
    requestId: deps.requestId,
    metadata: {
      nome: parsed.data.name,
      categoria: parsed.data.category,
      duracao: parsed.data.duration_minutes,
      actor_type: deps.actor.type,
    },
  });
  return { id: criado.id, slug: criado.slug, name: parsed.data.name };
}
