/**
 * Aplica um evento do Gestão ao CRM: cria ou atualiza o cliente pelo ID da conta.
 *
 * Roda com o admin client (o webhook não tem sessão); por isso TODA consulta
 * filtra `organization_id`, que vem da conexão resolvida pelo token da URL —
 * nunca do corpo.
 *
 * Desfechos:
 *  - `criado`: conta nova → cliente novo, na fase Entrada da jornada;
 *  - `atualizado`: conta já vinculada → nome, e-mail e telefone atualizados;
 *  - `conflito`: o e-mail ou telefone já pertence a OUTRO cliente do CRM. Não
 *    juntamos sozinhos — quem resolve é uma pessoa, na ficha (mesclar ou
 *    corrigir). O evento fica registrado com o motivo;
 *  - `anonimizado`: a conta vinculada foi anonimizada (LGPD) e não é reaberta;
 *  - `antigo`: o evento é mais antigo (`occurred_at`) que o último já aplicado
 *    a este cliente. Entrega fora de ordem — um reenvio atrasado — não pode
 *    sobrescrever dado mais novo, então é registrado e ignorado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { camposDoCliente, type EventoDoGestao } from "./contrato";

export type DesfechoDoEvento =
  | { status: "criado"; contactId: string; telefoneRecusado: boolean }
  | { status: "atualizado"; contactId: string; telefoneRecusado: boolean }
  | { status: "conflito"; campo: "email" | "telefone"; contactId: string | null }
  | { status: "anonimizado"; contactId: string }
  | { status: "antigo"; contactId: string };

/** Qual trava única o Postgres acusou — o nome do índice diz o campo. */
function campoDoConflito(mensagem: string): "email" | "telefone" | null {
  if (mensagem.includes("uniq_contacts_org_email")) return "email";
  if (mensagem.includes("uniq_contacts_org_phone")) return "telefone";
  return null;
}

export async function processarEventoDoGestao(
  admin: SupabaseClient,
  organizationId: string,
  evento: EventoDoGestao,
): Promise<DesfechoDoEvento> {
  const campos = camposDoCliente(evento);
  const contaId = evento.account.id;

  const { data: existente, error: erroBusca } = await admin
    .from("contacts")
    .select("id, is_anonymized, source_metadata")
    .eq("organization_id", organizationId)
    .eq("gestao_account_id", contaId)
    .is("is_merged_into", null)
    .maybeSingle();
  if (erroBusca) throw new Error(erroBusca.message);

  const metadata = {
    gestao_account_id: contaId,
    gestao_event_id: evento.event_id,
    gestao_occurred_at: evento.occurred_at,
  };

  if (existente) {
    if (existente.is_anonymized) return { status: "anonimizado", contactId: existente.id as string };
    const aplicadoEm = (existente.source_metadata as { gestao_occurred_at?: unknown } | null)
      ?.gestao_occurred_at;
    if (
      typeof aplicadoEm === "string" &&
      Date.parse(evento.occurred_at) < Date.parse(aplicadoEm)
    ) {
      return { status: "antigo", contactId: existente.id as string };
    }
    const patch: Record<string, unknown> = { name: campos.name, source_metadata: metadata };
    if (campos.email !== null) patch.email = campos.email;
    if (campos.phone_number !== null) patch.phone_number = campos.phone_number;
    const { error } = await admin
      .from("contacts")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", existente.id);
    if (error) {
      const campo = error.code === "23505" ? campoDoConflito(error.message) : null;
      if (campo) return { status: "conflito", campo, contactId: existente.id as string };
      throw new Error(error.message);
    }
    return { status: "atualizado", contactId: existente.id as string, telefoneRecusado: campos.telefoneRecusado };
  }

  const { data: criado, error } = await admin
    .from("contacts")
    .insert({
      organization_id: organizationId,
      name: campos.name,
      email: campos.email,
      phone_number: campos.phone_number,
      source: "gestao",
      source_metadata: metadata,
      gestao_account_id: contaId,
      cs_phase: "entrada",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const campo = campoDoConflito(error.message);
      if (campo) return { status: "conflito", campo, contactId: null };
      // Corrida: outro envio vinculou a mesma conta entre a busca e o insert.
      if (error.message.includes("uniq_contacts_org_gestao_account")) {
        return processarEventoDoGestao(admin, organizationId, evento);
      }
    }
    throw new Error(error.message);
  }
  return { status: "criado", contactId: criado.id as string, telefoneRecusado: campos.telefoneRecusado };
}
