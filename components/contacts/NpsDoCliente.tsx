"use client";
import { copyToClipboard } from "@/lib/clipboard";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { npsClass, type NpsSurvey } from "@/lib/contacts/nps";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
export function NpsDoCliente({
  contactId,
  canEdit,
  manager,
  actorId,
}: {
  contactId: string;
  canEdit: boolean;
  manager: boolean;
  actorId: string;
}) {
  const t = useT();
  const locale = useTagDeIdioma();
  const cache = useQueryClient();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const key = ["nps", contactId];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await apiClient.get<{ data: { surveys: NpsSurvey[]; as_of: string } }>(
        `/api/v1/contacts/${contactId}/nps`,
      );
      return r.data;
    },
    refetchInterval: 15000,
  });
  async function manage(action: "create" | "cancel", survey_id?: string) {
    setBusy(true);
    setUrl("");
    setError("");
    setCopied(false);
    try {
      const r = await apiClient.post<{ data: { path?: string } }>(
        `/api/v1/contacts/${contactId}/nps`,
        { action, ...(survey_id ? { survey_id } : {}) },
      );
      setUrl(r.data.path ? new URL(r.data.path, window.location.origin).href : "");
      await Promise.all([
        cache.invalidateQueries({ queryKey: key }),
        cache.invalidateQueries({ queryKey: ["timeline", contactId] }),
      ]);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status < 500
          ? e.message
          : t("Não foi possível alterar a pesquisa."),
      );
    } finally {
      setBusy(false);
    }
  }
  const date = (s: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(s));
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{t("NPS do cliente")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("De 0 a 10, qual a probabilidade de você recomendar a VendePay a um amigo ou colega?")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("0–6: detrator · 7–8: neutro · 9–10: promotor")}
        </p>
        {canEdit && (
          <>
            <p className="text-sm text-muted-foreground">
              {t(
                "O link vale por 30 dias e aceita uma resposta. Gerar outro cancela o link pendente anterior.",
              )}
            </p>
            <Button disabled={busy} onClick={() => void manage("create")}>
              {busy ? t("Aguarde…") : t("Gerar link NPS")}
            </Button>
          </>
        )}
        {url && (
          <div className="space-y-2">
            <label className="block text-sm">
              {t("Link da pesquisa")}
              <input
                className="mt-1 w-full rounded-md border bg-background p-2"
                value={url}
                readOnly
                onFocus={(e) => e.target.select()}
              />
            </label>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  if (await copyToClipboard(url)) setCopied(true);
                  else setError(t("Selecione e copie o link acima."));
                } catch {
                  setError(t("Selecione e copie o link acima."));
                }
              }}
            >
              {copied ? t("Link copiado") : t("Copiar link")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("Copie este link antes de sair da ficha. Ele não será exibido novamente.")}
            </p>
            {url.startsWith("http://127.0.0.1") && (
              <p className="text-xs text-muted-foreground">
                {t(
                  "Link de desenvolvimento: acessível apenas neste computador. O envio aos clientes depende da publicação do CRM.",
                )}
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-error-fg">
            {error}
          </p>
        )}
      </Card>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t("Pesquisas e respostas")}</h3>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t("Atualizar")}
        </Button>
      </div>
      {query.isPending ? (
        <p>{t("Carregando…")}</p>
      ) : query.isError ? (
        <p role="alert">{t("Não foi possível carregar o NPS.")}</p>
      ) : query.data?.surveys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("Nenhuma pesquisa criada para este cliente.")}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("Últimas 100 pesquisas do cliente.")}</p>
          {query.data?.surveys.map((s) => {
            const pending =
              s.score === null &&
              !s.cancelled_at &&
              new Date(s.expires_at).getTime() > new Date(query.data!.as_of).getTime();
            return (
              <Card key={s.id} className="space-y-2 p-4">
                <p className="text-sm text-muted-foreground">
                  {t("Criada em")}: {date(s.created_at)}
                </p>
                {s.score !== null ? (
                  <>
                    <p className="font-semibold">
                      {s.score}/10 · {t(npsClass(s.score))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("Respondida em")}: {date(s.answered_at!)}
                    </p>
                    {s.comment && (
                      <p className="text-sm break-words whitespace-pre-wrap">{s.comment}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      {t(
                        s.cancelled_at ? "Cancelada" : pending ? "Aguardando resposta" : "Expirada",
                      )}
                    </p>
                    {pending && (
                      <p className="text-xs text-muted-foreground">
                        {t("Expira em")}: {date(s.expires_at)}
                      </p>
                    )}
                    {pending && canEdit && (manager || s.created_by_user_id === actorId) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void manage("cancel", s.id)}
                      >
                        {t("Cancelar link")}
                      </Button>
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
