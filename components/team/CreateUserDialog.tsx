"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api/client";
import { cadastroUsuarioSchema, acessosValidos } from "@/lib/auth/acessos";
import { PAPEIS_HUMANOS, ROTULO_DO_PAPEL, type Role } from "@/lib/auth/types";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { AccessEditor } from "./AccessEditor";

function UserForm({
  onClose,
  onPending,
}: {
  onClose: () => void;
  onPending: (pending: boolean) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [acessos, setAcessos] = useState<string[]>([]);
  const save = useMutation({
    onMutate: () => onPending(true),
    onSettled: () => onPending(false),
    mutationFn: () => apiClient.post("/api/v1/team/users", { nome, email, senha, role, acessos }),
    onSuccess: () => {
      setSenha("");
      setConfirmacao("");
      void qc.invalidateQueries({ queryKey: ["team"] });
      toast.success(t("Usuário criado. Entregue a senha inicial à pessoa por um canal privado."));
      onClose();
    },
    onError: showApiError,
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="novo-nome">{t("Nome")}</Label>
          <Input
            disabled={save.isPending}
            id="novo-nome"
            autoComplete="off"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            maxLength={120}
          />
        </div>
        <div>
          <Label htmlFor="novo-email">{t("E-mail")}</Label>
          <Input
            disabled={save.isPending}
            id="novo-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="nova-senha">{t("Senha inicial")}</Label>
          <Input
            disabled={save.isPending}
            id="nova-senha"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            minLength={12}
            maxLength={128}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("Use de 12 a 128 caracteres.")}</p>
        </div>
        <div>
          <Label htmlFor="confirmar-senha">{t("Confirmar senha")}</Label>
          <Input
            disabled={save.isPending}
            id="confirmar-senha"
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="novo-papel">{t("Papel")}</Label>
        <select
          disabled={save.isPending}
          id="novo-papel"
          className="mt-1 block w-full rounded-md border bg-background p-2"
          value={role}
          onChange={(e) => {
            const next = e.target.value as Role;
            setRole(next);
            setAcessos(acessos.filter((a) => acessosValidos([a], next)));
          }}
        >
          {PAPEIS_HUMANOS.map((r) => (
            <option key={r} value={r}>
              {t(ROTULO_DO_PAPEL[r])}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            "O papel define as ações disponíveis; os acessos abaixo definem em quais áreas a pessoa pode trabalhar.",
          )}
        </p>
      </div>
      <AccessEditor value={acessos} onChange={setAcessos} role={role} disabled={save.isPending} />
      <p className="text-sm text-muted-foreground">
        {t("O acesso fica ativo imediatamente, sem convite por e-mail.")}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
          {t("Cancelar")}
        </Button>
        <Button
          type="submit"
          disabled={
            save.isPending ||
            senha !== confirmacao ||
            !cadastroUsuarioSchema.safeParse({ nome, email, senha, role, acessos }).success
          }
        >
          {save.isPending ? t("Criando…") : t("Criar usuário")}
        </Button>
      </div>
    </form>
  );
}
export function CreateUserDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("Novo usuário")}</Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Novo usuário")}</DialogTitle>
            <DialogDescription>
              {t("Cadastre a pessoa, defina a senha inicial e escolha os acessos ao CRM.")}
            </DialogDescription>
          </DialogHeader>
          {open && <UserForm onClose={() => setOpen(false)} onPending={setPending} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
