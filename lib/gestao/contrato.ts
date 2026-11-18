/**
 * O contrato do webhook do core da VendePay → CRM.
 *
 * É o formato que o core já envia (`crm.user.updated`, contrato
 * `@vendepay/contracts`); o CRM se adapta a ele, não o contrário. Cada envio é a
 * fotografia atual de UM vendedor, em JSON:
 *
 * ```json
 * {
 *   "id": "crm:…",                        // único por entrega; reenvio = mesmo id e mesmo corpo
 *   "type": "crm.user.updated",
 *   "apiVersion": "2026-06-01",
 *   "createdAt": "2026-11-17T12:00:00.000Z",
 *   "data": {
 *     "asOf": "2026-11-17T12:00:05.000Z",  // quando a fotografia foi tirada
 *     "user": { "id": "9b7c…", "name": "Loja Exemplo", "email": "contato@exemplo.com", "phone": "+5511999998888" },
 *     "onboarding": { … },                 // aceito e ignorado: o CRM guarda só o contato
 *     "verification": { … }
 *   }
 * }
 * ```
 *
 * Assinatura no header `vendepay-signature`: `t=<unix>,v1=<hex>`, com `<hex>` =
 * HMAC SHA-256 de `"<unix>.<corpo cru>"`, usando o segredo que o core gera ao
 * configurar o destino na Gestão e que é colado no CRM.
 *
 * A chave do cliente é `data.user.id`. E-mail e telefone NUNCA casam contas:
 * podem mudar no Gestão ou coincidir entre contas diferentes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { normalizePhoneBR } from "@/lib/webhooks/inbound";

export const HEADER_DE_ASSINATURA = "vendepay-signature";
export const TIPO_DE_EVENTO = "crm.user.updated";
export const VERSAO_DA_API = "2026-06-01";

/** Janela aceita entre o `t` da assinatura e o relógio do CRM. O core assina de novo a cada tentativa. */
export const TOLERANCIA_DA_ASSINATURA_SEGUNDOS = 300;

// Corta em vez de recusar: um nome longo no core não pode travar o envio do contato.
const textoOpcional = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.slice(0, 320) : null));

// Sem `.strict()`: o core pode acrescentar blocos (onboarding, KYC) sem quebrar o CRM.
export const eventoDoGestaoSchema = z.object({
  id: z.string().trim().min(1).max(200),
  type: z.literal(TIPO_DE_EVENTO),
  apiVersion: z.literal(VERSAO_DA_API),
  createdAt: z.string().datetime({ offset: true }),
  data: z.object({
    asOf: z.string().datetime({ offset: true }),
    user: z.object({
      id: z.string().trim().min(1).max(128),
      name: textoOpcional,
      email: z
        .string()
        .trim()
        .max(320)
        .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: "email inválido" }),
      phone: textoOpcional,
    }),
  }),
});

export type EventoDoGestao = z.infer<typeof eventoDoGestaoSchema>;

/** Assina como o core: `t=<unix>,v1=<hex de HMAC SHA-256 de "<unix>.<corpo>">`. */
export function assinar(corpoCru: string, segredo: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmac(corpoCru, segredo, timestamp)}`;
}

function hmac(corpoCru: string, segredo: string, timestamp: number): string {
  return createHmac("sha256", segredo).update(`${timestamp}.${corpoCru}`).digest("hex");
}

/** Confere em tempo constante; recusa sem `t`, fora da janela ou sem `v1` que bata. */
export function assinaturaConfere(
  corpoCru: string,
  header: string | null,
  segredo: string,
  agoraSegundos: number = Math.floor(Date.now() / 1000),
): boolean {
  // Sem segredo não há o que conferir: recusar, nunca deixar passar.
  if (!header || !segredo) return false;
  const partes = header.split(",").map((p) => {
    const [chave, ...resto] = p.trim().split("=");
    return [chave, resto.join("=")] as const;
  });
  const t = partes.find(([chave]) => chave === "t")?.[1];
  if (!t || !/^\d{1,12}$/.test(t)) return false;
  const timestamp = Number(t);
  if (Math.abs(agoraSegundos - timestamp) > TOLERANCIA_DA_ASSINATURA_SEGUNDOS) return false;
  const esperada = Buffer.from(hmac(corpoCru, segredo, timestamp), "utf8");
  return partes.some(([chave, valor]) => {
    if (chave !== "v1") return false;
    const recebida = Buffer.from(valor.toLowerCase(), "utf8");
    return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
  });
}

/** Os campos do cliente que o evento define, já normalizados. Sem nome, o e-mail o identifica. */
export function camposDoCliente(evento: EventoDoGestao): {
  name: string;
  email: string;
  phone_number: string | null;
  telefoneRecusado: boolean;
} {
  const { user } = evento.data;
  const telefone = user.phone ? normalizePhoneBR(user.phone) : null;
  return {
    name: (user.name ?? user.email).slice(0, 200),
    email: user.email,
    phone_number: telefone,
    telefoneRecusado: Boolean(user.phone) && telefone === null,
  };
}
