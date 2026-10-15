/**
 * Ferramentas do assistente dos CSMs — SOMENTE LEITURA.
 *
 * Todas as consultas a clientes rodam com o client DA SESSÃO de quem pergunta:
 * a RLS decide o que ele enxerga, e o assistente nunca vê mais do que o próprio
 * CSM veria na tela. Além da RLS, toda consulta filtra a organização ativa
 * explicitamente. Nenhuma ferramenta escreve.
 *
 * Os documentos são buscados só entre os materiais marcados no agente
 * (`knowledge_source_ids` da versão em uso).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { buscarConhecimento } from "@/lib/ai/knowledge/busca";

export type FonteCitada = { tipo: "documento"; nome: string } | { tipo: "cliente"; id: string; nome: string };

export interface ContextoDasFerramentas {
  supabase: SupabaseClient;
  organizationId: string;
  knowledgeSourceIds: string[];
  /** Coleta o que foi consultado, para a tela mostrar de onde veio a resposta. */
  fontes: FonteCitada[];
}

const LIMITE_DE_CLIENTES = 10;
const LIMITE_DE_ATIVIDADES = 15;

/** Escapa curingas do `ilike` para a busca tratar o termo como texto. */
function termoSeguro(termo: string): string {
  return termo.replace(/[%_\\,()]/g, (c) => `\\${c}`);
}

function resumoDaAtividade(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { summary?: unknown; next_steps?: unknown; phase?: unknown; score?: unknown };
  if (typeof p.summary === "string") {
    return typeof p.next_steps === "string" && p.next_steps ? `${p.summary} (próximos passos: ${p.next_steps})` : p.summary;
  }
  if (typeof p.phase === "string") return `fase: ${p.phase}`;
  if (typeof p.score === "number") return `nota NPS: ${p.score}`;
  return null;
}

export function ferramentasDoAssistente(ctx: ContextoDasFerramentas): ToolSet {
  const { supabase, organizationId } = ctx;

  const ferramentas: ToolSet = {
    buscar_clientes: tool({
      description:
        "Procura clientes do CRM por nome, e-mail ou telefone. Use antes de detalhar um cliente quando só souber o nome.",
      inputSchema: z.object({ termo: z.string().trim().min(2).max(120) }),
      execute: async ({ termo }) => {
        const t = termoSeguro(termo);
        const { data, error } = await supabase
          .from("contacts")
          .select("id, name, display_name, email, phone_number, cs_phase, last_activity_at")
          .eq("organization_id", organizationId)
          .eq("is_anonymized", false)
          .is("is_merged_into", null)
          .or(`name.ilike.%${t}%,display_name.ilike.%${t}%,email.ilike.%${t}%,phone_number.ilike.%${t}%`)
          .order("name")
          .limit(LIMITE_DE_CLIENTES);
        if (error) return { erro: "Não foi possível consultar os clientes." };
        return { clientes: data ?? [], limite: LIMITE_DE_CLIENTES };
      },
    }),

    detalhe_do_cliente: tool({
      description:
        "Traz a ficha de um cliente: dados de contato, fase da jornada de CS, últimas atividades (atendimentos, reuniões, EBR/QBR), tarefas em aberto e pesquisas NPS.",
      inputSchema: z.object({ cliente_id: z.string().uuid() }),
      execute: async ({ cliente_id }) => {
        const { data: cliente, error } = await supabase
          .from("contacts")
          .select(
            "id, name, display_name, email, phone_number, cs_phase, cs_owner_user_id, gestao_account_id, tags, created_at, last_activity_at",
          )
          .eq("organization_id", organizationId)
          .eq("id", cliente_id)
          .eq("is_anonymized", false)
          .is("is_merged_into", null)
          .maybeSingle();
        if (error) return { erro: "Não foi possível consultar o cliente." };
        if (!cliente) return { erro: "Cliente não encontrado ou sem permissão." };

        const [atividades, tarefas, nps] = await Promise.all([
          supabase
            .from("crm_lead_activities")
            .select("type, performed_at, payload")
            .eq("organization_id", organizationId)
            .eq("contact_id", cliente_id)
            .order("performed_at", { ascending: false })
            .limit(LIMITE_DE_ATIVIDADES),
          supabase
            .from("crm_tasks")
            .select("title, status, due_date, priority")
            .eq("organization_id", organizationId)
            .eq("contact_id", cliente_id)
            .in("status", ["pending", "in_progress"])
            .order("due_date", { ascending: true })
            .limit(20),
          supabase
            .from("customer_nps_surveys")
            .select("created_at, answered_at, score, comment, cancelled_at, expires_at")
            .eq("organization_id", organizationId)
            .eq("contact_id", cliente_id)
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

        const nome = (cliente.name ?? cliente.display_name ?? "Cliente") as string;
        ctx.fontes.push({ tipo: "cliente", id: cliente.id as string, nome });
        return {
          cliente,
          atividades: (atividades.data ?? []).map((a) => ({
            tipo: a.type,
            em: a.performed_at,
            resumo: resumoDaAtividade(a.payload),
          })),
          tarefas_em_aberto: tarefas.data ?? [],
          nps: nps.data ?? [],
        };
      },
    }),
  };

  if (ctx.knowledgeSourceIds.length > 0) {
    ferramentas.buscar_documentos = tool({
      description:
        "Busca nos documentos internos (produto, processos, empresa) os trechos mais relevantes para a pergunta. Use sempre que a dúvida for sobre produto, processo ou empresa.",
      inputSchema: z.object({ pergunta: z.string().trim().min(3).max(500) }),
      execute: async ({ pergunta }) => {
        try {
          const r = await buscarConhecimento(supabase, {
            organizationId,
            knowledgeSourceIds: ctx.knowledgeSourceIds,
            pergunta,
            topK: 6,
            limiar: 0.3,
          });
          for (const trecho of r.trechos) {
            const nome = trecho.source_name ?? "Documento";
            if (!ctx.fontes.some((f) => f.tipo === "documento" && f.nome === nome)) {
              ctx.fontes.push({ tipo: "documento", nome });
            }
          }
          return {
            trechos: r.trechos.map((x) => ({ documento: x.source_name, conteudo: x.content })),
            nada_encontrado: r.trechos.length === 0,
          };
        } catch {
          return { erro: "A busca nos documentos não está disponível (verifique a chave da OpenAI em Credenciais)." };
        }
      },
    });
  }

  return ferramentas;
}

/** Regras fixas do assistente, acrescentadas às instruções configuradas no agente. */
export const REGRAS_DO_ASSISTENTE = `
Você é um assistente INTERNO dos CSMs da VendePay, dentro do CRM. Quem fala com você é alguém da equipe, nunca o cliente final.
- Para dúvidas sobre produto, processo ou empresa, consulte os documentos com a ferramenta buscar_documentos antes de responder.
- Para dados de clientes, use buscar_clientes e detalhe_do_cliente. Nunca invente dado de cliente.
- Se a informação não estiver nos documentos nem no CRM, diga isso claramente em vez de improvisar.
- Responda em português do Brasil, de forma objetiva, e diga de onde tirou a informação (nome do documento ou ficha do cliente).
- Você só consulta; não altera nada no CRM.
`.trim();
