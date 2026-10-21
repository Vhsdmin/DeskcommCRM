/**
 * E-mail pelo SMTP (ex.: Google Workspace) e a escolha entre SMTP e Resend.
 *
 * O envio é provado contra um servidor SMTP FALSO levantado aqui, de verdade:
 * o Nodemailer conversa por TCP (EHLO, MAIL, RCPT, DATA) e o teste confere o
 * que chegou. Mock do transporte não provaria o protocolo.
 */
import { createServer, type Server } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVES = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURITY",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL",
  "SMTP_FROM_NAME",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
] as const;
const ORIGINAIS = Object.fromEntries(CHAVES.map((k) => [k, process.env[k]]));

beforeEach(() => {
  for (const k of CHAVES) delete process.env[k];
  vi.resetModules();
});

afterEach(() => {
  for (const k of CHAVES) {
    const v = ORIGINAIS[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

/** Servidor SMTP mínimo: guarda o envelope e o DATA de cada mensagem. */
function servidorSmtpFalso(): Promise<{ porta: number; recebidas: string[]; fechar: () => Promise<void>; servidor: Server }> {
  const recebidas: string[] = [];
  const servidor = createServer((sock) => {
    let lendoDados = false;
    let dados = "";
    let buffer = "";
    sock.write("220 falso ESMTP\r\n");
    sock.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let i: number;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const linha = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (lendoDados) {
          if (linha === ".") {
            lendoDados = false;
            recebidas.push(dados);
            dados = "";
            sock.write("250 2.0.0 Ok: queued as FALSO1\r\n");
          } else {
            dados += linha + "\n";
          }
          continue;
        }
        const cmd = linha.toUpperCase();
        if (cmd.startsWith("EHLO")) sock.write("250-falso\r\n250 8BITMIME\r\n");
        else if (cmd.startsWith("HELO")) sock.write("250 falso\r\n");
        else if (cmd.startsWith("MAIL FROM")) {
          recebidas.push(`ENVELOPE ${linha}`);
          sock.write("250 2.1.0 Ok\r\n");
        } else if (cmd.startsWith("RCPT TO")) {
          if (linha.includes("recusado@")) sock.write("550 5.1.1 Destinatario recusado\r\n");
          else sock.write("250 2.1.5 Ok\r\n");
        } else if (cmd === "DATA") {
          lendoDados = true;
          sock.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (cmd === "QUIT") {
          sock.end("221 2.0.0 Bye\r\n");
        } else if (cmd === "RSET") sock.write("250 Ok\r\n");
        else sock.write("250 Ok\r\n");
      }
    });
  });
  return new Promise((resolve) => {
    servidor.listen(0, "127.0.0.1", () => {
      const endereco = servidor.address();
      const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
      resolve({ porta, recebidas, servidor, fechar: () => new Promise((r) => servidor.close(() => r())) });
    });
  });
}

function configurarSmtp(porta: number) {
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(porta);
  process.env.SMTP_SECURITY = "none";
  process.env.SMTP_FROM_EMAIL = "nao-responda@vendepay.com.br";
  process.env.SMTP_FROM_NAME = "VendePay";
}

describe("configuração SMTP", () => {
  it("sem servidor ou sem remetente = não configurado", async () => {
    const { isSmtpConfigured, getSmtpConfig } = await import("@/lib/email/smtp");
    expect(isSmtpConfigured(getSmtpConfig())).toBe(false);
    process.env.SMTP_HOST = "smtp.gmail.com";
    vi.resetModules();
    const segunda = await import("@/lib/email/smtp");
    expect(segunda.isSmtpConfigured(segunda.getSmtpConfig())).toBe(false);
  });

  it("porta e segurança vazias ou inválidas não derrubam o app: valem 587 e starttls", async () => {
    process.env.SMTP_PORT = "";
    process.env.SMTP_SECURITY = "";
    const { getSmtpConfig } = await import("@/lib/email/smtp");
    expect(getSmtpConfig()).toMatchObject({ port: 587, security: "starttls" });
    process.env.SMTP_PORT = "abc";
    process.env.SMTP_SECURITY = "ssl";
    vi.resetModules();
    const segunda = await import("@/lib/email/smtp");
    expect(segunda.getSmtpConfig()).toMatchObject({ port: 587, security: "starttls" });
  });

  it("o nome do remetente não injeta cabeçalho", async () => {
    const { formatFromAddress, getSmtpConfig } = await import("@/lib/email/smtp");
    process.env.SMTP_FROM_EMAIL = "nao-responda@vendepay.com.br";
    vi.resetModules();
    const m = await import("@/lib/email/smtp");
    const sujo = m.formatFromAddress(m.getSmtpConfig(), 'Acme" <evil@x.com>\r\nBcc: vitima@y.com');
    expect(sujo).not.toMatch(/[\r\n]/);
    expect(sujo).toBe("Acme evil@x.comBcc: vitima@y.com <nao-responda@vendepay.com.br>");
    expect(formatFromAddress(getSmtpConfig())).toBeNull();
  });

  it("erros SMTP têm nome: recusa de remetente/destinatário e limite são diferentes de falha genérica", async () => {
    const { classificarErroSmtp } = await import("@/lib/email/smtp");
    expect(classificarErroSmtp({ responseCode: 550 })).toBe("sender_rejected");
    expect(classificarErroSmtp({ responseCode: 421 })).toBe("rate_limited");
    expect(classificarErroSmtp({ code: "ECONNREFUSED" })).toBe("send_failed");
  });
});

describe("envio pelo SMTP, de verdade", () => {
  it("entrega a mensagem com remetente da marca, destinatário e assunto", async () => {
    const smtp = await servidorSmtpFalso();
    try {
      configurarSmtp(smtp.porta);
      const { sendEmail } = await import("@/lib/email/roteador");
      const r = await sendEmail({
        to: "caio@vendepay.com.br",
        subject: "Convite para o VendePay CRM",
        html: "<p>Olá</p>",
        text: "Olá",
        fromName: "VendePay CRM",
      });
      expect(r).toMatchObject({ ok: true, via: "smtp" });
      const tudo = smtp.recebidas.join("\n");
      expect(tudo).toContain("ENVELOPE MAIL FROM:<nao-responda@vendepay.com.br>");
      expect(tudo).toMatch(/From: VendePay CRM <nao-responda@vendepay\.com\.br>/);
      expect(tudo).toContain("To: caio@vendepay.com.br");
      expect(tudo).toContain("Subject: Convite para o VendePay CRM");
    } finally {
      await smtp.fechar();
    }
  });

  it("recusa do servidor volta como erro nomeado, sem lançar", async () => {
    const smtp = await servidorSmtpFalso();
    try {
      configurarSmtp(smtp.porta);
      const { sendEmail } = await import("@/lib/email/roteador");
      const r = await sendEmail({ to: "recusado@x.com", subject: "x", html: "x" });
      expect(r).toMatchObject({ ok: false, error: "sender_rejected", via: "smtp" });
    } finally {
      await smtp.fechar();
    }
  });
});

describe("roteador: SMTP ou Resend, por configuração", () => {
  it("SMTP configurado tem prioridade sobre a Resend", async () => {
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_FROM_EMAIL = "nao-responda@vendepay.com.br";
    process.env.RESEND_API_KEY = "re_123456789012";
    process.env.RESEND_FROM_EMAIL = "x@y.com";
    const { transporteDeEmail, isEmailConfigured } = await import("@/lib/email/roteador");
    expect(transporteDeEmail()).toBe("smtp");
    expect(isEmailConfigured()).toBe(true);
  });

  it("sem SMTP segue pela Resend; sem nenhum dos dois, não configurado", async () => {
    const { transporteDeEmail, isEmailConfigured, sendEmail } = await import("@/lib/email/roteador");
    expect(transporteDeEmail()).toBe("resend");
    expect(isEmailConfigured()).toBe(false);
    const r = await sendEmail({ to: "a@b.com", subject: "x", html: "x" });
    expect(r).toMatchObject({ ok: false, error: "not_configured", via: "resend" });
  });
});
