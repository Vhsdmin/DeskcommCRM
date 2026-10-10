"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { FASES_JORNADA_CS as fases, type Contact } from "@/lib/types/contacts";
import { ApiError } from "@/lib/api/types";
interface Member {
  user_id: string;
  full_name: string | null;
  role: string;
  accepted_at: string | null;
  revoked_at: string | null;
}
export function JornadaDoCliente({
  contact,
  actorId,
  actorName,
  canEdit,
  manager,
  onTasks,
}: {
  contact: Contact;
  actorId: string;
  actorName: string;
  canEdit: boolean;
  manager: boolean;
  onTasks: () => void;
}) {
  const t = useT();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const members = useQuery({
    queryKey: ["cs", "team", contact.organization_id],
    enabled: manager,
    queryFn: async () => {
      const r = await apiClient.get<{ data: Member[] }>("/api/v1/team");
      return r.data.filter((m) => m.accepted_at && !m.revoked_at && m.role !== "viewer");
    },
  });
  const owner = members.data?.find((m) => m.user_id === contact.cs_owner_user_id);
  const nome =
    contact.cs_owner_user_id === actorId
      ? actorName
      : (owner?.full_name ??
        (contact.cs_owner_user_id ? t("Responsável atual") : t("Sem responsável")));
  const phase =
    contact.cs_phase && contact.cs_phase in fases
      ? fases[contact.cs_phase as keyof typeof fases]
      : t("Não definida");
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await apiClient.patch(`/api/v1/contacts/${contact.id}/journey`, {
        phase: data.get("phase") || null,
        owner_user_id: data.get("owner") || null,
        revision: contact.cs_revision ?? 0,
      });
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["contact", contact.id] }),
        cache.invalidateQueries({ queryKey: ["contacts"] }),
        cache.invalidateQueries({ queryKey: ["cs", "board"] }),
        cache.invalidateQueries({ queryKey: ["timeline", contact.id] }),
      ]);
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status < 500
          ? err.message
          : t("Não foi possível salvar a jornada."),
      );
    } finally {
      setBusy(false);
    }
  }
  const people = members.data ?? [
    {
      user_id: actorId,
      full_name: actorName,
      role: "agent",
      accepted_at: "active",
      revoked_at: null,
    },
  ];
  return (
    <Card className="mb-4 space-y-4 p-4">
      <div>
        <h2 className="font-semibold">{t("Jornada de atendimento")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Acompanhamento interno do cliente. Os próximos passos ficam nas tarefas vinculadas.")}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t("Fase da jornada")}</dt>
          <dd>{t(phase)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("Responsável pelo acompanhamento")}</dt>
          <dd>{nome}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onTasks}>
          {t("Ver próximas tarefas")}
        </Button>
        {canEdit && (
          <Button
            variant="outline"
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            {t("Editar jornada")}
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Editar jornada")}</DialogTitle>
            <DialogDescription>
              {t(
                "Defina a fase e quem acompanha este cliente. A alteração será registrada no histórico.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <label className="block text-sm">
              {t("Fase da jornada")}
              <select
                name="phase"
                defaultValue={contact.cs_phase ?? ""}
                disabled={busy}
                className="mt-1 w-full rounded-md border bg-background p-2"
              >
                <option value="">{t("Não definida")}</option>
                {Object.entries(fases).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t("Responsável pelo acompanhamento")}
              <select
                name="owner"
                defaultValue={contact.cs_owner_user_id ?? ""}
                disabled={busy || (manager && (members.isPending || members.isError))}
                className="mt-1 w-full rounded-md border bg-background p-2"
              >
                <option value="" disabled={!manager && !!contact.cs_owner_user_id}>
                  {t("Sem responsável")}
                </option>
                {contact.cs_owner_user_id &&
                  !people.some((p) => p.user_id === contact.cs_owner_user_id) && (
                    <option value={contact.cs_owner_user_id}>{t("Responsável atual")}</option>
                  )}
                {people.map((p) => (
                  <option value={p.user_id} key={p.user_id}>
                    {p.full_name ?? t("Membro da equipe")}
                  </option>
                ))}
              </select>
            </label>
            {members.isError && manager && (
              <p role="alert" className="text-sm text-error-fg">
                {t("Não foi possível carregar a equipe. Tente novamente.")}
                <Button type="button" variant="outline" onClick={() => void members.refetch()}>
                  {t("Tentar novamente")}
                </Button>
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-error-fg">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy || (manager && (members.isPending || members.isError))}
            >
              {busy ? t("Salvando…") : t("Salvar")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
