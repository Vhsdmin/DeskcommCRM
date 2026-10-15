"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { FonteCitada } from "@/lib/assistente-cs/ferramentas";

/**
 * Conversa do CSM com o assistente interno. A conversa vive só nesta tela (não
 * é gravada); cada pergunta manda o histórico atual para o servidor, que roda o
 * modelo do agente com os documentos e as consultas ao CRM.
 */

type Assistente = { id: string; name: string; description: string | null };
type Mensagem = {
  papel: "csm" | "assistente";
  texto: string;
  fontes?: FonteCitada[];
  erro?: boolean;
};

export function ConversaComAssistente() {
  const t = useT();
  const lista = useQuery({
    queryKey: ["assistente", "lista"],
    queryFn: async () =>
      (await apiClient.get<{ data: { assistentes: Assistente[] } }>("/api/v1/assistente")).data
        .assistentes,
  });
  const [agenteId, setAgenteId] = React.useState<string | null>(null);
  const [mensagens, setMensagens] = React.useState<Mensagem[]>([]);
  const [texto, setTexto] = React.useState("");
  const [pensando, setPensando] = React.useState(false);
  const fim = React.useRef<HTMLDivElement>(null);

  const assistentes = lista.data ?? [];
  const atual = assistentes.find((a) => a.id === agenteId) ?? assistentes[0] ?? null;

  React.useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, pensando]);

  async function perguntar(): Promise<void> {
    const pergunta = texto.trim();
    if (!pergunta || !atual || pensando) return;
    const historico: Mensagem[] = [...mensagens.filter((m) => !m.erro), { papel: "csm", texto: pergunta }];
    setMensagens((m) => [...m, { papel: "csm", texto: pergunta }]);
    setTexto("");
    setPensando(true);
    try {
      const r = await apiClient.post<{ data: { resposta: string; fontes: FonteCitada[] } }>(
        "/api/v1/assistente",
        {
          agent_id: atual.id,
          mensagens: historico.slice(-30).map(({ papel, texto: x }) => ({ papel, texto: x })),
        },
      );
      setMensagens((m) => [
        ...m,
        { papel: "assistente", texto: r.data.resposta || t("(sem resposta)"), fontes: r.data.fontes },
      ]);
    } catch (err) {
      setMensagens((m) => [
        ...m,
        {
          papel: "assistente",
          erro: true,
          texto:
            err instanceof ApiError && err.status < 500
              ? err.message
              : t("O assistente não respondeu. Tente de novo em instantes."),
        },
      ]);
    } finally {
      setPensando(false);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("Assistente")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Tire dúvidas sobre produto, processos, empresa e clientes. Ele consulta os documentos do assistente e os dados do CRM que você pode ver.")}
          </p>
        </div>
        {assistentes.length > 1 ? (
          <Select
            value={atual?.id}
            onValueChange={(v) => {
              setAgenteId(v);
              setMensagens([]);
            }}
          >
            <SelectTrigger className="h-9 w-[220px] text-xs" aria-label={t("Assistente")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assistentes.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </header>

      {lista.isPending ? (
        <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
      ) : lista.isError ? (
        <p role="alert" className="text-sm text-error-fg">
          {t("Não foi possível carregar os assistentes.")}
        </p>
      ) : !atual ? (
        <Card className="space-y-2 p-6 text-sm">
          <p className="font-medium">{t("Nenhum assistente configurado ainda.")}</p>
          <p className="text-muted-foreground">
            {t("Quem administra cria um em")}{" "}
            <Link href="/app/ai/agents" className="underline underline-offset-4">
              {t("Agente de IA › Agentes")}
            </Link>{" "}
            {t("com nome, instruções, documentos e a chave de IA, e salva.")}
          </p>
        </Card>
      ) : (
        <>
          {atual.description ? (
            <p className="text-xs text-muted-foreground">{atual.description}</p>
          ) : null}
          <Card className="flex min-h-[320px] flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
            {mensagens.length === 0 ? (
              <p className="m-auto max-w-md text-center text-sm text-muted-foreground">
                {t("Pergunte, por exemplo: \"Qual é o prazo de liberação de recebíveis?\" ou \"Como está a jornada do cliente Loja X?\"")}
              </p>
            ) : (
              mensagens.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.papel === "csm"
                      ? "ml-auto max-w-[80%] rounded-lg bg-accent-soft px-3 py-2 text-sm"
                      : m.erro
                        ? "mr-auto max-w-[85%] rounded-lg border border-error/40 bg-error-bg px-3 py-2 text-sm text-error-fg"
                        : "mr-auto max-w-[85%] rounded-lg border bg-surface-elevated px-3 py-2 text-sm"
                  }
                >
                  <p className="whitespace-pre-wrap">{m.texto}</p>
                  {m.fontes && m.fontes.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("Fontes:")}{" "}
                      {m.fontes.map((f, j) => (
                        <React.Fragment key={j}>
                          {j > 0 ? " · " : ""}
                          {f.tipo === "cliente" ? (
                            <Link href={`/app/contacts/${f.id}`} className="underline underline-offset-2">
                              {f.nome}
                            </Link>
                          ) : (
                            f.nome
                          )}
                        </React.Fragment>
                      ))}
                    </p>
                  ) : null}
                </div>
              ))
            )}
            {pensando ? (
              <p className="mr-auto text-xs text-muted-foreground">{t("Consultando…")}</p>
            ) : null}
            <div ref={fim} />
          </Card>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void perguntar();
            }}
          >
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void perguntar();
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder={t("Escreva sua pergunta… (Enter envia, Shift+Enter quebra a linha)")}
              aria-label={t("Sua pergunta")}
              disabled={pensando}
            />
            <Button type="submit" disabled={pensando || !texto.trim()}>
              {t("Perguntar")}
            </Button>
            {mensagens.length > 0 ? (
              <Button type="button" variant="outline" onClick={() => setMensagens([])} disabled={pensando}>
                {t("Nova conversa")}
              </Button>
            ) : null}
          </form>
        </>
      )}
    </div>
  );
}
