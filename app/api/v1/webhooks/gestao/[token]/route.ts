/**
 * POST /api/v1/webhooks/gestao/[token] — eventos de conta do Gestão VendePay.
 *
 * O token da URL resolve a organização (fonte confiável — nunca o corpo); a
 * assinatura HMAC SHA-256 do corpo cru (`X-VendePay-Signature`) prova que quem
 * envia conhece o segredo. Sem assinatura válida, nada é processado.
 *
 * Todo envio autenticado fica em `webhook_events_log` (provider `gestao`), e o
 * `event_id` é único por organização: reenvio do mesmo evento responde 200 sem
 * reprocessar. O contrato está em `lib/gestao/contrato.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { HEADER_DE_ASSINATURA, assinaturaConfere, eventoDoGestaoSchema } from "@/lib/gestao/contrato";
import { processarEventoDoGestao } from "@/lib/gestao/processar-evento";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMITE_POR_MINUTO = 120;

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!token || token.length < 32) return fail("not_found", "unknown webhook token", 404, { requestId });

  const rl = await checkRateLimit(`webhook_gestao:${token}`, LIMITE_POR_MINUTO, 60);
  if (!rl.allowed) {
    return fail("rate_limited", "Too many requests.", 429, { requestId, headers: { "Retry-After": "60" } });
  }

  const admin = createAdminClient();
  const { data: conexao, error: erroConexao } = await admin
    .from("gestao_conexoes")
    .select("id, organization_id, secret_encrypted, is_active")
    .eq("path_token", token)
    .maybeSingle();
  if (erroConexao) return fail("internal_error", "connection lookup failed", 500, { requestId });
  if (!conexao || !conexao.is_active) return fail("not_found", "unknown webhook token", 404, { requestId });
  const organizationId = conexao.organization_id as string;

  const corpoCru = await req.text();
  const assinatura = req.headers.get(HEADER_DE_ASSINATURA);
  const segredo = await decryptWebhookSecret(admin, conexao.secret_encrypted as unknown as string);
  if (segredo === null) {
    // Sem a chave de cifra não há como conferir — e sem conferir não processa.
    logger.error("[gestao.webhook] segredo indisponível", { requestId, organizationId });
    return fail("unavailable", "signature secret unavailable", 503, { requestId });
  }
  if (!assinaturaConfere(corpoCru, assinatura, segredo)) {
    await audit({
      action: "gestao.evento_recusado",
      organizationId,
      resourceType: "gestao_conexao",
      resourceId: conexao.id as string,
      metadata: { motivo: "assinatura_invalida" },
      requestId,
    });
    return fail("unauthenticated", "invalid_signature", 401, { requestId });
  }

  let json: unknown;
  try {
    json = corpoCru ? JSON.parse(corpoCru) : {};
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }
  const parsed = eventoDoGestaoSchema.safeParse(json);
  const eventId =
    parsed.success ? parsed.data.event_id : typeof (json as { event_id?: unknown })?.event_id === "string"
      ? ((json as { event_id: string }).event_id).slice(0, 200)
      : null;

  const { data: registro, error: erroRegistro } = await admin
    .from("webhook_events_log")
    .insert({
      organization_id: organizationId,
      provider: "gestao",
      webhook_path_token: token,
      http_method: "POST",
      raw_body: corpoCru,
      payload_parsed: json as Record<string, unknown>,
      signature_header: assinatura,
      valid_signature: true,
      event_type: parsed.success ? parsed.data.event_type : "invalido",
      // Evento inválido não reserva o id: o Gestão pode corrigir e reenviar.
      external_id: parsed.success ? eventId : null,
      status: "received",
      attempts: 1,
    })
    .select("id")
    .single();
  if (erroRegistro) {
    if (erroRegistro.code === "23505") {
      return ok({ status: "duplicado", event_id: eventId }, { requestId });
    }
    logger.error("[gestao.webhook] falha ao registrar evento", { requestId, error: erroRegistro.message });
    return fail("internal_error", "event log failed", 500, { requestId });
  }

  const finalizar = async (status: "processed" | "error", erro: string | null) => {
    await admin
      .from("webhook_events_log")
      .update({ status, error_message: erro, processed_at: new Date().toISOString() })
      .eq("id", registro.id);
    await admin
      .from("gestao_conexoes")
      .update({ last_received_at: new Date().toISOString() })
      .eq("id", conexao.id);
  };

  if (!parsed.success) {
    await finalizar("error", "evento fora do contrato");
    return fail("invalid_request", "invalid_event", 400, { requestId, details: parsed.error.flatten() });
  }

  try {
    const desfecho = await processarEventoDoGestao(admin, organizationId, parsed.data);
    if (desfecho.status === "conflito") {
      const motivo =
        desfecho.campo === "email"
          ? "o e-mail já pertence a outro cliente do CRM"
          : "o telefone já pertence a outro cliente do CRM";
      await finalizar("error", motivo);
      // Libera o event_id: depois que alguém resolver o conflito na ficha, o
      // reenvio do MESMO evento precisa ser processado, não tratado como duplicado.
      await admin.from("webhook_events_log").update({ external_id: null }).eq("id", registro.id);
      await audit({
        action: "gestao.evento_recusado",
        organizationId,
        resourceType: "gestao_conexao",
        resourceId: conexao.id as string,
        metadata: { motivo: `conflito_${desfecho.campo}`, event_id: eventId },
        requestId,
      });
      return fail("state_conflict", motivo, 409, { requestId });
    }
    if (desfecho.status === "anonimizado") {
      await finalizar("error", "cliente anonimizado (LGPD) — não é reaberto");
      return fail("lgpd_anonymization_irreversible", "contact anonymized", 410, { requestId });
    }
    await finalizar(
      "processed",
      desfecho.telefoneRecusado ? "telefone ignorado: formato não reconhecido" : null,
    );
    await audit({
      action: desfecho.status === "criado" ? "gestao.cliente_criado" : "gestao.cliente_atualizado",
      organizationId,
      resourceType: "contact",
      resourceId: desfecho.contactId,
      metadata: { event_id: eventId, event_type: parsed.data.event_type },
      requestId,
    });
    return ok({ status: desfecho.status, contact_id: desfecho.contactId }, { requestId });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    logger.error("[gestao.webhook] falha ao processar", { requestId, error: mensagem });
    await finalizar("error", "falha interna ao processar");
    // Resposta 500 permite ao Gestão tentar de novo — mas o event_id já ficou
    // registrado; libera o id para o reenvio ser aceito.
    await admin.from("webhook_events_log").update({ external_id: null }).eq("id", registro.id);
    return fail("internal_error", "processing failed", 500, { requestId });
  }
}
