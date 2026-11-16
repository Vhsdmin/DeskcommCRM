/**
 * GET /api/v1/conversation-tags — vocabulário canônico de tags de conversa da
 * org ativa (spec 13 §3.3, G3-05). Sugestões para o inbox.
 *
 * `?todas=1` acrescenta as etiquetas EM USO em clientes (`contacts.tags`) e em
 * leads (`crm_leads.tags`). É o vocabulário dos EDITORES do Inbox: quem já criou
 * a etiqueta "vip" em Clientes precisa encontrá-la ao etiquetar a conversa. O
 * FILTRO da lista de conversas segue sem o parâmetro — oferecer ali uma etiqueta
 * que só existe em cliente devolveria zero conversas, que é exatamente o defeito
 * que a migration 0244 veio desfazer.
 *
 * Server route (não query browser-supabase direta): o cookie de sessão é
 * HttpOnly, então o client do browser não lê a sessão — leitura autenticada
 * passa pelo servidor, mesmo padrão do board de pipelines.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { canonicalConversationTagsSchema } from "@/lib/schemas/settings";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const raw = (data?.settings as Record<string, unknown> | null)?.[
    "canonical_conversation_tags"
  ];
  const canonicas = canonicalConversationTagsSchema.parse(raw ?? []);

  // ─── E AS QUE ESTÃO EM USO ───────────────────────────────────────────────
  //
  // Só o vocabulário canônico é uma lista curada à mão. Medido numa instalação
  // real: o seletor oferecia 8 etiquetas de semente, NENHUMA conversa tinha
  // etiqueta, filtrar por qualquer uma devolvia zero — e a etiqueta que a lista
  // de conversas EXIBIA não estava entre as 8. O operador vê a etiqueta na tela
  // e não consegue filtrar por ela.
  //
  // A organização vem de `requireRole`, NUNCA do body. E `supabase` aqui é o
  // client da SESSÃO: a função é `security invoker`, então a RLS de
  // `conversations` isola sozinha — pedir a de outra organização devolve zero.
  const { data: emUso, error: erroEmUso } = await supabase.rpc(
    "fn_tags_de_conversa_em_uso",
    { p_org: activeOrg.orgId },
  );
  // A falha SOBE. Engolir devolveria o vocabulário curado como se fosse a lista
  // completa — que é exatamente a mentira que esta rota veio desfazer.
  if (erroEmUso) return fail("internal_error", erroEmUso.message, 500, { requestId });

  const usadas = (emUso ?? []).map((l: { tag: string }) => l.tag);

  let deOutrosCadastros: string[] = [];
  if (req.nextUrl.searchParams.get("todas") === "1") {
    const [deClientes, deLeads] = await Promise.all([
      tagsEmUso(supabase, "contacts", activeOrg.orgId),
      tagsEmUso(supabase, "crm_leads", activeOrg.orgId),
    ]);
    const falha = deClientes.error ?? deLeads.error;
    if (falha) return fail("internal_error", falha, 500, { requestId });
    deOutrosCadastros = [...deClientes.tags, ...deLeads.tags];
  }

  const tags = [...new Set([...canonicas, ...usadas, ...deOutrosCadastros])].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  return ok(tags, { requestId });
}

/** Linhas lidas por página e teto total por tabela. */
const PAGINA = 1000;
const TETO_DE_LINHAS = 10_000;

/**
 * As etiquetas distintas de uma tabela com coluna `tags text[]`.
 *
 * Sem função no banco de propósito: o PostgREST não expressa `distinct unnest`,
 * e uma função nova exigiria a manutenção controlada do banco de produção. Lê só
 * a coluna `tags` das linhas que têm alguma, em páginas, até um teto — sobra
 * folga para a carteira atual, e a RLS da sessão isola a organização como em
 * qualquer leitura desta rota. Se o teto um dia apertar, o caminho é uma função
 * `security invoker` irmã da `fn_tags_de_conversa_em_uso` (0244).
 */
async function tagsEmUso(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tabela: "contacts" | "crm_leads",
  orgId: string,
): Promise<{ tags: string[]; error: string | null }> {
  const vistas = new Set<string>();
  for (let inicio = 0; inicio < TETO_DE_LINHAS; inicio += PAGINA) {
    const { data, error } = await supabase
      .from(tabela)
      .select("tags")
      .eq("organization_id", orgId)
      .not("tags", "eq", "{}")
      .order("id")
      .range(inicio, inicio + PAGINA - 1);
    if (error) return { tags: [], error: error.message };
    for (const linha of (data ?? []) as Array<{ tags: string[] | null }>) {
      for (const tag of linha.tags ?? []) if (tag.trim()) vistas.add(tag);
    }
    if ((data ?? []).length < PAGINA) break;
  }
  return { tags: [...vistas], error: null };
}
