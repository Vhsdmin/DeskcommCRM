"use client";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { presetDates, type PerformanceData } from "@/lib/cs/dashboard";
import { useT } from "@/hooks/i18n/useT";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { PeriodoDashboard, PaginacaoDashboard } from "./PeriodoDashboard";
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
export function DesempenhoCS({
  canCompare,
  currentUserId,
}: {
  canCompare: boolean;
  currentUserId: string;
}) {
  const t = useT();
  const locale = useTagDeIdioma();
  const [period, setPeriod] = useState(() => presetDates(30));
  const [owner, setOwner] = useState("");
  const [silence, setSilence] = useState("30");
  const [focus, setFocus] = useState("silence");
  const [offset, setOffset] = useState(0);
  const team = useTeamMembers({ enabled: canCompare });
  const params = new URLSearchParams({
    ...period,
    silence,
    focus,
    offset: String(offset),
    ...(owner ? { owner } : {}),
  });
  const query = useQuery({
    queryKey: ["cs-performance", params.toString()],
    queryFn: async () =>
      (await apiClient.get<{ data: PerformanceData }>(`/api/v1/cs/performance?${params}`)).data,
    refetchInterval: 15000,
  });
  const d = query.data;
  const name = (id: string | null) => {
    if (!id) return t("Sem responsável");
    if (id === currentUserId && !canCompare) return t("Você");
    const m = team.data?.data.find((m) => m.user_id === id);
    return m?.full_name ?? m?.email ?? `${t("Membro")} ${id.slice(0, 8)}`;
  };
  const date = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "short",
          timeZone: "America/Sao_Paulo",
        }).format(new Date(v))
      : t("Sem contato registrado");
  const total = (key: "supports" | "meetings" | "overdue_tasks" | "unattended_detractors") =>
    d?.performance.reduce((sum, r) => sum + r[key], 0) ?? 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <PeriodoDashboard
          performance
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setOffset(0);
          }}
        />
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t("Atualizar")}
        </Button>
      </div>
      {canCompare ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t("Responsável")}
          <select
            aria-label={t("Responsável")}
            className="rounded-md border bg-background p-2"
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
      ) : (
        <p className="text-sm text-muted-foreground">
          {t(
            "Você vê sua atividade e os clientes atribuídos a você. Gestores podem comparar a equipe.",
          )}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t(
          "Atendimentos e reuniões são registros manuais do Histórico, pela data e autor. Agendamentos não contam como reuniões realizadas; registros duplicados devem ser corrigidos na ficha.",
        )}
      </p>
      {query.isLoading && <p role="status">{t("Carregando…")}</p>}
      {query.isError && (
        <div role="alert" className="text-destructive">
          {t("Não foi possível carregar o desempenho CS.")}{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("Tentar novamente")}
          </Button>
        </div>
      )}
      {d && !query.isError && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              [t("Atendimentos no período"), total("supports")],
              [t("Reuniões registradas"), total("meetings")],
              [t("Tarefas atrasadas agora"), total("overdue_tasks")],
              [t(t("Detratores sem contato")), total("unattended_detractors")],
            ].map(([label, n]) => (
              <Card key={label} className="p-4">
                <p className="text-xs text-muted-foreground">{t(String(label))}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{n}</p>
              </Card>
            ))}
          </div>
          <Card className="space-y-4 p-4">
            <h2 className="font-semibold">
              {canCompare ? t("Desempenho por responsável") : t("Seu desempenho")}
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    t("Responsável"),
                    t("Atendimentos"),
                    t("Reuniões"),
                    t("EBR / QBR"),
                    t("Clientes contatados"),
                    t("Carteira atual"),
                    t("Tarefas atrasadas"),
                    t("Sem contato"),
                    t("Detratores sem contato"),
                  ].map((h) => (
                    <TableHead key={h}>{t(h)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.performance.map((r) => (
                  <TableRow key={r.user_id ?? "none"}>
                    <TableCell className="min-w-36 font-medium">{name(r.user_id)}</TableCell>
                    {[
                      r.supports,
                      r.meetings,
                      `${r.ebr} / ${r.qbr}`,
                      r.contacted_clients,
                      r.portfolio,
                      r.overdue_tasks,
                      r.silent_clients,
                      r.unattended_detractors,
                    ].map((n, i) => (
                      <TableCell key={i} className="tabular-nums">
                        {n}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {d.performance.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t(
                  "Sem atividades ou clientes atribuídos. Registre um atendimento na ficha do cliente.",
                )}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t(
                "EBR e QBR já estão incluídas em Reuniões. Carteira, atrasos e falta de contato mostram a situação atual; não são filtrados pelo período.",
              )}
            </p>
          </Card>
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <h2 className="font-semibold">{t("Clientes para acompanhar")}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={t("Motivo do acompanhamento")}
                  className="rounded-md border bg-background p-2 text-sm"
                  value={focus}
                  onChange={(e) => {
                    setFocus(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="silence">{t("Sem contato registrado")}</option>
                  <option value="detractor">{t("Detratores sem contato após resposta")}</option>
                </select>
                {focus === "silence" && (
                  <label className="text-sm">
                    {t("Há mais de")}{" "}
                    <select
                      aria-label={t("Dias sem contato")}
                      className="rounded-md border bg-background p-2"
                      value={silence}
                      onChange={(e) => {
                        setSilence(e.target.value);
                        setOffset(0);
                      }}
                    >
                      {[7, 14, 30, 60, 90].map((n) => (
                        <option key={n} value={n}>
                          {n} {t("dias")}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {focus === "silence"
                ? t(
                    "Sem atendimento ou reunião manual no prazo escolhido; sem histórico, conta desde o cadastro no CRM.",
                  )
                : t("Resposta detratora sem atendimento ou reunião manual registrado depois dela.")}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    t("Cliente"),
                    t("Responsável"),
                    t("Fase"),
                    t("Último contato"),
                    t("Próximo passo"),
                  ].map((h) => (
                    <TableHead key={h}>{t(h)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.attention.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link className="font-medium underline" href={`/app/contacts/${c.id}`}>
                        {c.name ?? t("Cliente sem nome")}
                      </Link>
                    </TableCell>
                    <TableCell>{name(c.cs_owner_user_id)}</TableCell>
                    <TableCell>{c.cs_phase ? t(c.cs_phase) : "—"}</TableCell>
                    <TableCell>
                      {date(c.last_contact)}
                      {focus === "detractor" && (
                        <p className="text-xs text-muted-foreground">
                          NPS: {date(c.detractor_since)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link className="underline" href={`/app/contacts/${c.id}?aba=tasks`}>
                        {t("Planejar contato")}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!d.attention.length && (
              <p className="text-sm text-muted-foreground">
                {t("Nenhum cliente pede acompanhamento por este critério.")}
              </p>
            )}
            <PaginacaoDashboard offset={offset} total={d.attention_total} onChange={setOffset} />
          </Card>
          <p className="text-xs text-muted-foreground">
            {t(
              "Alertas financeiros e saúde da conta dependem da integração com o Gestão. Estes critérios são sinais de acompanhamento, sem SLA automático.",
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("Atualizado em")}{" "}
            {new Intl.DateTimeFormat(locale, {
              dateStyle: "short",
              timeStyle: "short",
              timeZone: "America/Sao_Paulo",
            }).format(new Date(d.as_of))}{" "}
            · {t("Atualização a cada 15 segundos")}
          </p>
        </>
      )}
    </div>
  );
}
