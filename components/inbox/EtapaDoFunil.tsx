"use client";

import { useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

export interface EtapaDoLead {
  id: string;
  name: string;
  is_won: boolean;
  is_lost: boolean;
}

/**
 * Em que etapa do funil o lead desta conversa está — e trocá-la sem abrir o Funil.
 *
 * Move pela rota de LOTE com um lead só, e não por `/move`: no lote quem
 * posiciona o card na coluna nova é o banco (`fn_mover_leads_em_lote`), e a
 * rota já emite a mudança de etapa na timeline e nas automações. Pelo `/move`
 * o painel teria de inventar uma posição sem conhecer a coluna.
 *
 * As etapas de PERDA ficam fora: fechar como perdido exige motivo (trigger
 * `fn_validate_lost_reason_required`), e esse gesto continua no Funil, onde o
 * motivo é pedido. Lead já fechado mostra a etapa, sem oferecer troca.
 *
 * A etapa de GANHO pede confirmação: ela fecha o negócio, conta na conversão e
 * dispara as automações, e um clique errado no seletor não pode fazer isso.
 * Quem não pode mover cards (o mesmo piso `agent` da rota) só vê a etapa.
 */
export function EtapaDoFunil({
  leadId,
  status,
  etapaAtualId,
  etapas,
  onMovido,
}: {
  leadId: string;
  status: string;
  etapaAtualId: string | null;
  etapas: EtapaDoLead[];
  onMovido: () => void;
}) {
  const t = useT();
  const podeMover = usePermission("pipeline.move_card");
  const [movendo, setMovendo] = useState(false);
  const [ganhoPendente, setGanhoPendente] = useState<EtapaDoLead | null>(null);
  const atual = etapas.find((e) => e.id === etapaAtualId);
  const oferecidas = etapas.filter((e) => !e.is_lost || e.id === etapaAtualId);

  if (etapas.length === 0) return null;

  function escolher(stageId: string) {
    if (!stageId || stageId === etapaAtualId) return;
    const escolhida = etapas.find((e) => e.id === stageId);
    if (escolhida?.is_won) {
      setGanhoPendente(escolhida);
      return;
    }
    void mover(stageId);
  }

  async function mover(stageId: string) {
    setGanhoPendente(null);
    setMovendo(true);
    try {
      await apiClient.post("/api/v1/leads/bulk", {
        action: "move",
        lead_ids: [leadId],
        params: { stage_id: stageId },
      });
      onMovido();
    } catch (err) {
      showApiError(err);
    } finally {
      setMovendo(false);
    }
  }

  return (
    <div className="text-xs" data-testid="inbox-etapa-do-funil">
      <label className="block">
        <span className="font-medium text-text">{t("Etapa do funil")}</span>
        {status !== "open" || !podeMover ? (
          <p className="mt-1 text-muted-foreground">{atual?.name ?? t("Sem etapa")}</p>
        ) : (
          <select
            className="mt-1 h-7 w-full rounded-md border border-border bg-background px-2 text-xs disabled:opacity-50"
            value={etapaAtualId ?? ""}
            disabled={movendo}
            onChange={(e) => escolher(e.target.value)}
          >
            {!atual && <option value="">{t("Sem etapa")}</option>}
            {oferecidas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
      </label>
      {ganhoPendente && (
        <div
          role="alertdialog"
          aria-label={t("Fechar como ganho?")}
          className="mt-2 rounded-md border border-border bg-muted/40 p-2"
          data-testid="inbox-etapa-confirmar-ganho"
        >
          <p className="text-muted-foreground">
            {t("Mover para")} “{ganhoPendente.name}” {t("fecha o negócio como ganho.")}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void mover(ganhoPendente.id)}
            >
              {t("Confirmar")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => setGanhoPendente(null)}
            >
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
