"use client";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { presetDates, type NpsDashboardData } from "@/lib/cs/dashboard";
import { npsClass } from "@/lib/contacts/nps";
import { useT } from "@/hooks/i18n/useT";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { PeriodoDashboard, PaginacaoDashboard } from "./PeriodoDashboard";
import { VelocimetroNps } from "./VelocimetroNps";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/table";
export const STATUS_NPS = {
  all: "Todas as pesquisas",
  answered: "Respondidas",
  pending: "Aguardando resposta",
  expired: "Expiradas",
  cancelled: "Canceladas",
} as const;
const classes = {
  all: "Todas as notas",
  detractor: "Detratores (0–6)",
  neutral: "Neutros (7–8)",
  promoter: "Promotores (9–10)",
} as const;
export function NpsDashboard({ canCompare }: { canCompare: boolean }) {
  const t = useT();
  const locale = useTagDeIdioma();
  const [period, setPeriod] = useState(() => presetDates(30));
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [owner, setOwner] = useState("");
  const team = useTeamMembers({ enabled: canCompare });
  const params = new URLSearchParams({
    ...period,
    status,
    category,
    offset: String(offset),
    ...(owner ? { owner } : {}),
  });
  const query = useQuery({
    queryKey: ["cs-nps", params.toString()],
    queryFn: async () =>
      (await apiClient.get<{ data: NpsDashboardData }>(`/api/v1/cs/nps?${params}`)).data,
    refetchInterval: 15000,
  });
  const d = query.data,
    s = d?.summary;
  const date = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "America/Sao_Paulo",
        }).format(new Date(v))
      : "—";
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Dashboard NPS")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Respostas dos clientes e pesquisas que pedem acompanhamento.")}
          </p>
        </div>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t("Atualizar")}
        </Button>
      </header>
      <PeriodoDashboard
        value={period}
        onChange={(p) => {
          setPeriod(p);
          setOffset(0);
        }}
      />
      <p className="text-sm text-muted-foreground">
        {t(
          "Período pela criação da pesquisa; respostas recebidas depois também entram. Cada pesquisa conta uma vez, mesmo para o mesmo cliente.",
        )}
      </p>
      {canCompare && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t("Responsável pela pesquisa")}
          <select
            className="rounded-md border bg-background p-2"
            aria-label={t("Responsável pela pesquisa")}
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">{t("Toda a equipe")}</option>
            {(team.data?.data ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name ?? m.email ?? m.user_id.slice(0, 8)}
              </option>
            ))}
          </select>
          {team.isError && (
            <span className="text-destructive">{t("Não foi possível carregar a equipe.")}</span>
          )}
        </label>
      )}
      {query.isLoading && <p role="status">{t("Carregando…")}</p>}
      {query.isError && (
        <div role="alert" className="text-destructive">
          {t("Não foi possível carregar o dashboard NPS.")}{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("Tentar novamente")}
          </Button>
        </div>
      )}
      {s && d && !query.isError && (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
            <Card className="p-5">
              <h2 className="font-semibold">{t("Nota média consolidada")}</h2>
              <VelocimetroNps value={s.average_100} />
            </Card>
            <div className="space-y-4">
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold">{t("NPS tradicional")}</h2>
                    <p className="mt-1 text-4xl font-semibold tabular-nums">
                      {s.nps === null
                        ? "—"
                        : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(
                            s.nps,
                          )}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("Escala −100 a +100 · % promotores − % detratores")}
                    </p>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p>
                      {t("Promotores")}: <strong>{s.promoters}</strong>
                    </p>
                    <p>
                      {t("Neutros")}: <strong>{s.neutrals}</strong>
                    </p>
                    <p>
                      {t("Detratores")}: <strong>{s.detractors}</strong>
                    </p>
                  </div>
                </div>
              </Card>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  [t("Pesquisas criadas"), s.total],
                  [t("Respondidas"), s.answered],
                  [t("Não respondidas"), s.total - s.answered],
                  [
                    t("Taxa de resposta"),
                    s.total ? `${((100 * s.answered) / s.total).toFixed(1)}%` : "—",
                  ],
                ].map(([label, value]) => (
                  <Card key={label} className="p-4">
                    <p className="text-xs text-muted-foreground">{t(String(label))}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
                  </Card>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {t("Não respondidas")}: {s.pending} {t("aguardando")}, {s.expired} {t("expiradas")},{" "}
                {s.cancelled} {t("canceladas")}. {t("Só as respostas entram na média e no NPS.")}
              </p>
            </div>
          </div>
          <Card className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{t("Pesquisas e respostas")}</h2>
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label={t("Situação da pesquisa")}
                  className="rounded-md border bg-background p-2 text-sm"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setOffset(0);
                  }}
                >
                  {Object.entries(STATUS_NPS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {t(v)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("Classificação NPS")}
                  className="rounded-md border bg-background p-2 text-sm"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setOffset(0);
                  }}
                >
                  {Object.entries(classes).map(([k, v]) => (
                    <option key={k} value={k}>
                      {t(v)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {d.rows.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                {t(
                  "Nenhuma pesquisa para estes filtros. Abra a ficha de um cliente para gerar um link NPS.",
                )}{" "}
                <Link className="underline" href="/app/contacts">
                  {t("Ver clientes")}
                </Link>
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      t("Cliente"),
                      t("Criação / resposta"),
                      t("Situação"),
                      t("Nota"),
                      t("Comentário"),
                      t("Acompanhamento"),
                    ].map((h) => (
                      <TableHead key={h}>{t(h)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="min-w-36">
                        <Link
                          className="font-medium underline underline-offset-4"
                          href={`/app/contacts/${r.contact_id}?aba=nps`}
                        >
                          {r.name ?? t("Cliente sem nome")}
                        </Link>
                      </TableCell>
                      <TableCell className="min-w-36 text-xs">
                        <p>{date(r.created_at)}</p>
                        <p className="text-muted-foreground">{date(r.answered_at)}</p>
                      </TableCell>
                      <TableCell>{t(STATUS_NPS[r.status])}</TableCell>
                      <TableCell className="min-w-28">
                        {r.score === null ? (
                          "—"
                        ) : (
                          <>
                            <strong>{r.score}/10</strong>
                            <p
                              className={
                                r.score <= 6
                                  ? "text-red-600"
                                  : r.score >= 9
                                    ? "text-green-600"
                                    : "text-amber-600"
                              }
                            >
                              {t(npsClass(r.score))}
                            </p>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md min-w-48 break-words whitespace-pre-wrap">
                        {r.comment ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Link
                          className="text-sm underline"
                          href={`/app/contacts/${r.contact_id}?aba=${r.score !== null && r.score <= 6 ? "tasks" : "nps"}`}
                        >
                          {r.score !== null && r.score <= 6
                            ? t("Planejar contato")
                            : t("Abrir pesquisa")}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <PaginacaoDashboard offset={offset} total={d.filtered_total} onChange={setOffset} />
            <p className="text-xs text-muted-foreground">
              {t(
                "Os indicadores consideram todo o período, independentemente dos filtros de situação e nota da lista.",
              )}
            </p>
          </Card>
          <p className="text-xs text-muted-foreground">
            {t("Atualizado em")} {date(d.as_of)} · {t("Atualização a cada 15 segundos")}
          </p>
        </>
      )}
    </div>
  );
}
