"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { apiClient } from "@/lib/api/client";
import {
  ROTULO_DA_SEVERIDADE,
  ROTULO_DO_SINAL,
  TIPOS_DE_SINAL,
  type Severidade,
  type TipoDeSinal,
} from "@/lib/cs/sinais";
import { cn } from "@/lib/utils";

/**
 * Central de Prioridades: onde o CSM deve trabalhar hoje.
 *
 * Os sinais nascem e se resolvem sozinhos (`fn_cs_recalcular_sinais`): o CSM não
 * "fecha alerta" — ele atende, conclui a tarefa, o seller volta a vender, e o
 * sinal sai da lista no próximo recálculo (ao abrir a tela ou a cada hora).
 */

type Sinal = {
  id: string;
  contact_id: string;
  tipo: TipoDeSinal;
  severidade: Severidade;
  motivo: string;
  dono_user_id: string | null;
  prazo: string;
  detectado_em: string;
  contacts: { name: string | null; display_name: string | null; cs_phase: string | null } | null;
};
type Central = { sinais: Sinal[]; vendas_conectadas: boolean; atualizado_em: string };

const COR_DA_SEVERIDADE: Record<Severidade, "error" | "warning" | "neutral"> = {
  critica: "error",
  alta: "warning",
  media: "neutral",
};

export function CentralDePrioridades({ gestor, userId }: { gestor: boolean; userId: string }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  const [escopo, setEscopo] = React.useState<"meus" | "equipe">(gestor ? "equipe" : "meus");
  const [filtro, setFiltro] = React.useState<TipoDeSinal | null>(null);
  const time = useTeamMembers({ enabled: gestor });

  const query = useQuery({
    queryKey: ["cs", "central", escopo],
    queryFn: async () =>
      (await apiClient.get<{ data: Central }>(`/api/v1/cs/central?escopo=${escopo}`)).data,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const sinais = query.data?.sinais ?? [];
  const visiveis = filtro ? sinais.filter((s) => s.tipo === filtro) : sinais;
  const porTipo = (tipo: TipoDeSinal) => sinais.filter((s) => s.tipo === tipo);
  const criticos = sinais.filter((s) => s.severidade === "critica").length;
  // Referência do servidor: render puro, e o "vencido" bate com o recálculo.
  const agora = query.data ? Date.parse(query.data.atualizado_em) : 0;

  const nomeDoDono = (id: string | null) => {
    if (!id) return t("Sem responsável");
    if (id === userId) return t("Você");
    const m = time.data?.data.find((x) => x.user_id === id);
    return m?.full_name ?? m?.email ?? t("Membro da equipe");
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Central de Prioridades")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Onde trabalhar hoje. Cada item sai da lista sozinho quando a situação é resolvida.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border bg-muted p-0.5">
            {(
              [
                ["meus", t("Minha carteira")],
                ["equipe", t("Toda a equipe")],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={escopo === valor}
                onClick={() => setEscopo(valor)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  escopo === valor
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {t("Atualizar")}
          </Button>
        </div>
      </header>

      {query.isError ? (
        <p role="alert" className="text-sm text-error-fg">
          {t("Não foi possível carregar a Central.")}
        </p>
      ) : null}

      <section aria-label={t("Resumo")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TIPOS_DE_SINAL.map((tipo) => {
          const itens = porTipo(tipo);
          const aguardaGestao = tipo === "sem_venda" && query.data && !query.data.vendas_conectadas;
          const ativo = filtro === tipo;
          return (
            <button
              key={tipo}
              type="button"
              aria-pressed={ativo}
              onClick={() => setFiltro(ativo ? null : tipo)}
              className={cn(
                "rounded-lg border bg-surface p-4 text-left transition-colors hover:border-accent",
                ativo && "border-accent bg-accent-soft",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{t(ROTULO_DO_SINAL[tipo].titulo)}</span>
                <span className="text-2xl font-semibold tabular-nums">
                  {query.isPending ? "—" : itens.length}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {aguardaGestao
                  ? t("Aguardando a integração com o Gestão (data da última venda).")
                  : t(ROTULO_DO_SINAL[tipo].descricao)}
              </p>
              {itens.some((s) => s.severidade === "critica") ? (
                <p className="mt-1 text-xs font-medium text-error-fg">
                  {itens.filter((s) => s.severidade === "critica").length} {t("crítico(s)")}
                </p>
              ) : null}
            </button>
          );
        })}
      </section>

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            {filtro ? t(ROTULO_DO_SINAL[filtro].titulo) : t("Tudo o que pede ação")}{" "}
            <span className="font-normal text-muted-foreground">({visiveis.length})</span>
          </h2>
          {criticos > 0 && !filtro ? (
            <span className="text-xs font-medium text-error-fg">
              {criticos} {t("crítico(s) primeiro")}
            </span>
          ) : null}
          {filtro ? (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFiltro(null)}>
              {t("Ver todos")}
            </Button>
          ) : null}
        </div>
        {query.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">{t("Carregando…")}</p>
        ) : visiveis.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {escopo === "meus"
              ? t("Nada pendente na sua carteira agora.")
              : t("Nada pendente na equipe agora.")}
          </p>
        ) : (
          <ul className="divide-y">
            {visiveis.map((s) => {
              const vencido = Date.parse(s.prazo) < agora;
              const nome = s.contacts?.name ?? s.contacts?.display_name ?? t("Cliente sem nome");
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={COR_DA_SEVERIDADE[s.severidade]}>
                        {t(ROTULO_DA_SEVERIDADE[s.severidade])}
                      </Badge>
                      <Link
                        href={`/app/contacts/${s.contact_id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {nome}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        · {t(ROTULO_DO_SINAL[s.tipo].titulo)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{s.motivo}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-muted-foreground">{nomeDoDono(s.dono_user_id)}</span>
                    <span className={vencido ? "font-medium text-error-fg" : "text-muted-foreground"}>
                      {vencido ? t("Prazo vencido") : t("Prazo")}{" "}
                      {new Date(s.prazo).toLocaleDateString(idioma)}
                    </span>
                    <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                      <Link
                        href={
                          s.tipo === "tarefa_vencida"
                            ? `/app/contacts/${s.contact_id}?aba=tasks`
                            : `/app/contacts/${s.contact_id}?aba=timeline`
                        }
                      >
                        {s.tipo === "tarefa_vencida" ? t("Ver tarefas") : t("Abrir ficha")}
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {query.data ? (
        <p className="text-xs text-muted-foreground">
          {t("Atualizado em")} {new Date(query.data.atualizado_em).toLocaleString(idioma)} ·{" "}
          {t("Regras v1: sem vender 7/15/30 dias, detrator sem retorno, tarefa vencida, sem contato 30/60 dias, onboarding parado 14 dias, sem responsável.")}
        </p>
      ) : null}
    </div>
  );
}
