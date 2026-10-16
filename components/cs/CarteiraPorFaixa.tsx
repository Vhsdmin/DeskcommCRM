"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { centavosDoTexto, reais } from "@/lib/cs/carteira";
import { cn } from "@/lib/utils";

/**
 * Carteira por faixa de faturamento (GMV dos últimos 30 dias, em BRL).
 *
 * O cliente entra na faixa do seu GMV; quando o GMV alcança uma faixa ACIMA, a
 * responsável da faixa nova recebe o alerta na Central e o assume (nunca desce
 * sozinho). Faixa de "suporte" só registra o responsável: o trabalho de CS e os
 * alertas começam na primeira faixa de CSM.
 */

type Faixa = {
  id: string;
  nome: string;
  inicio_centavos: number;
  fim_centavos: number | null;
  tipo: "suporte" | "csm";
  responsavel_user_id: string | null;
};
type Cliente = {
  id: string;
  name: string | null;
  display_name: string | null;
  carteira_faixa_id: string | null;
  cs_owner_user_id: string | null;
  gestao_gmv_30d_centavos: number | null;
  subiu_de_faixa: { faixa_nova: string | null; dono_user_id: string | null } | null;
};
type Carteira = { faixas: Faixa[]; clientes: Cliente[] };
type Rascunho = { id?: string; nome: string; inicio: string; tipo: "suporte" | "csm"; responsavel_user_id: string | null };

const CHAVE = ["cs", "carteira"];

function paraTexto(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CarteiraPorFaixa({ gestor, userId }: { gestor: boolean; userId: string }) {
  const t = useT();
  const cache = useQueryClient();
  const time = useTeamMembers({ enabled: gestor });
  const query = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<{ data: Carteira }>("/api/v1/cs/carteira")).data,
  });
  const [editando, setEditando] = React.useState<Rascunho[] | null>(null);
  const [filtro, setFiltro] = React.useState<string | "subiram" | null>(null);

  const faixas = query.data?.faixas ?? [];
  const clientes = query.data?.clientes ?? [];
  const membros = (time.data?.data ?? []).filter((m) => !m.revoked_at);

  const nome = (id: string | null) => {
    if (!id) return t("Sem responsável");
    if (id === userId) return t("Você");
    const m = membros.find((x) => x.user_id === id);
    return m?.full_name ?? m?.email ?? t("Membro da equipe");
  };

  const salvar = useMutation({
    mutationFn: async (rascunho: Rascunho[]) => {
      const faixasPayload = rascunho.map((f) => ({
        ...(f.id ? { id: f.id } : {}),
        nome: f.nome.trim(),
        inicio_centavos: centavosDoTexto(f.inicio) ?? -1,
        tipo: f.tipo,
        responsavel_user_id: f.responsavel_user_id,
      }));
      if (faixasPayload.some((f) => f.inicio_centavos < 0)) throw new Error(t("Preencha o início de cada faixa em reais."));
      return apiClient.put("/api/v1/cs/carteira/faixas", { faixas: faixasPayload });
    },
    onSuccess: () => {
      toast.success(t("Faixas salvas. Os clientes foram reposicionados."));
      setEditando(null);
      void cache.invalidateQueries({ queryKey: CHAVE });
      void cache.invalidateQueries({ queryKey: ["cs", "central"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("Não foi possível salvar as faixas.")),
  });

  const assumir = useMutation({
    mutationFn: async (contactId: string) => apiClient.post("/api/v1/cs/carteira/assumir", { contact_id: contactId }),
    onSuccess: () => {
      toast.success(t("Cliente assumido. A troca ficou no histórico dele."));
      void cache.invalidateQueries({ queryKey: CHAVE });
      void cache.invalidateQueries({ queryKey: ["cs", "central"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t("Não foi possível assumir o cliente.")),
  });

  const subiram = clientes.filter((c) => c.subiu_de_faixa);
  const visiveis =
    filtro === "subiram" ? subiram : filtro ? clientes.filter((c) => c.carteira_faixa_id === filtro) : clientes;

  function iniciarEdicao() {
    setEditando(
      faixas.length > 0
        ? faixas.map((f) => ({
            id: f.id,
            nome: f.nome,
            inicio: paraTexto(f.inicio_centavos),
            tipo: f.tipo,
            responsavel_user_id: f.responsavel_user_id,
          }))
        : [
            { nome: "Suporte", inicio: "0,00", tipo: "suporte", responsavel_user_id: null },
            { nome: "CSM", inicio: "10.000,01", tipo: "csm", responsavel_user_id: null },
            { nome: "CSM", inicio: "100.000,01", tipo: "csm", responsavel_user_id: null },
            { nome: "Head", inicio: "1.000.000,01", tipo: "csm", responsavel_user_id: null },
          ],
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Carteira")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Clientes divididos pelo faturamento dos últimos 30 dias. Quem sobe de faixa aparece para a nova responsável assumir; ninguém desce sozinho.")}
          </p>
        </div>
        {gestor && !editando ? (
          <Button variant="outline" size="sm" className="h-9 text-xs" onClick={iniciarEdicao}>
            {faixas.length > 0 ? t("Editar faixas") : t("Configurar faixas")}
          </Button>
        ) : null}
      </header>

      {query.isError ? (
        <p role="alert" className="text-sm text-error-fg">{t("Não foi possível carregar a carteira.")}</p>
      ) : null}

      {editando ? (
        <Card className="space-y-4 p-4">
          <div>
            <h2 className="text-sm font-semibold">{t("Faixas da carteira")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("Cada faixa começa no valor indicado e vai até o início da próxima. A primeira começa em R$ 0,00. Faixa de suporte só registra o responsável; os alertas de CS valem a partir das faixas de CSM.")}
            </p>
          </div>
          <div className="space-y-2">
            {editando.map((f, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[1.2fr_1fr_0.8fr_1.2fr_auto] sm:items-end">
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("Nome")}</span>
                  <Input
                    id={`faixa-nome-${i}`}
                    value={f.nome}
                    maxLength={80}
                    onChange={(e) => setEditando(editando.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))}
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("Começa em (R$)")}</span>
                  <Input
                    id={`faixa-inicio-${i}`}
                    inputMode="decimal"
                    value={f.inicio}
                    onChange={(e) => setEditando(editando.map((x, j) => (j === i ? { ...x, inicio: e.target.value } : x)))}
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("Tipo")}</span>
                  <select
                    id={`faixa-tipo-${i}`}
                    className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                    value={f.tipo}
                    onChange={(e) =>
                      setEditando(editando.map((x, j) => (j === i ? { ...x, tipo: e.target.value as "suporte" | "csm" } : x)))
                    }
                  >
                    <option value="suporte">{t("Suporte")}</option>
                    <option value="csm">{t("CSM")}</option>
                  </select>
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">{t("Responsável")}</span>
                  <select
                    id={`faixa-responsavel-${i}`}
                    className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                    value={f.responsavel_user_id ?? ""}
                    onChange={(e) =>
                      setEditando(editando.map((x, j) => (j === i ? { ...x, responsavel_user_id: e.target.value || null } : x)))
                    }
                  >
                    <option value="">{t("Sem responsável")}</option>
                    {membros.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name ?? m.email ?? m.user_id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 text-xs"
                  disabled={editando.length === 1}
                  onClick={() => setEditando(editando.filter((_, j) => j !== i))}
                >
                  {t("Remover")}
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditando([...editando, { nome: "", inicio: "", tipo: "csm", responsavel_user_id: null }])}
              disabled={editando.length >= 12}
            >
              {t("Adicionar faixa")}
            </Button>
            <Button size="sm" onClick={() => salvar.mutate(editando)} disabled={salvar.isPending}>
              {salvar.isPending ? t("Salvando…") : t("Salvar faixas")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditando(null)} disabled={salvar.isPending}>
              {t("Cancelar")}
            </Button>
          </div>
        </Card>
      ) : null}

      {query.isPending ? (
        <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
      ) : faixas.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          {gestor
            ? t("Nenhuma faixa configurada. Clique em Configurar faixas para definir os valores e os responsáveis.")
            : t("A carteira ainda não tem faixas. Quem administra configura em Carteira › Configurar faixas.")}
        </Card>
      ) : (
        <>
          <section aria-label={t("Faixas")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {faixas.map((f) => {
              const qtd = clientes.filter((c) => c.carteira_faixa_id === f.id).length;
              const ativo = filtro === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setFiltro(ativo ? null : f.id)}
                  className={cn(
                    "rounded-lg border bg-surface p-4 text-left transition-colors hover:border-accent",
                    ativo && "border-accent bg-accent-soft",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{f.nome}</span>
                    <span className="text-2xl font-semibold tabular-nums">{qtd}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {f.fim_centavos === null
                      ? `${t("Acima de")} ${reais(f.inicio_centavos)}`
                      : `${reais(f.inicio_centavos)} ${t("a")} ${reais(f.fim_centavos)}`}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                    <Badge variant={f.tipo === "csm" ? "success" : "neutral"}>{f.tipo === "csm" ? t("CSM") : t("Suporte")}</Badge>{" "}
                    <span className="text-muted-foreground">{nome(f.responsavel_user_id)}</span>
                  </div>
                </button>
              );
            })}
          </section>

          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">
                {filtro === "subiram"
                  ? t("Subiram de faixa")
                  : filtro
                    ? faixas.find((f) => f.id === filtro)?.nome
                    : t("Todos os clientes")}{" "}
                <span className="font-normal text-muted-foreground">({visiveis.length})</span>
              </h2>
              <div className="flex gap-2">
                {subiram.length > 0 ? (
                  <Button
                    variant={filtro === "subiram" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setFiltro(filtro === "subiram" ? null : "subiram")}
                  >
                    {subiram.length} {t("subiram de faixa")}
                  </Button>
                ) : null}
                {filtro ? (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFiltro(null)}>
                    {t("Ver todos")}
                  </Button>
                ) : null}
              </div>
            </div>
            {visiveis.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{t("Nenhum cliente aqui.")}</p>
            ) : (
              <ul className="divide-y">
                {visiveis.map((c) => {
                  const faixa = faixas.find((f) => f.id === c.carteira_faixa_id);
                  const podeAssumir = c.subiu_de_faixa && (gestor || c.subiu_de_faixa.dono_user_id === userId);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <Link href={`/app/contacts/${c.id}`} className="font-medium hover:underline">
                          {c.name ?? c.display_name ?? t("Cliente sem nome")}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {faixa?.nome ?? t("Sem faixa")} · {nome(c.cs_owner_user_id)} ·{" "}
                          {c.gestao_gmv_30d_centavos === null
                            ? t("faturamento ainda não informado pelo Gestão")
                            : `${reais(c.gestao_gmv_30d_centavos)} ${t("nos últimos 30 dias")}`}
                        </p>
                        {c.subiu_de_faixa ? (
                          <p className="text-xs font-medium text-warning-fg">
                            {t("Subiu para")} {c.subiu_de_faixa.faixa_nova} · {t("aguardando")}{" "}
                            {nome(c.subiu_de_faixa.dono_user_id)} {t("assumir")}
                          </p>
                        ) : null}
                      </div>
                      {podeAssumir ? (
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          disabled={assumir.isPending}
                          onClick={() => assumir.mutate(c.id)}
                        >
                          {t("Assumir cliente")}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
