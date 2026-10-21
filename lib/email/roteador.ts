/**
 * Por qual caminho cada e-mail transacional sai: SMTP ou Resend.
 *
 *   SMTP configurado (`SMTP_HOST` + `SMTP_FROM_EMAIL`)  →  sai pelo SMTP.
 *   SMTP ausente                                        →  sai pela Resend.
 *
 * A decisão é por CONFIGURAÇÃO, nunca por falha. "Tentou SMTP, falhou, tenta a
 * Resend" entrega em dobro (boa parte das falhas SMTP acontece depois de o
 * servidor aceitar a mensagem) e esconde o SMTP quebrado atrás de um sucesso
 * emprestado. Sem nenhum dos dois, o resultado continua `not_configured`, que
 * mantém os caminhos que já existem: link de aceite na tela do convite e
 * `pending_review` no export de LGPD.
 *
 * Todo chamador importa daqui, nunca de `resend.ts` ou `smtp.ts` direto.
 */
import { isEmailConfigured as resendConfigurada, sendEmail as enviarPelaResend } from "@/lib/email/resend";
import { isSmtpConfigured, sendEmail as enviarPorSmtp } from "@/lib/email/smtp";

export type TransporteDeEmail = "smtp" | "resend";

/** União dos dois vocabulários: cada erro aponta para um lugar diferente. */
export type EmailDeliveryError =
  | "not_configured"
  | "send_failed"
  | "rate_limited"
  | "sender_rejected"
  | "dominio_nao_verificado";

export interface EmailSendResult {
  ok: boolean;
  id?: string;
  error?: EmailDeliveryError;
  details?: string;
  /** Por onde o envio foi tentado — sem isto, "falhou" não diz onde olhar. */
  via?: TransporteDeEmail;
}

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  fromName?: string;
  tags?: { name: string; value: string }[];
}

export function transporteDeEmail(): TransporteDeEmail {
  return isSmtpConfigured() ? "smtp" : "resend";
}

/** Existe algum caminho capaz de entregar? Para a tela, nunca para decidir envio. */
export function isEmailConfigured(): boolean {
  return transporteDeEmail() === "smtp" || resendConfigurada();
}

export async function sendEmail(args: SendArgs): Promise<EmailSendResult> {
  const via = transporteDeEmail();
  const resultado = via === "smtp" ? await enviarPorSmtp(args) : await enviarPelaResend(args);
  return { ...resultado, via };
}
