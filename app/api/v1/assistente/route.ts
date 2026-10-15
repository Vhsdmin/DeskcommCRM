import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/assistente — os assistentes que o CSM pode usar (agentes da org
 *                           com pelo menos uma versão salva).
 * POST /api/v1/assistente — uma pergunta ao assistente: roda o modelo configurado
 *                           no agente com as instruções, os documentos e as
 *                           ferramentas de consulta ao CRM (somente leitura).
 *
 * A conversa não é gravada: vive na tela do CSM. O que fica é a auditoria da
 * pergunta (sem o conteúdo) com o agente, a versão, as ferramentas usadas e o
 * consumo de tokens.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { CredentialUnavailableError, loadCredential } from "@/lib/ai/credentials";
import { buildModel, chaveDePlataforma } from "@/lib/ai/runtime/agent";
import { REGRAS_DO_ASSISTENTE, ferramentasDoAssistente, type FonteCitada } from "@/lib/assistente-cs/ferramentas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PASSOS = 6;

const corpoSchema = z
  .object({
    agent_id: z.string().uuid(),
    mensagens: z
      .array(
        z.object({
          papel: z.enum(["csm", "assistente"]),
          texto: z.string().trim().min(1).max(4000),
        }),
      )
      .min(1)
      .max(30)
      .refine((m) => m.at(-1)?.papel === "csm", { message: "a última mensagem deve ser do CSM" }),
  })
  .strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "assistente_cs" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const [agentes, versoes] = await Promise.all([
    admin
      .from("ai_agents")
      .select("id, name, description")
      .eq("organization_id", authz.org.orgId)
      .is("archived_at", null)
      .order("name"),
    admin.from("ai_agent_versions").select("agent_id").eq("organization_id", authz.org.orgId),
  ]);
  if (agentes.error || versoes.error) {
    return fail("internal_error", "Não foi possível carregar os assistentes.", 500, { requestId });
  }
  const comVersao = new Set((versoes.data ?? []).map((v) => v.agent_id as string));
  const assistentes = (agentes.data ?? [])
    .filter((a) => comVersao.has(a.id as string))
    .map((a) => ({ id: a.id, name: a.name, description: a.description }));
  return ok({ assistentes }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "assistente_cs" });
  if (!authz.ok) return authz.response;

  const rl = await checkRateLimit(`assistente_cs:${authz.user.id}`, 30, 60);
  if (!rl.allowed) {
    return fail("rate_limited", "Muitas perguntas seguidas. Aguarde um minuto.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Pergunta inválida.", 422, { requestId });
  const orgId = authz.org.orgId;

  // Configuração do agente: lida pelo servidor, sempre filtrando a org da sessão.
  const admin = createAdminClient();
  const { data: versao, error: erroVersao } = await admin
    .from("ai_agent_versions")
    .select("id, version_number, system_prompt, provider, model, credential_id, knowledge_source_ids")
    .eq("organization_id", orgId)
    .eq("agent_id", parsed.data.agent_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroVersao) return fail("internal_error", "Não foi possível carregar o assistente.", 500, { requestId });
  if (!versao) return fail("not_found", "Assistente não encontrado ou ainda sem configuração salva.", 404, { requestId });

  let chave: string | null;
  if (versao.credential_id) {
    try {
      chave = (await loadCredential(versao.credential_id, orgId)).apiKey;
    } catch (err) {
      const motivo = err instanceof CredentialUnavailableError ? err.reason : "indisponivel";
      return fail("unprocessable_entity", `A chave de IA do assistente está indisponível (${motivo}). Revise em Agente de IA › Credenciais.`, 422, { requestId });
    }
  } else {
    chave = chaveDePlataforma(versao.provider);
  }
  if (!chave) {
    return fail("unprocessable_entity", "O assistente não tem chave de IA. Escolha uma credencial na configuração do agente.", 422, { requestId });
  }

  const fontes: FonteCitada[] = [];
  const supabase = await createClient();
  const ferramentas = ferramentasDoAssistente({
    supabase,
    organizationId: orgId,
    knowledgeSourceIds: (versao.knowledge_source_ids as string[] | null) ?? [],
    fontes,
  });
  const mensagens: ModelMessage[] = parsed.data.mensagens.map((m) => ({
    role: m.papel === "csm" ? "user" : "assistant",
    content: m.texto,
  }));

  try {
    const resultado = await generateText({
      model: buildModel(versao.provider, chave, versao.model),
      system: `${REGRAS_DO_ASSISTENTE}\n\n# Instruções configuradas\n${versao.system_prompt}`,
      messages: mensagens,
      tools: ferramentas,
      stopWhen: stepCountIs(MAX_PASSOS),
    });
    const ferramentasUsadas = [
      ...new Set(resultado.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName))),
    ];
    await audit({
      action: "assistente_cs.pergunta",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "ai_agent",
      resourceId: parsed.data.agent_id,
      requestId,
      metadata: {
        version_number: versao.version_number,
        ferramentas: ferramentasUsadas,
        tokens_entrada: resultado.totalUsage?.inputTokens ?? null,
        tokens_saida: resultado.totalUsage?.outputTokens ?? null,
      },
    });
    return ok({ resposta: resultado.text, fontes, ferramentas: ferramentasUsadas }, { requestId });
  } catch (err) {
    logger.error("[assistente_cs] falha ao gerar resposta", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("ai_provider_error", "O modelo de IA não respondeu. Tente de novo em instantes.", 502, { requestId });
  }
}
