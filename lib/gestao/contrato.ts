/**
 * O contrato do webhook do Gestão VendePay → CRM.
 *
 * É o formato que o time do Gestão implementa. Cada envio é UM evento, em JSON,
 * assinado com HMAC SHA-256 do corpo cru no header `X-VendePay-Signature`
 * (hex, com ou sem o prefixo `sha256=`), usando o segredo mostrado na tela
 * Webhooks › Receber dados.
 *
 * ```json
 * {
 *   "event_id": "evt_01J...",            // único por evento; reenvio = mesmo id
 *   "event_type": "account.created",     // ou "account.updated"
 *   "occurred_at": "2026-10-14T12:00:00Z",
 *   "account": {
 *     "id": "9b7c…",                     // ID do usuário no Gestão (chave do vínculo)
 *     "name": "Loja Exemplo",
 *     "email": "contato@exemplo.com",    // opcional
 *     "phone": "+5511999998888"          // opcional; aceita formato brasileiro
 *   }
 * }
 * ```
 *
 * A chave do cliente é `account.id`. E-mail e telefone NUNCA casam contas:
 * podem mudar no Gestão ou coincidir entre contas diferentes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { normalizePhoneBR } from "@/lib/webhooks/inbound";

export const HEADER_DE_ASSINATURA = "x-vendepay-signature";

/**
 * `account.snapshot` (contrato v1 da página "Contrato de dados Gestão → CRM") traz
 * a fotografia completa da conta. Por ora o CRM lê dela as vendas — GMV de 30
 * dias em BRL e a última venda, que definem a faixa da carteira e o alerta de
 * "sem vender"; os demais blocos (identificação, KYC, risco, Customer Success)
 * são aceitos e ignorados até o Customer 360.
 */
export const TIPOS_DE_EVENTO = ["account.created", "account.updated", "account.snapshot"] as const;
export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];

const textoOpcional = z
  .string()
  .trim()
  .max(320)
  .nullish()
  .transform((v) => (v ? v : null));

export const eventoDoGestaoSchema = z.object({
  event_id: z.string().trim().min(1).max(200),
  event_type: z.enum(TIPOS_DE_EVENTO),
  occurred_at: z.string().datetime({ offset: true }),
  account: z.object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    email: textoOpcional.refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
      message: "email inválido",
    }),
    phone: textoOpcional,
  }),
  vendas: z
    .object({
      calculado_em: z.string().datetime({ offset: true }).nullish(),
      ultima_venda_em: z.string().datetime({ offset: true }).nullish(),
      por_moeda: z
        .array(
          z.object({
            moeda: z.string().trim().length(3),
            ultimos_30_dias: z
              .object({
                quantidade: z.number().int().nonnegative().nullish(),
                volume_centavos: z.number().int().nonnegative().nullish(),
              })
              .nullish(),
          }),
        )
        .max(20)
        .default([]),
    })
    .nullish(),
});

export type EventoDoGestao = z.infer<typeof eventoDoGestaoSchema>;

/** Assinatura esperada: hex do HMAC SHA-256 do corpo cru. */
export function assinar(corpoCru: string, segredo: string): string {
  return createHmac("sha256", segredo).update(corpoCru).digest("hex");
}

/** Compara em tempo constante; aceita `sha256=<hex>` ou só `<hex>`. */
export function assinaturaConfere(corpoCru: string, header: string | null, segredo: string): boolean {
  if (!header) return false;
  const recebida = header.trim().replace(/^sha256=/i, "").toLowerCase();
  const esperada = assinar(corpoCru, segredo);
  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(recebida, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * As vendas que o CRM guarda: GMV dos últimos 30 dias em BRL (a carteira é por
 * faixa em reais; outras moedas não somam) e a última venda. `undefined` = o
 * evento não trouxe o bloco (não mexe no que está gravado); `null` = indisponível.
 */
export function vendasDoEvento(evento: EventoDoGestao):
  | { gmv30dCentavos: number | null; gmvEm: string; ultimaVendaEm: string | null }
  | undefined {
  if (!evento.vendas) return undefined;
  const brl = evento.vendas.por_moeda.find((m) => m.moeda.toUpperCase() === "BRL");
  return {
    gmv30dCentavos: brl?.ultimos_30_dias?.volume_centavos ?? (brl ? null : 0),
    gmvEm: evento.vendas.calculado_em ?? evento.occurred_at,
    ultimaVendaEm: evento.vendas.ultima_venda_em ?? null,
  };
}

/** Os campos do cliente que o evento define, já normalizados. */
export function camposDoCliente(evento: EventoDoGestao): {
  name: string;
  email: string | null;
  phone_number: string | null;
  telefoneRecusado: boolean;
} {
  const telefone = evento.account.phone ? normalizePhoneBR(evento.account.phone) : null;
  return {
    name: evento.account.name,
    email: evento.account.email,
    phone_number: telefone,
    telefoneRecusado: Boolean(evento.account.phone) && telefone === null,
  };
}
