/**
 * Os FUNIS — criar, renomear, definir o padrão e configurar campos, vocabulário
 * e motivos de perda (`crm_pipelines`).
 *
 * ⚠️ POR QUE ESTA REGRA VIVE AQUI. A rota REST (`app/api/v1/pipelines`), a tela
 * Configurações › Funis (`app/actions/settings/updatePipelineConfig.ts`) e a
 * capacidade de configuração operada por pessoa pela MCP
 * (`lib/mcp/tools/configuracao.ts`) mexem nos mesmos funis. A capacidade usa o
 * service role, que bypassa RLS: todo acesso aqui filtra `organization_id`
 * explicitamente, resolvido de `deps`, nunca do input.
 *
 * ⚠️ A rota e a action continuam com o SQL delas por enquanto: a leitura de
 * funis (`app/api/v1/pipelines/_funis.ts`) é tipada pelo client de cookie e
 * esta é pelo client genérico. As regras de nome, slug, posição e padrão são as
 * MESMAS funções de `lib/pipelines/pipeline-editing.ts` nos dois caminhos — é
 * ali que mora a verdade; aqui e na rota só há a fiação.
 *
 * ⚠️ O AGENTE DE IA NUNCA CHEGA AQUI. As capacidades que chamam estas funções
 * exigem o escopo `mcp:config`, que o token efêmero do agente não carrega, e
 * são marcadas `apenasHumano` no catálogo.
 */
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { atorParaAuditoria } from "@/lib/operacao/autoria";
import type { DepsDaOperacao } from "@/lib/operacao/entradas-automaticas";
import {
  ETAPAS_INICIAIS,
  posicaoEntre,
  slugDeFunil,
  updatesDePadrao,
  validarNomeDeFunil,
  type FunilEditavel,
} from "@/lib/pipelines/pipeline-editing";
import { pipelineConfigPatchSchema, type CustomFieldDef } from "@/lib/schemas/settings";

const COLUNAS = "id, name, slug, description, position, is_default, is_archived";

export interface FunilVisivel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  is_default: boolean;
}

export interface EtapaDoFunil {
  id: string;
  name: string;
  slug: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  is_archived: boolean;
}

export interface ConfiguracaoDoFunil {
  pipeline_id: string;
  name: string;
  vocabulary: Record<string, unknown>;
  fields: CustomFieldDef[];
  lost_reasons: string[];
  stages: EtapaDoFunil[];
}

function erroInterno(deps: DepsDaOperacao, mensagem: string): ApiError {
  return new ApiError(500, "internal_error", undefined, deps.requestId, mensagem);
}

function visiveis(funis: FunilEditavel[]): FunilVisivel[] {
  return funis
    .filter((f) => !f.is_archived)
    .map(({ id, name, slug, description, position, is_default }) => ({
      id,
      name,
      slug,
      description: description ?? null,
      position,
      is_default,
    }));
}

export async function lerFunisDaOrg(deps: DepsDaOperacao): Promise<FunilEditavel[]> {
  const { data, error } = await deps.supabase
    .from("crm_pipelines")
    .select(COLUNAS)
    .eq("organization_id", deps.organizationId)
    .order("position", { ascending: true });
  if (error) throw erroInterno(deps, error.message);
  return (data ?? []) as unknown as FunilEditavel[];
}

function etapasIniciais(orgId: string, pipelineId: string) {
  return ETAPAS_INICIAIS.map((etapa, i) => ({
    organization_id: orgId,
    pipeline_id: pipelineId,
    name: etapa.name,
    slug: etapa.slug,
    position: (i + 1) * 1000,
    is_won: etapa.is_won,
    is_lost: etapa.is_lost,
  }));
}

/**
 * Cria o funil com as etapas iniciais, como a rota e a tela fazem. Se as etapas
 * falharem, o funil recém-criado é removido: ou nasce inteiro, ou não nasce.
 */
export async function criarFunil(
  deps: DepsDaOperacao,
  input: { name: string; description?: string | null },
): Promise<{ pipeline_id: string; pipelines: FunilVisivel[] }> {
  const name = input.name.trim();
  if (!name) {
    throw new ApiError(422, "unprocessable_entity", undefined, deps.requestId, "Dê um nome ao funil.");
  }
  const funis = await lerFunisDaOrg(deps);
  const veredito = validarNomeDeFunil(name, funis, null);
  if (!veredito.ok) {
    throw new ApiError(422, "unprocessable_entity", undefined, deps.requestId, veredito.erro);
  }
  const row = {
    organization_id: deps.organizationId,
    name,
    description: input.description?.trim() || null,
    slug: slugDeFunil(name, funis.map((f) => f.slug)),
    position: posicaoEntre(funis[funis.length - 1]?.position ?? null, null),
    is_default: funis.filter((f) => !f.is_archived).length === 0,
  };
  const { data: criado, error } = await deps.supabase
    .from("crm_pipelines")
    .insert(row)
    .select("id")
    .single();
  if (error || !criado) {
    if (error?.code === "23505") {
      throw new ApiError(409, "conflict", undefined, deps.requestId, `Já existe um funil chamado «${name}».`);
    }
    throw erroInterno(deps, error?.message ?? "pipeline_insert_failed");
  }
  const pipelineId = (criado as { id: string }).id;
  const { error: etapasErr } = await deps.supabase
    .from("crm_stages")
    .insert(etapasIniciais(deps.organizationId, pipelineId));
  if (etapasErr) {
    await deps.supabase
      .from("crm_pipelines")
      .delete()
      .eq("id", pipelineId)
      .eq("organization_id", deps.organizationId);
    throw erroInterno(
      deps,
      `Não consegui criar as etapas de «${name}». Nada foi salvo; tente de novo. (${etapasErr.message})`,
    );
  }
  await audit({
    action: "pipeline.created",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "crm_pipeline",
    resourceId: pipelineId,
    requestId: deps.requestId,
    metadata: { name, slug: row.slug, is_default: row.is_default, actor_type: deps.actor.type },
  });
  return { pipeline_id: pipelineId, pipelines: visiveis(await lerFunisDaOrg(deps)) };
}

/**
 * Renomeia, muda a descrição ou define o funil padrão. Não reordena: a ordem é
 * arrastada na tela, onde quem arrasta vê onde o funil caiu.
 */
export async function atualizarFunil(
  deps: DepsDaOperacao,
  input: { pipelineId: string; name?: string; description?: string | null; is_default?: boolean },
): Promise<{ pipeline: FunilVisivel; pipelines: FunilVisivel[] }> {
  const funis = await lerFunisDaOrg(deps);
  const alvo = funis.find((f) => f.id === input.pipelineId);
  if (!alvo) {
    throw new ApiError(404, "not_found", undefined, deps.requestId, "Esse funil não existe aqui.");
  }
  if (alvo.is_archived) {
    throw new ApiError(
      409,
      "state_conflict",
      undefined,
      deps.requestId,
      `O funil «${alvo.name}» está arquivado. Restaure-o pela tela antes de alterá-lo.`,
    );
  }
  const patchDoAlvo: { name?: string; description?: string | null; is_default?: boolean } = {};
  if (input.name !== undefined) {
    const veredito = validarNomeDeFunil(input.name, funis, input.pipelineId);
    if (!veredito.ok) {
      throw new ApiError(422, "unprocessable_entity", undefined, deps.requestId, veredito.erro);
    }
    patchDoAlvo.name = input.name.trim();
  }
  if (input.description !== undefined) patchDoAlvo.description = input.description?.trim() || null;
  if (input.is_default === false) {
    throw new ApiError(
      422,
      "unprocessable_entity",
      undefined,
      deps.requestId,
      `«${alvo.name}» é o funil padrão e a organização precisa de um. Marque OUTRO funil como padrão; o padrão se muda, não se apaga.`,
    );
  }
  const updates: Array<{ pipelineId: string; patch: Record<string, unknown> }> =
    input.is_default === true ? updatesDePadrao(funis, input.pipelineId) : [];
  if (Object.keys(patchDoAlvo).length > 0) {
    const i = updates.findIndex((u) => u.pipelineId === input.pipelineId);
    if (i >= 0) updates[i] = { pipelineId: input.pipelineId, patch: { ...updates[i]!.patch, ...patchDoAlvo } };
    else updates.push({ pipelineId: input.pipelineId, patch: patchDoAlvo });
  }
  if (updates.length === 0) {
    throw new ApiError(422, "unprocessable_entity", undefined, deps.requestId, "Nada para alterar.");
  }
  // Em sequência, na ordem que `updatesDePadrao` devolve: o padrão anterior sai
  // antes de o novo entrar, senão o índice único de padrão recusa.
  for (const u of updates) {
    const { error } = await deps.supabase
      .from("crm_pipelines")
      .update(u.patch)
      .eq("id", u.pipelineId)
      .eq("organization_id", deps.organizationId);
    if (!error) continue;
    if (error.code === "23505") {
      throw new ApiError(409, "conflict", undefined, deps.requestId, `Já existe um funil com esse nome.`);
    }
    throw erroInterno(deps, error.message);
  }
  await audit({
    action: "pipeline.updated",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "crm_pipeline",
    resourceId: input.pipelineId,
    requestId: deps.requestId,
    metadata: { pedido: { ...input }, updates, actor_type: deps.actor.type },
  });
  const depois = await lerFunisDaOrg(deps);
  const pipeline = visiveis(depois).find((f) => f.id === input.pipelineId);
  if (!pipeline) throw erroInterno(deps, "pipeline_vanished_after_update");
  return { pipeline, pipelines: visiveis(depois) };
}

export async function lerConfiguracaoDoFunil(
  deps: DepsDaOperacao,
  pipelineId: string,
): Promise<ConfiguracaoDoFunil> {
  const { data, error } = await deps.supabase
    .from("crm_pipelines")
    .select("id, name, vocabulary, settings")
    .eq("id", pipelineId)
    .eq("organization_id", deps.organizationId)
    .maybeSingle();
  if (error) throw erroInterno(deps, error.message);
  if (!data) {
    throw new ApiError(404, "not_found", undefined, deps.requestId, "Esse funil não existe aqui.");
  }
  const row = data as unknown as {
    id: string;
    name: string;
    vocabulary: Record<string, unknown> | null;
    settings: Record<string, unknown> | null;
  };
  const { data: etapas, error: etapasErr } = await deps.supabase
    .from("crm_stages")
    .select("id, name, slug, position, is_won, is_lost, is_archived")
    .eq("pipeline_id", pipelineId)
    .eq("organization_id", deps.organizationId)
    .order("position", { ascending: true });
  if (etapasErr) throw erroInterno(deps, etapasErr.message);
  const settings = row.settings ?? {};
  const lostReasons = Array.isArray(settings.lost_reasons)
    ? (settings.lost_reasons as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  return {
    pipeline_id: row.id,
    name: row.name,
    vocabulary: row.vocabulary ?? {},
    fields: camposDoFunil(settings),
    lost_reasons: lostReasons,
    stages: (etapas ?? []) as unknown as EtapaDoFunil[],
  };
}

/**
 * Campos do negócio, vocabulário e motivos de perda, de uma vez. O que não vier
 * fica como está; o que vier substitui a lista inteira (é o contrato da tela).
 */
export async function configurarFunil(
  deps: DepsDaOperacao,
  input: { pipelineId: string; vocabulary?: unknown; fields?: unknown; lost_reasons?: unknown },
): Promise<ConfiguracaoDoFunil> {
  const { pipelineId, ...patch } = input;
  const parsed = pipelineConfigPatchSchema.safeParse(patch);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsed.error.flatten() as unknown as Record<string, unknown>,
      deps.requestId,
      "Confira os campos, o vocabulário ou os motivos de perda.",
    );
  }
  if (
    parsed.data.vocabulary === undefined &&
    parsed.data.fields === undefined &&
    parsed.data.lost_reasons === undefined
  ) {
    throw new ApiError(422, "unprocessable_entity", undefined, deps.requestId, "Nada para alterar.");
  }
  const chaves = (parsed.data.fields ?? []).map((f) => f.key.toLowerCase());
  if (new Set(chaves).size !== chaves.length) {
    throw new ApiError(
      422,
      "unprocessable_entity",
      undefined,
      deps.requestId,
      "Há dois campos com a mesma chave. Cada campo precisa de uma chave única.",
    );
  }
  const { data: row, error: readErr } = await deps.supabase
    .from("crm_pipelines")
    .select("vocabulary, settings")
    .eq("id", pipelineId)
    .eq("organization_id", deps.organizationId)
    .maybeSingle();
  if (readErr) throw erroInterno(deps, readErr.message);
  if (!row) {
    throw new ApiError(404, "not_found", undefined, deps.requestId, "Esse funil não existe aqui.");
  }
  const atual = row as unknown as {
    vocabulary: Record<string, unknown> | null;
    settings: Record<string, unknown> | null;
  };
  const nextVocabulary = parsed.data.vocabulary
    ? { ...(atual.vocabulary ?? {}), ...parsed.data.vocabulary }
    : (atual.vocabulary ?? {});
  const nextSettings: Record<string, unknown> = { ...(atual.settings ?? {}) };
  if (parsed.data.fields !== undefined) nextSettings.fields = parsed.data.fields;
  if (parsed.data.lost_reasons !== undefined) nextSettings.lost_reasons = parsed.data.lost_reasons;
  const { error } = await deps.supabase
    .from("crm_pipelines")
    .update({ vocabulary: nextVocabulary, settings: nextSettings })
    .eq("id", pipelineId)
    .eq("organization_id", deps.organizationId);
  if (error) throw erroInterno(deps, error.message);
  await audit({
    action: "pipeline.config_updated",
    ...atorParaAuditoria(deps.actor),
    organizationId: deps.organizationId,
    resourceType: "pipeline",
    resourceId: pipelineId,
    requestId: deps.requestId,
    metadata: {
      vocabulary_changed: !!parsed.data.vocabulary,
      fields_count: parsed.data.fields?.length ?? null,
      lost_reasons_count: parsed.data.lost_reasons?.length ?? null,
      actor_type: deps.actor.type,
    },
  });
  return lerConfiguracaoDoFunil(deps, pipelineId);
}
