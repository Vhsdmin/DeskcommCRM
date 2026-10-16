"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { apiClient } from "@/lib/api/client";
import {
  PLAYBOOK_SUGERIDO,
  PRIORIDADES,
  ROTULO_DA_PRIORIDADE,
  novaChave,
  type PassoDoPlaybook,
  type Prioridade,
  type TipoComPlaybook,
} from "@/lib/cs/playbooks";
import { ROTULO_DA_SEVERIDADE, ROTULO_DO_SINAL, SEVERIDADES, type Severidade } from "@/lib/cs/sinais";

/**
 * Playbooks de CS (migration 0275): para cada tipo de alerta da Central, os
 * passos que viram tarefas enquanto o alerta está aberto. Quem administra edita;
 * os demais veem o que vai acontecer.
 */

type PlaybookDaTela = {
  tipo_sinal: TipoComPlaybook;
  configurado: boolean;
  ativo: boolean;
  passos: PassoDoPlaybook[];
  atualizado_em: string | null;
  tarefas_abertas: number;
};
type Rascunho = { ativo: boolean; passos: Array<Omit<PassoDoPlaybook, "dias"> & { dias: string }> };

const CHAVE = ["cs", "playbooks"];
const SELECT = "h-10 w-full rounded-md border bg-background px-2 text-sm";

function paraRascunho(ativo: boolean, passos: PassoDoPlaybook[]): Rascunho {
  return { ativo, passos: passos.map((p) => ({ ...p, dias: String(p.dias) })) };
}

export function PlaybooksDeCs({ gestor }: { gestor: boolean }) {
  const t = useT();
  const query = useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      (await apiClient.get<{ data: { playbooks: PlaybookDaTela[] } }>("/api/v1/cs/playbooks")).data.playbooks,
  });
  const time = useTeamMembers({ enabled: gestor });
  const membros = (time.data?.data ?? []).filter((m) => !m.revoked_at);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Playbooks")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("O que fazer quando um alerta da Central aparece. Cada passo vira uma tarefa para o responsável, com prazo; quando o alerta se resolve, as tarefas que ainda estavam abertas são canceladas.")}
        </p>
      </header>
      {query.isError ? (
        <p role="alert" className="text-sm text-error-fg">{t("Não foi possível carregar os playbooks.")}</p>
      ) : query.isPending ? (
        <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
      ) : (
        query.data.map((p) => (
          <CartaoDePlaybook key={p.tipo_sinal} playbook={p} gestor={gestor} membros={membros} />
        ))
      )}
    </div>
  );
}

function CartaoDePlaybook({
  playbook,
  gestor,
  membros,
}: {
  playbook: PlaybookDaTela;
  gestor: boolean;
  membros: Array<{ user_id: string; full_name: string | null; email: string | null }>;
}) {
  const t = useT();
  const cache = useQueryClient();
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null);
  const rotulo = ROTULO_DO_SINAL[playbook.tipo_sinal];
  const sugestao = PLAYBOOK_SUGERIDO[playbook.tipo_sinal];
  const id = `playbook-${playbook.tipo_sinal}`;

  const nome = (userId: string | null) => {
    if (!userId) return t("Dono do alerta");
    const m = membros.find((x) => x.user_id === userId);
    return m?.full_name ?? m?.email ?? t("Membro da equipe");
  };

  const salvar = useMutation({
    mutationFn: async (r: Rascunho) => {
      const passos = r.passos.map((p) => {
        const dias = Number.parseInt(p.dias, 10);
        if (!Number.isFinite(dias) || dias < 0 || dias > 90) throw new Error(t("O prazo de cada passo vai de 0 a 90 dias."));
        if (!p.titulo.trim()) throw new Error(t("Dê um título a cada passo."));
        return { ...p, titulo: p.titulo.trim(), descricao: p.descricao?.trim() || null, dias };
      });
      return apiClient.put(`/api/v1/cs/playbooks/${playbook.tipo_sinal}`, { ativo: r.ativo, passos });
    },
    onSuccess: () => {
      toast.success(t("Playbook salvo. Os alertas abertos já receberam as tarefas."));
      setRascunho(null);
      void cache.invalidateQueries({ queryKey: ["cs"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("Não foi possível salvar o playbook.")),
  });

  const cheio = (rascunho?.passos.length ?? 0) >= 10;
  const mudarPasso = (i: number, patch: Partial<Rascunho["passos"][number]>) =>
    rascunho && setRascunho({ ...rascunho, passos: rascunho.passos.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  return (
    <Card className="space-y-4 p-4" aria-labelledby={`${id}-titulo`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`${id}-titulo`} className="text-base font-semibold">{t(rotulo.titulo)}</h2>
            {playbook.configurado && playbook.ativo ? (
              <Badge variant="success">{t("Ativo")}</Badge>
            ) : (
              <Badge variant="neutral">{playbook.configurado ? t("Desligado") : t("Sem playbook")}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t(rotulo.descricao)}</p>
        </div>
        <div className="flex items-center gap-2">
          {playbook.tarefas_abertas > 0 ? (
            <Link href="/app/tasks" className="text-xs text-muted-foreground hover:underline">
              {playbook.tarefas_abertas} {t("tarefas em aberto")}
            </Link>
          ) : null}
          {gestor && !rascunho ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() =>
                setRascunho(
                  playbook.configurado
                    ? paraRascunho(playbook.ativo, playbook.passos)
                    : paraRascunho(true, sugestao),
                )
              }
            >
              {playbook.configurado ? t("Editar") : t("Configurar")}
            </Button>
          ) : null}
        </div>
      </div>

      {rascunho ? (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              id={`${id}-ativo`}
              checked={rascunho.ativo}
              onCheckedChange={(v) => setRascunho({ ...rascunho, ativo: v })}
            />
            {t("Criar tarefas automaticamente para este alerta")}
          </label>
          {rascunho.passos.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Nenhum passo. Adicione o primeiro.")}</p>
          ) : null}
          {rascunho.passos.map((p, i) => (
            <div key={p.chave} className="space-y-2 rounded-md border p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_0.6fr_0.9fr]">
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("Passo")} {i + 1}</span>
                  <Input id={`${id}-titulo-${i}`} value={p.titulo} maxLength={200} onChange={(e) => mudarPasso(i, { titulo: e.target.value })} />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("Prazo (dias)")}</span>
                  <Input id={`${id}-dias-${i}`} inputMode="numeric" value={p.dias} onChange={(e) => mudarPasso(i, { dias: e.target.value })} />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("Prioridade")}</span>
                  <select id={`${id}-prioridade-${i}`} className={SELECT} value={p.prioridade} onChange={(e) => mudarPasso(i, { prioridade: e.target.value as Prioridade })}>
                    {PRIORIDADES.map((x) => (
                      <option key={x} value={x}>{t(ROTULO_DA_PRIORIDADE[x])}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("Quando o alerta chegar a")}</span>
                  <select id={`${id}-severidade-${i}`} className={SELECT} value={p.severidade_minima} onChange={(e) => mudarPasso(i, { severidade_minima: e.target.value as Severidade })}>
                    {[...SEVERIDADES].reverse().map((x) => (
                      <option key={x} value={x}>{t(ROTULO_DA_SEVERIDADE[x])}{x === "media" ? ` (${t("desde o início")})` : ""}</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("Responsável")}</span>
                  <select id={`${id}-responsavel-${i}`} className={SELECT} value={p.responsavel_user_id ?? ""} onChange={(e) => mudarPasso(i, { responsavel_user_id: e.target.value || null })}>
                    <option value="">{t("Dono do alerta")}</option>
                    {membros.map((m) => (
                      <option key={m.user_id} value={m.user_id}>{m.full_name ?? m.email ?? m.user_id.slice(0, 8)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1 text-xs">
                <span className="text-muted-foreground">{t("Orientação (opcional)")}</span>
                <Textarea id={`${id}-descricao-${i}`} rows={2} maxLength={2000} value={p.descricao ?? ""} onChange={(e) => mudarPasso(i, { descricao: e.target.value })} />
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setRascunho({ ...rascunho, passos: rascunho.passos.filter((_, j) => j !== i) })}
              >
                {t("Remover passo")}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={cheio}
              onClick={() =>
                setRascunho({
                  ...rascunho,
                  passos: [
                    ...rascunho.passos,
                    { chave: novaChave(), titulo: "", descricao: null, dias: "1", prioridade: "medium", severidade_minima: "media", responsavel_user_id: null },
                  ],
                })
              }
            >
              {t("Adicionar passo")}
            </Button>
            {sugestao.length > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setRascunho(paraRascunho(rascunho.ativo, sugestao))}>
                {t("Usar sugestão")}
              </Button>
            ) : null}
            <Button size="sm" onClick={() => salvar.mutate(rascunho)} disabled={salvar.isPending}>
              {salvar.isPending ? t("Salvando…") : t("Salvar playbook")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRascunho(null)} disabled={salvar.isPending}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      ) : playbook.passos.length > 0 ? (
        <ol className="space-y-2">
          {playbook.passos.map((p, i) => (
            <li key={p.chave} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-medium tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className="font-medium">{p.titulo}</span>
              <span className="text-xs text-muted-foreground">
                {p.dias === 0 ? t("no mesmo dia") : `${t("em")} ${p.dias} ${p.dias === 1 ? t("dia") : t("dias")}`} ·{" "}
                {t(ROTULO_DA_PRIORIDADE[p.prioridade])} · {nome(p.responsavel_user_id)}
                {p.severidade_minima !== "media" ? ` · ${t("a partir de")} ${t(ROTULO_DA_SEVERIDADE[p.severidade_minima])}` : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          {gestor
            ? sugestao.length > 0
              ? t("Ainda sem passos. Clique em Configurar para começar pela sugestão.")
              : t("Ainda sem passos.")
            : t("Ainda sem passos. Quem administra configura aqui.")}
        </p>
      )}
    </Card>
  );
}
