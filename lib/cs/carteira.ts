/**
 * Carteira por faixa de faturamento (migration 0274).
 *
 * As faixas são guardadas só com o INÍCIO (em centavos de BRL): o fim de cada
 * uma é o início da próxima. A primeira começa em 0 para todo cliente caber em
 * alguma faixa. Validação compartilhada entre a rota e a tela.
 */
import { z } from "zod";

export const TIPOS_DE_FAIXA = ["suporte", "csm"] as const;

export const faixaSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().trim().min(1).max(80),
  inicio_centavos: z.number().int().min(0).max(1_000_000_000_000),
  tipo: z.enum(TIPOS_DE_FAIXA),
  responsavel_user_id: z.string().uuid().nullable(),
});
export type FaixaDaCarteira = z.infer<typeof faixaSchema>;

export const faixasSchema = z
  .array(faixaSchema)
  .min(1)
  .max(12)
  .superRefine((faixas, ctx) => {
    const inicios = faixas.map((f) => f.inicio_centavos);
    if (!inicios.includes(0)) {
      ctx.addIssue({ code: "custom", message: "A primeira faixa precisa começar em R$ 0,00." });
    }
    if (new Set(inicios).size !== inicios.length) {
      ctx.addIssue({ code: "custom", message: "Duas faixas não podem começar no mesmo valor." });
    }
  });

/** Ordena pelo início e diz onde cada faixa termina (início da próxima − 1 centavo). */
export function comFim<T extends { inicio_centavos: number }>(faixas: T[]): Array<T & { fim_centavos: number | null }> {
  const ordenadas = [...faixas].sort((a, b) => a.inicio_centavos - b.inicio_centavos);
  return ordenadas.map((f, i) => ({
    ...f,
    fim_centavos: i < ordenadas.length - 1 ? ordenadas[i + 1]!.inicio_centavos - 1 : null,
  }));
}

/** R$ 1.234,56 a partir de centavos. */
export function reais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * "10.000,01" (como se digita em reais) → 1000001 centavos. Ponto é separador
 * de milhar e vírgula, de centavos; `null` quando vazio ou inválido.
 */
export function centavosDoTexto(texto: string): number | null {
  const limpo = texto.replace(/[^\d,]/g, "");
  if (limpo === "" || limpo.split(",").length > 2) return null;
  const n = Math.round(Number(limpo.replace(",", ".")) * 100);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
