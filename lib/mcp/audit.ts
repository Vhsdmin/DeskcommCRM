/**
 * Audit log dedicado para tool calls MCP.
 *
 * Spec 11 §6: cada tool call gera 1 entrada em `api_audit_log` com
 * `action='mcp.tool_called'`, `actor_type='ai_agent'` (quando aplicavel),
 * `actor_api_token_id=<token>`, `resource_type='mcp_tool'`, `resource_id=<tool_name>`.
 *
 * Fire-and-forget: falha de write nunca bloqueia retorno da tool.
 */
import { audit } from "@/lib/audit";
import type { McpContext } from "./types";

interface AuditMcpToolCallInput {
  ctx: McpContext;
  toolName: string;
  args: Record<string, unknown>;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
  resultSummary?: string;
}

/**
 * Chaves que nunca entram no audit em texto. `secret` e `secret_enc` entraram
 * aqui porque `crm_create_webhook_source` já recebia `secret` em texto e o
 * gravava inteiro em `metadata.args`; com as capacidades de configuração
 * (assinatura de entrada, segredo de `call_webhook` dentro de `actions[]`) o
 * vazamento ganharia profundidade, por isso a redação desce em objetos e listas.
 */
const ARGS_REDACT_KEYS = new Set([
  "authorization",
  "api_key",
  "token",
  "password",
  "senha",
  "cpf",
  "secret",
  "secret_enc",
  "client_secret",
  "access_token",
  "refresh_token",
]);

const PROFUNDIDADE_MAXIMA = 6;

function redactValue(valor: unknown, profundidade: number): unknown {
  if (typeof valor === "string") {
    return valor.length > 500 ? `${valor.slice(0, 500)}...[truncated]` : valor;
  }
  if (valor === null || typeof valor !== "object" || profundidade >= PROFUNDIDADE_MAXIMA) return valor;
  if (Array.isArray(valor)) return valor.map((item) => redactValue(item, profundidade + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    out[k] = ARGS_REDACT_KEYS.has(k.toLowerCase()) ? "[redacted]" : redactValue(v, profundidade + 1);
  }
  return out;
}

export function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  return redactValue(args, 0) as Record<string, unknown>;
}

export async function auditMcpToolCall(input: AuditMcpToolCallInput): Promise<void> {
  const { ctx, toolName, args, durationMs, success, errorMessage, resultSummary } = input;

  const metadata: Record<string, unknown> = {
    actor_type: ctx.actor.type,
    actor_id: ctx.actor.id,
    tool_name: toolName,
    args: redactArgs(args),
    duration_ms: durationMs,
    success,
  };

  if (resultSummary) metadata.result_summary = resultSummary.slice(0, 280);
  if (errorMessage) metadata.error = errorMessage.slice(0, 500);
  if (ctx.actor.type === "ai_agent" && ctx.actor.api_token_id) {
    metadata.actor_api_token_id = ctx.actor.api_token_id;
  }

  await audit({
    action: "mcp.tool_called",
    // Quem age via MCP é um TOKEN, nunca uma linha de auth.users: para um token
    // comum, ctx.actor.id é o id do próprio token (lib/mcp/auth.ts), e mandá-lo
    // como actorUserId estourava a FK api_audit_log_actor_user_id_fkey. O ator
    // já fica registrado em actorApiTokenId e em metadata.actor_id.
    actorUserId: null,
    actorApiTokenId: ctx.apiTokenId,
    organizationId: ctx.organizationId,
    resourceType: "mcp_tool",
    // `resource_id` é uuid no banco; o nome da tool ia aqui como texto e o
    // insert morria com "invalid input syntax for type uuid: crm_create_lead".
    // O nome já viaja em metadata.tool_name, que é jsonb.
    resourceId: null,
    requestId: ctx.requestId,
    metadata,
  });
}
