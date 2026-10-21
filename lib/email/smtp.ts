/**
 * Transporte SMTP (ex.: Google Workspace) — alternativa à Resend.
 *
 * A configuração vem só do ambiente (`SMTP_*` em `lib/env.ts`): é o que o
 * gerador do Easypanel grava e o que a VPS consegue mudar sem abrir tela.
 * Quem escolhe entre SMTP e Resend é `lib/email/roteador.ts`, nunca o chamador.
 *
 * Google Workspace: `smtp.gmail.com`, porta 587, `starttls`, usuário = e-mail
 * da conta e senha = SENHA DE APP. O Google reescreve o remetente para a conta
 * autenticada quando `SMTP_FROM_EMAIL` não é dela nem um alias verificado.
 */
import { isIP } from "node:net";

import nodemailer, { type Transporter } from "nodemailer";

import { env } from "@/lib/env";

export type SmtpSecurity = "starttls" | "tls" | "none";

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

export type SmtpDeliveryError = "not_configured" | "send_failed" | "rate_limited" | "sender_rejected";

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  fromName?: string;
  tags?: { name: string; value: string }[];
}

interface SendResult {
  ok: boolean;
  id?: string;
  error?: SmtpDeliveryError;
  details?: string;
}

export function getSmtpConfig(): SmtpConfig {
  return {
    host: env.SMTP_HOST.trim(),
    port: env.SMTP_PORT,
    security: env.SMTP_SECURITY,
    username: env.SMTP_USERNAME.trim(),
    password: env.SMTP_PASSWORD,
    fromEmail: env.SMTP_FROM_EMAIL.trim(),
    fromName: env.SMTP_FROM_NAME.trim(),
  };
}

/** Servidor E remetente: sem remetente todo envio seria recusado ou reescrito. */
export function isSmtpConfigured(config: SmtpConfig = getSmtpConfig()): boolean {
  return Boolean(config.host && config.fromEmail);
}

/**
 * `Nome <endereco>`. O nome é sanitizado: `<`, `>`, `"` e quebra de linha no
 * `From:` são injeção de cabeçalho, e a marca vem de um campo digitado em tela.
 */
export function formatFromAddress(config: SmtpConfig, override?: string): string | null {
  if (!config.fromEmail) return null;
  const nome = (override ?? config.fromName).replace(/[<>"\r\n]/g, "").trim();
  return nome ? `${nome} <${config.fromEmail}>` : config.fromEmail;
}

/**
 * Nome que o cliente SMTP anuncia no EHLO. Dentro do Docker o padrão do
 * Nodemailer vira o hostname curto do contêiner, que alguns provedores aceitam
 * e filtram depois; anunciar o domínio da instalação evita isso.
 */
function nomeDoCliente(): string | undefined {
  try {
    const hostname = new URL(env.NEXT_PUBLIC_APP_URL).hostname;
    const endereco = hostname.replace(/^\[|\]$/g, "");
    if (isIP(endereco) === 4) return `[${endereco}]`;
    if (isIP(endereco) === 6) return `[IPv6:${endereco}]`;
    return hostname.includes(".") ? hostname : undefined;
  } catch {
    return undefined;
  }
}

let transporte: Transporter | null = null;
let chaveDoTransporte = "";

function getTransport(config: SmtpConfig): Transporter {
  const name = nomeDoCliente();
  const chave = [name, config.host, config.port, config.security, config.username, config.password].join("\0");
  if (transporte && chaveDoTransporte === chave) return transporte;
  chaveDoTransporte = chave;
  transporte = nodemailer.createTransport({
    name,
    host: config.host,
    port: config.port,
    secure: config.security === "tls",
    requireTLS: config.security === "starttls",
    ignoreTLS: config.security === "none",
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transporte;
}

/** Erro nomeado: "remetente recusado" manda o operador a um lugar diferente de "falhou". */
export function classificarErroSmtp(error: unknown): SmtpDeliveryError {
  const e = (error ?? {}) as { code?: string; responseCode?: number };
  if (e.responseCode === 421 || e.responseCode === 450 || e.responseCode === 452 || e.responseCode === 454) {
    return "rate_limited";
  }
  if (e.responseCode === 550 || e.responseCode === 553 || e.responseCode === 554) return "sender_rejected";
  return "send_failed";
}

export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const config = getSmtpConfig();
  const from = formatFromAddress(config, args.fromName);
  if (!isSmtpConfigured(config) || !from) return { ok: false, error: "not_configured" };
  try {
    const resultado = await getTransport(config).sendMail({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
    });
    return { ok: true, id: resultado.messageId };
  } catch (error) {
    return {
      ok: false,
      error: classificarErroSmtp(error),
      details: error instanceof Error ? error.message : "Falha no envio SMTP",
    };
  }
}
