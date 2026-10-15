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

export const TIPOS_DE_EVENTO = ["account.created", "account.updated"] as const;
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
