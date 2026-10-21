"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { acessosValidos } from "@/lib/auth/acessos";
import type { Role } from "@/lib/auth/types";
import type { TeamMember } from "@/hooks/team/useTeamMembers";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { AccessEditor } from "./AccessEditor";
export function MemberAccessDialog({
  member,
  onClose,
}: {
  member: TeamMember;
  onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const role = member.role as Role;
  const [acessos, setAcessos] = useState(
    member.module_access ?? NAV_CATALOG.map((d) => d.href).filter((a) => acessosValidos([a], role)),
  );
  const save = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/team/${member.user_id}/acessos`, { acessos }),
    onError: showApiError,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["team"] });
      toast.success(t("Acessos atualizados."));
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Permissões de acesso")}</DialogTitle>
          <DialogDescription>{member.full_name ?? member.email}</DialogDescription>
        </DialogHeader>
        <AccessEditor value={acessos} onChange={setAcessos} role={role} disabled={save.isPending} />
        <Button disabled={save.isPending || role === "admin"} onClick={() => save.mutate()}>
          {save.isPending ? t("Salvando…") : t("Salvar permissões")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
