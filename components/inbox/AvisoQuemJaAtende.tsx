"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth, usePermission } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useTransferConversation } from "@/hooks/inbox/useTransferConversation";
import { apiClient } from "@/lib/api/client";
import { Users } from "@/lib/ui/icons";

interface QuemJaAtende {
  user_id: string;
  nome: string | null;
  motivos: Array<"conversa_aberta" | "csm">;
  conversation_id: string | null;
  /** Membro ativo `agent`+: a transferência seria aceita. */
  pode_receber: boolean;
}

/**
 * "ALGUÉM JÁ ESTÁ FALANDO COM ESTE CLIENTE."
 *
 * Ao abrir a conversa, pergunta ao servidor se há outra conversa ativa do mesmo
 * cliente com outra pessoa, ou se o cliente tem CSM na Carteira que não é o
 * dono desta conversa. Havendo, avisa no topo — e oferece transferir para essa
 * pessoa. Não transfere sozinho: quem decide é quem está atendendo.
 *
 * A consulta é chaveada também pelo dono atual: depois de transferir, a mesma
 * conversa pergunta de novo e o aviso some, porque a pessoa já é a dona.
 */
export function AvisoQuemJaAtende({
  conversationId,
  donoAtualId,
}: {
  conversationId: string;
  donoAtualId: string | null;
}) {
  const t = useT();
  const { user } = useAuth();
  const podeTransferir = usePermission("inbox.claim") && user.support?.access_mode !== "support_readonly";
  const transferir = useTransferConversation();
  const [dispensado, setDispensado] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["quem-ja-atende", conversationId, donoAtualId],
    queryFn: async () => {
      const r = await apiClient.get<{ data: QuemJaAtende[] }>(
        `/api/v1/conversations/${conversationId}/quem-ja-atende`,
      );
      return r.data;
    },
    staleTime: 30_000,
  });

  const pessoas = data ?? [];
  if (pessoas.length === 0 || dispensado === `${conversationId}:${donoAtualId}`) return null;

  return (
    <div
      role="status"
      data-testid="aviso-quem-ja-atende"
      className="flex flex-col gap-1.5 border-b border-warning/40 bg-warning-bg px-4 py-2 text-xs text-warning-fg"
    >
      {pessoas.map((p) => {
        const nome = p.nome ?? t("Outra pessoa da equipe");
        const emConversa = p.motivos.includes("conversa_aberta");
        const ehCsm = p.motivos.includes("csm");
        const frase =
          emConversa && ehCsm
            ? t("é a CSM deste cliente e já está numa conversa aberta com ele.")
            : emConversa
              ? t("já está falando com este cliente em outra conversa.")
              : t("é a CSM deste cliente.");
        return (
          <div key={p.user_id} className="flex flex-wrap items-center gap-2">
            <Users size={14} weight="fill" aria-hidden />
            <span>
              <strong>{nome}</strong> {frase}
            </span>
            {emConversa && p.conversation_id && (
              <Link className="underline" href={`/app/inbox?id=${p.conversation_id}`}>
                {t("Ver conversa")}
              </Link>
            )}
            {podeTransferir && p.pode_receber && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                disabled={transferir.isPending}
                onClick={() =>
                  transferir.mutate({
                    conversation_id: conversationId,
                    to_user_id: p.user_id,
                    // Vira texto na timeline ("Transferiu a conversa: …"), em português
                    // canônico — quem traduz é a leitura.
                    reason: emConversa
                      ? "cliente já estava em atendimento com essa pessoa"
                      : "é a CSM do cliente",
                  })
                }
              >
                {t("Transferir para")} {nome}
              </Button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="self-start underline opacity-80"
        onClick={() => setDispensado(`${conversationId}:${donoAtualId}`)}
      >
        {t("Seguir atendendo")}
      </button>
    </div>
  );
}
