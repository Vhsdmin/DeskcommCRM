"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
export function ExcluirAtividade({
  contactId,
  activityId,
  revision,
}: {
  contactId: string;
  activityId: string;
  revision: number;
}) {
  const t = useT();
  const query = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await apiClient.delete(`/api/v1/contacts/${contactId}/timeline/${activityId}`, { revision });
      await query.invalidateQueries({ queryKey: ["timeline", contactId] });
      setOpen(false);
    } catch {
      setError(t("Não foi possível excluir a atividade. Atualize o histórico e tente novamente."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          setError("");
        }
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("Excluir atividade")}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Excluir atividade?")}</DialogTitle>
          <DialogDescription>
            {t(
              "Este registro será retirado do histórico do cliente. A exclusão ficará registrada na auditoria.",
            )}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-error-fg">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            {t("Cancelar")}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {busy ? t("Excluindo…") : t("Confirmar exclusão")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
