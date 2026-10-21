import { z } from "zod";
import { env } from "@/lib/env";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { createHmac, randomUUID } from "node:crypto";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { cadastroUsuarioSchema } from "@/lib/auth/acessos";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "team" });
  if (!auth.ok) return auth.response;
  const input = cadastroUsuarioSchema.safeParse(await req.json().catch(() => null));
  // Não devolver Zod input nem senha em mensagens, logs ou auditoria.
  if (!input.success)
    return fail(
      "validation_error",
      "Confira nome, e-mail, senha (12 a 128 caracteres), papel e acessos.",
      400,
      { requestId },
    );
  const chave = chaveDaRequisicao(req);
  if (chave && !z.uuid().safeParse(chave).success)
    return fail("validation_error", "Chave de idempotência inválida.", 400, { requestId });
  const { nome, email, senha, role, acessos } = input.data;
  const db = createAdminClient();
  const criar = async (): Promise<Response> => {
    // createUser rejeita e-mail existente. Nunca localizar e redefinir a senha de
    // uma conta preexistente: ela pode pertencer a outra organização.
    const created = await db.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { full_name: nome },
    });
    if (created.error || !created.data.user) {
      const duplicate = ["email_exists", "user_already_exists"].includes(created.error?.code ?? "");
      return fail(
        duplicate ? "conflict" : "internal_error",
        duplicate
          ? "Este e-mail já possui uma conta. Nenhuma senha ou permissão foi alterada."
          : "Não foi possível criar o usuário. Confira os dados e tente novamente.",
        duplicate ? 409 : 500,
        { requestId },
      );
    }
    const userId = created.data.user.id;
    const { data: member, error } = await db
      .from("user_organizations")
      .insert({
        user_id: userId,
        organization_id: auth.org.orgId,
        role,
        module_access: role === "admin" ? null : acessos,
        accepted_at: new Date().toISOString(),
        invited_by: auth.user.id,
      })
      .select("id")
      .single();
    if (error) {
      // Compensação apenas da conta que ESTA chamada acabou de criar.
      const cleanup = await db.auth.admin.deleteUser(userId);
      if (cleanup.error) {
        void audit({
          action: "team.creation_failed",
          organizationId: auth.org.orgId,
          actorUserId: auth.user.id,
          resourceType: "membership",
          resourceId: userId,
          requestId,
          metadata: { cleanup_required: true },
        });
      }
      return fail(
        "internal_error",
        "O vínculo não foi criado. Peça ao administrador para conferir o cadastro antes de tentar novamente.",
        500,
        { requestId },
      );
    }
    void audit({
      action: "team.user_created",
      organizationId: auth.org.orgId,
      actorUserId: auth.user.id,
      resourceType: "membership",
      resourceId: member.id,
      requestId,
      metadata: { user_id: userId, role, acessos: role === "admin" ? null : acessos },
    });
    return ok({ user_id: userId }, { status: 201, requestId });
  };
  if (!chave) return criar();
  // Não persistir a senha ou um hash simples que permita testar palpites offline.
  // Recibos são isolados por organização E administrador que iniciou o pedido.
  const resultado = await comIdempotencia({
    db,
    organizationId: auth.org.orgId,
    endpoint: `/api/v1/team/users:${auth.user.id}`,
    chave,
    corpo: {
      nome,
      email,
      role,
      acessos,
      senha_hmac: createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY).update(senha).digest("hex"),
    },
    executar: async () => {
      const response = await criar();
      return {
        resposta: (await response.json()) as Record<string, unknown>,
        status: response.status,
      };
    },
  });
  if (resultado.tipo === "conflito")
    return fail("idempotency_conflict", "Esta chave já foi usada com outro cadastro.", 409, {
      requestId,
    });
  return Response.json(resultado.resposta, {
    status: resultado.status,
    headers: { "x-request-id": requestId },
  });
}
