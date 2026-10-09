"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { TimelineItemView } from "@/lib/types/contacts";
import { TIPO_ATIVIDADE } from "@/lib/contacts/atividade-schema";
import { apiClient } from "@/lib/api/client";
function agoraLocal(value?: string) {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function RegistrarAtividade({
  contactId,
  activity,
}: {
  contactId: string;
  activity?: TimelineItemView;
}) {
  const t = useT();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const body = {
        kind: form.get("kind"),
        summary: form.get("summary"),
        next_steps: form.get("next_steps"),
        performed_at: new Date(String(form.get("date"))).toISOString(),
      };
      if (activity)
        await apiClient.patch(`/api/v1/contacts/${contactId}/timeline/${activity.id}`, {
          ...body,
          revision: activity.revision ?? 0,
        });
      else await apiClient.post(`/api/v1/contacts/${contactId}/timeline`, body);
      await client.invalidateQueries({ queryKey: ["timeline", contactId] });
      setOpen(false);
      setSaved(true);
    } catch {
      setError(t("Não foi possível registrar a atividade. Confira os campos e tente novamente."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            setError("");
          }
        }}
      >
        <Button
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          {activity ? t("Editar atividade") : t("Registrar atividade")}
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activity ? t("Editar atividade") : t("Registrar atividade")}</DialogTitle>
            <DialogDescription>
              {t("Registre o atendimento ou reunião realizada com este cliente.")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor="activity-kind">{t("Tipo")}</Label>
              <select
                id="activity-kind"
                name="kind"
                defaultValue={
                  activity
                    ? Object.entries(TIPO_ATIVIDADE).find(
                        ([, value]) => value === activity.type,
                      )?.[0]
                    : "support"
                }
                className="mt-1 w-full rounded-md border border-input bg-background p-2"
                disabled={busy}
              >
                <option value="support">{t("Atendimento")}</option>
                <option value="meeting">{t("Reunião com cliente")}</option>
                <option value="ebr">{t("Reunião EBR")}</option>
                <option value="qbr">{t("Reunião QBR")}</option>
              </select>
            </div>
            <div>
              <Label htmlFor="activity-date">{t("Data e horário")}</Label>
              <Input
                id="activity-date"
                name="date"
                type="datetime-local"
                defaultValue={agoraLocal(activity?.performed_at)}
                max={agoraLocal()}
                required
                disabled={busy}
              />
            </div>
            <div>
              <Label htmlFor="activity-summary">{t("Resumo do atendimento")}</Label>
              <Textarea
                id="activity-summary"
                name="summary"
                defaultValue={
                  typeof activity?.payload.summary === "string" ? activity.payload.summary : ""
                }
                maxLength={4000}
                required
                disabled={busy}
              />
            </div>
            <div>
              <Label htmlFor="activity-next">{t("Próximos passos")}</Label>
              <Textarea
                id="activity-next"
                name="next_steps"
                maxLength={2000}
                disabled={busy}
                defaultValue={
                  typeof activity?.payload.next_steps === "string"
                    ? activity.payload.next_steps
                    : ""
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("Para acompanhar prazos, registre uma tarefa na aba Tarefas.")}
              </p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-error-fg">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? t("Salvando…") : t("Salvar")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {activity ? t("Atividade atualizada.") : t("Atividade registrada no histórico.")}
        </p>
      )}
    </div>
  );
}
