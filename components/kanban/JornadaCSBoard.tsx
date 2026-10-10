"use client";
import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { FASES_JORNADA_CS, type Contact } from "@/lib/types/contacts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
type Customer = Pick<
  Contact,
  | "id"
  | "organization_id"
  | "name"
  | "display_name"
  | "cs_phase"
  | "cs_owner_user_id"
  | "cs_revision"
>;
type Page = { customers: Customer[]; total: number };
export function JornadaCSBoard({
  pipelineId,
  name,
  canEdit,
}: {
  pipelineId: string;
  name: string;
  canEdit: boolean;
}) {
  const t = useT();
  const cache = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const key = ["cs", "board", pipelineId];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const response = await apiClient.get<{ data: Page }>(
        `/api/v1/pipelines/${pipelineId}/journey?page=${pageParam}`,
      );
      return response.data;
    },
    getNextPageParam: (last, pages) =>
      pages.reduce((n, p) => n + p.customers.length, 0) < last.total ? pages.length : undefined,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });
  const customers = [
    ...new Map(
      (query.data?.pages.flatMap((p) => p.customers) ?? []).map((c) => [c.id, c]),
    ).values(),
  ];
  async function move(customer: Customer, phase: string) {
    setBusy(customer.id);
    setError("");
    try {
      await apiClient.patch(`/api/v1/contacts/${customer.id}/journey`, {
        phase,
        owner_user_id: customer.cs_owner_user_id ?? null,
        revision: customer.cs_revision ?? 0,
      });
      await Promise.all([
        cache.invalidateQueries({ queryKey: key }),
        cache.invalidateQueries({ queryKey: ["contact", customer.id] }),
        cache.invalidateQueries({ queryKey: ["contacts"] }),
        cache.invalidateQueries({ queryKey: ["timeline", customer.id] }),
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status < 500
          ? err.message
          : t("Não foi possível salvar a jornada."),
      );
      if (err instanceof ApiError && err.status === 409)
        await cache.invalidateQueries({ queryKey: key });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="text-sm text-muted-foreground">
            {t(
              "Clientes na fase definida em sua ficha. Alterações no quadro também ficam no Histórico.",
            )}
          </p>
        </div>
        <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {t("Atualizar")}
        </Button>
      </header>
      {(error || query.isError) && (
        <p role="alert" className="rounded-md border p-3 text-sm text-error-fg">
          {error || t("Não foi possível carregar a jornada.")}
        </p>
      )}
      {query.isPending ? (
        <p>{t("Carregando…")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {customers.length} / {query.data?.pages[0]?.total ?? 0} {t("Clientes")} ·{" "}
            <Link className="underline" href="/app/contacts">
              {t("Definir jornada de outros clientes")}
            </Link>
          </p>
          <div className="flex flex-1 gap-3 overflow-x-auto pb-4">
            {Object.entries(FASES_JORNADA_CS).map(([phase, label]) => {
              const group = customers.filter((c) => c.cs_phase === phase);
              return (
                <section
                  key={phase}
                  aria-label={t(label)}
                  className="flex w-72 shrink-0 flex-col gap-3 rounded-lg border bg-muted/30 p-3"
                >
                  <h2 className="flex justify-between font-semibold">
                    <span>{t(label)}</span>
                    <span>{group.length}</span>
                  </h2>
                  {group.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("Nenhum cliente nesta fase.")}
                    </p>
                  )}
                  {group.map((c) => (
                    <Card key={c.id} className="space-y-3 p-3">
                      <Link
                        className="block font-medium hover:underline"
                        href={`/app/contacts/${c.id}`}
                      >
                        {c.name ?? c.display_name ?? t("Cliente")}
                      </Link>
                      {canEdit && (
                        <label className="block text-xs text-muted-foreground">
                          {t("Fase da jornada")}
                          <select
                            aria-label={`${t("Fase da jornada")}: ${c.name ?? c.display_name ?? t("Cliente")}`}
                            className="mt-1 w-full rounded-md border bg-background p-2 text-sm text-foreground"
                            value={c.cs_phase ?? ""}
                            disabled={busy !== null}
                            onChange={(e) => void move(c, e.target.value)}
                          >
                            {Object.entries(FASES_JORNADA_CS).map(([value, text]) => (
                              <option key={value} value={value}>
                                {t(text)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <Link
                        className="block text-sm text-muted-foreground underline"
                        href={`/app/contacts/${c.id}`}
                      >
                        {t("Abrir ficha do cliente")}
                      </Link>
                    </Card>
                  ))}
                </section>
              );
            })}
          </div>
          {query.hasNextPage && (
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              {t("Carregar mais clientes")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
