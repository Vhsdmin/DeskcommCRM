"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { copyToClipboard } from "@/lib/clipboard";
import { Copy, PlugsConnected } from "@/lib/ui/icons";

/**
 * Webhooks › Receber dados: a conexão com o Gestão VendePay.
 *
 * Uma conexão por organização. O Gestão envia "conta cadastrada" e "conta
 * atualizada" para o endereço abaixo, assinando cada envio com o segredo; o CRM
 * cria ou atualiza o cliente pelo ID da conta. O contrato completo está em
 * `lib/gestao/contrato.ts`.
 */

type Conexao = {
  id: string;
  path_token: string;
  is_active: boolean;
  last_received_at: string | null;
  created_at: string;
};

type Envio = {
  id: string;
  event_type: string | null;
  external_id: string | null;
  status: "received" | "processed" | "error" | "dead";
  error_message: string | null;
  received_at: string;
};

type Estado = { conexao: Conexao | null; envios: Envio[] };
type RespostaComSegredo = { conexao: Conexao; segredo: string | null };

const CHAVE = ["integracoes", "gestao"];

const EXEMPLO = `{
  "event_id": "evt_123",
  "event_type": "account.created",
  "occurred_at": "2026-10-14T12:00:00Z",
  "account": {
    "id": "ID-do-usuario-no-Gestao",
    "name": "Loja Exemplo",
    "email": "contato@exemplo.com",
    "phone": "+5511999998888"
  }
}`;

function dataHora(iso: string | null, idioma: string): string {
  return iso ? new Date(iso).toLocaleString(idioma) : "—";
}

export function ConexaoGestaoTab() {
  const t = useT();
  const idioma = useTagDeIdioma();
  const cache = useQueryClient();
  const [segredo, setSegredo] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<{ data: Estado }>("/api/v1/integracoes/gestao")).data,
    refetchInterval: 15000,
  });

  const aoFalhar = (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : t("Não foi possível salvar. Tente de novo."));

  const criar = useMutation({
    mutationFn: async () =>
      (await apiClient.post<{ data: RespostaComSegredo }>("/api/v1/integracoes/gestao", {})).data,
    onSuccess: (r) => {
      setSegredo(r.segredo);
      void cache.invalidateQueries({ queryKey: CHAVE });
    },
    onError: aoFalhar,
  });

  const alterar = useMutation({
    mutationFn: async (body: { is_active: boolean } | { trocar_segredo: true }) =>
      (await apiClient.patch<{ data: RespostaComSegredo }>("/api/v1/integracoes/gestao", body)).data,
    onSuccess: (r) => {
      if (r.segredo) setSegredo(r.segredo);
      void cache.invalidateQueries({ queryKey: CHAVE });
    },
    onError: aoFalhar,
  });

  const copiar = async (texto: string, rotulo: string) => {
    if (await copyToClipboard(texto)) toast.success(rotulo);
    else toast.error(t("Não foi possível copiar — selecione e copie manualmente."));
  };

  if (query.isPending) {
    return (
      <div className="space-y-3 pt-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="pt-4 text-sm text-error-fg">
        {t("Não foi possível carregar a conexão com o Gestão.")}
      </p>
    );
  }

  const { conexao, envios } = query.data;

  if (!conexao) {
    return (
      <div className="flex justify-center pt-10">
        <Card className="max-w-lg">
          <CardHeader className="items-center text-center">
            <PlugsConnected className="mb-2 h-10 w-10 text-accent" />
            <CardTitle>{t("Conectar o Gestão VendePay")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <ol className="space-y-2 text-left text-sm text-muted-foreground">
              <li>{t("1. Crie a conexão: o CRM gera um endereço e um segredo de assinatura.")}</li>
              <li>{t("2. Configure o Gestão para enviar os eventos de conta para esse endereço, assinados com o segredo.")}</li>
              <li>{t("3. Cada conta cadastrada vira um cliente na fase Entrada; atualizações chegam pelo ID da conta.")}</li>
            </ol>
            <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
              {t("Criar conexão com o Gestão")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const endereco = `${window.location.origin}/api/v1/webhooks/gestao/${conexao.path_token}`;

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle>{t("Gestão VendePay")}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("Último recebimento:")} {dataHora(conexao.last_received_at, idioma)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={conexao.is_active ? "success" : "neutral"}>
              {conexao.is_active ? t("Ativa") : t("Pausada")}
            </Badge>
            <Switch
              aria-label={t("Receber envios do Gestão")}
              checked={conexao.is_active}
              disabled={alterar.isPending}
              onCheckedChange={(v) => alterar.mutate({ is_active: v })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("Endereço do webhook")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-3 py-2 text-xs">
                {endereco}
              </code>
              <Button variant="outline" size="sm" onClick={() => void copiar(endereco, t("Endereço copiado."))}>
                <Copy /> {t("Copiar")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Método POST, corpo em JSON. Pausada, a conexão recusa os envios.")}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">{t("Segredo de assinatura")}</p>
            {segredo ? (
              <div className="space-y-2 rounded-md border border-warning/40 bg-warning-bg p-3">
                <p className="text-xs text-warning-fg">
                  {t("Copie agora: o segredo não é exibido de novo. Se perder, troque por outro.")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-md border bg-background px-3 py-2 text-xs">
                    {segredo}
                  </code>
                  <Button variant="outline" size="sm" onClick={() => void copiar(segredo, t("Segredo copiado."))}>
                    <Copy /> {t("Copiar")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("Guardado cifrado. Por segurança, só é exibido ao criar ou trocar.")}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={alterar.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    t("Trocar o segredo? O Gestão passa a ser recusado até receber o segredo novo."),
                  )
                )
                  alterar.mutate({ trocar_segredo: true });
              }}
            >
              {t("Trocar segredo")}
            </Button>
          </div>

          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">{t("Como o Gestão deve enviar")}</summary>
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <p>
                {t(
                  "Assine cada envio com HMAC SHA-256 do corpo exato, usando o segredo, e mande o resultado em hexadecimal no cabeçalho X-VendePay-Signature.",
                )}
              </p>
              <p>
                {t(
                  "Tipos aceitos: account.created e account.updated. O cliente é encontrado pelo account.id; e-mail e telefone nunca juntam contas. Reenviar o mesmo event_id não duplica.",
                )}
              </p>
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-[11px] text-foreground">
                {EXEMPLO}
              </pre>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Últimos envios")}</CardTitle>
        </CardHeader>
        <CardContent>
          {envios.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Nenhum envio recebido ainda.")}</p>
          ) : (
            <ul className="divide-y">
              {envios.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{e.event_type ?? "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dataHora(e.received_at, idioma)}
                      {e.external_id ? ` · ${e.external_id}` : ""}
                    </p>
                    {e.error_message && <p className="text-xs text-error-fg">{e.error_message}</p>}
                  </div>
                  <Badge variant={e.status === "processed" ? "success" : e.status === "error" ? "destructive" : "neutral"}>
                    {e.status === "processed" ? t("Processado") : e.status === "error" ? t("Recusado") : t("Recebido")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
