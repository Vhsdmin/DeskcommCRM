/**
 * PRODUTOS do catálogo, cadastro e alteração (`catalog_products`).
 *
 * ⚠️ MESMA REGRA DAS ROTAS `app/api/v1/products` e `[id]`: o schema é o delas
 * (`produtoCreateSchema` / `produtoPatchSchema`), a moeda vem da organização e
 * nunca do input, a origem é `manual`, e código repetido vira 409. As rotas
 * seguem com o SQL delas, preso ao client de cookie; a regra é a mesma.
 */
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { atorParaAuditoria } from "@/lib/operacao/autoria";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";
import { COLUNAS_DO_PRODUTO, produtoCreateSchema, produtoPatchSchema } from "@/lib/schemas/produtos";

function invalido(deps: DepsDaOperacao, detalhes: unknown): ApiError {
  return new ApiError(
    400,
    "invalid_request",
    detalhes as Record<string, unknown>,
    deps.requestId,
    "Confira os dados do produto.",
  );
}

export async function criarProduto(
  deps: DepsDaOperacao,
  input: unknown,
): Promise<Record<string, unknown>> {
  const parsed = produtoCreateSchema.safeParse(input);
  if (!parsed.success) throw invalido(deps, parsed.error.flatten());
  const moeda = await moedaDaOrganizacao(deps.supabase, deps.organizationId);
  const { data, error } = await deps.supabase
    .from("catalog_products")
    .insert({ ...parsed.data, moeda, organization_id: deps.organizationId, origem: "manual" })
    .select(COLUNAS_DO_PRODUTO)
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      throw new ApiError(409, "conflict", undefined, deps.requestId, "Já existe um produto com esse código.");
    }
    throw new ApiError(500, "internal_error", undefined, deps.requestId, error?.message ?? "product_insert_failed");
  }
  const produto = data as unknown as Record<string, unknown> & { id: string };
  await audit({
    action: "catalog_product.created",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "catalog_products",
    resourceId: produto.id,
    requestId: deps.requestId,
    metadata: { actor_type: deps.actor.type },
  });
  return produto;
}

export async function atualizarProduto(
  deps: DepsDaOperacao,
  input: { id: string; patch: unknown },
): Promise<Record<string, unknown>> {
  const parsed = produtoPatchSchema.safeParse(input.patch);
  if (!parsed.success) throw invalido(deps, parsed.error.flatten());
  if (Object.keys(parsed.data).length === 0) {
    throw new ApiError(422, "unprocessable_entity", undefined, deps.requestId, "Nada para alterar.");
  }
  const { data, error } = await deps.supabase
    .from("catalog_products")
    .update(parsed.data)
    .eq("organization_id", deps.organizationId)
    .eq("id", input.id)
    .select(COLUNAS_DO_PRODUTO)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      throw new ApiError(409, "conflict", undefined, deps.requestId, "Já existe um produto com esse código.");
    }
    throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  }
  if (!data) throw new ApiError(404, "not_found", undefined, deps.requestId, "Produto não encontrado.");
  await audit({
    action: "catalog_product.updated",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "catalog_products",
    resourceId: input.id,
    requestId: deps.requestId,
    metadata: { fields_changed: Object.keys(parsed.data), actor_type: deps.actor.type },
  });
  return data as unknown as Record<string, unknown>;
}
