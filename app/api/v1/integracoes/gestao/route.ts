import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET   /api/v1/integracoes/gestao — a conexão do Gestão da organização ativa
 *                                    (sem o segredo) e os últimos envios.
 * POST  /api/v1/integracoes/gestao — cria a conexão; devolve o segredo UMA vez.
 * PATCH /api/v1/integracoes/gestao — `{ is_active }` liga/desliga;
 *                                    `{ trocar_segredo: true }` gera outro e o devolve uma vez.
 *
 * Papel mínimo: manager. A tabela é server-side only (RLS sem policies), então
 * leitura e escrita passam pelo admin client SEMPRE filtrando a organização da
 * sessão.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export const dynamic = "force-dynamic";

const ULTIMOS_ENVIOS = 20;

const patchSchema = z.union([
  z.object({ is_active: z.boolean() }).strict(),
  z.object({ trocar_segredo: z.literal(true) }).strict(),
]);

function novoSegredo(): string {
  return randomBytes(32).toString("hex");
}

async function cifrar(segredo: string): Promise<string | null> {
  return encryptWebhookSecret(createAdminClient(), segredo);
}

const SEM_CIFRA =
  "Não foi possível guardar o segredo com segurança: a chave de cifra desta instalação não está ativa. Quem administra o servidor resolve rodando o update.sh.";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "gestao_conexoes" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();

  const { data: conexao, error } = await admin
    .from("gestao_conexoes")
    .select("id, path_token, is_active, last_received_at, created_at, updated_at")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  let envios: unknown[] = [];
  if (conexao) {
    const { data } = await admin
      .from("webhook_events_log")
      .select("id, event_type, external_id, status, error_message, received_at, processed_at")
      .eq("organization_id", authz.org.orgId)
      .eq("provider", "gestao")
      .order("received_at", { ascending: false })
      .limit(ULTIMOS_ENVIOS);
    envios = data ?? [];
  }
  return ok({ conexao, envios }, { requestId });
}

export async function POST(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "gestao_conexoes" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();

  const segredo = novoSegredo();
  const cifrado = await cifrar(segredo);
  if (cifrado === null) return fail("encryption_unavailable", SEM_CIFRA, 422, { requestId });

  const { data, error } = await admin
    .from("gestao_conexoes")
    .insert({
      organization_id: authz.org.orgId,
      path_token: randomBytes(24).toString("base64url"),
      secret_encrypted: cifrado,
      created_by_user_id: authz.user.id,
    })
    .select("id, path_token, is_active, last_received_at, created_at, updated_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      return fail("state_conflict", "A conexão com o Gestão já existe nesta organização.", 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  await audit({
    action: "gestao.conexao_criada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "gestao_conexao",
    resourceId: data.id,
    requestId,
  });
  return ok({ conexao: data, segredo }, { requestId, status: 201 });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "gestao_conexoes" });
  if (!authz.ok) return authz.response;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return fail("invalid_request", "Dados inválidos.", 400, { requestId });

  const admin = createAdminClient();
  let segredo: string | null = null;
  const patch: Record<string, unknown> = {};
  if ("is_active" in parsed.data) {
    patch.is_active = parsed.data.is_active;
  } else {
    segredo = novoSegredo();
    const cifrado = await cifrar(segredo);
    if (cifrado === null) return fail("encryption_unavailable", SEM_CIFRA, 422, { requestId });
    patch.secret_encrypted = cifrado;
  }

  const { data, error } = await admin
    .from("gestao_conexoes")
    .update(patch)
    .eq("organization_id", authz.org.orgId)
    .select("id, path_token, is_active, last_received_at, created_at, updated_at")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Conexão com o Gestão não encontrada.", 404, { requestId });

  await audit({
    action: segredo ? "gestao.segredo_trocado" : "gestao.conexao_atualizada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "gestao_conexao",
    resourceId: data.id,
    metadata: segredo ? {} : { is_active: patch.is_active },
    requestId,
  });
  return ok({ conexao: data, segredo }, { requestId });
}
