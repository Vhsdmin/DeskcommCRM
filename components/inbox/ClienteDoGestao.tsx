"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { useMergeContacts } from "@/hooks/contacts/useMergeContacts";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { reais } from "@/lib/cs/carteira";

/** O que o resumo do contato traz do Gestão VendePay; `null` = não veio de lá. */
export interface ClienteGestao {
  conta_id: string;
  gmv_30d_centavos: number | null;
  ultima_venda_em: string | null;
  faixa: string | null;
  csm_nome: string | null;
}

interface ContatoDoGestao {
  id: string;
  name: string | null;
  display_name: string | null;
  email: string | null;
  phone_number: string | null;
}

/**
 * QUEM É ESTE CONTATO PARA A VENDEPAY.
 *
 * "Cliente cadastrado" é quem veio do Gestão — o endpoint oficial grava
 * `gestao_account_id`. A mensagem de WhatsApp já cai no cadastro do Gestão
 * quando o telefone bate; quando a pessoa escreve de outro número, nasce um
 * contato novo, e o selo diz isso em vez de deixar a dúvida no ar.
 *
 * Nesse caso, quem pode juntar cadastros (`manager`, o piso da rota de fusão)
 * vincula a conversa ao cliente do Gestão: este contato é absorvido pelo de lá,
 * que fica — é ele que o Gestão continua atualizando.
 */
export function ClienteDoGestao({
  contactId,
  cliente,
  carregando,
  onVinculado,
}: {
  contactId: string;
  cliente: ClienteGestao | null;
  carregando: boolean;
  /** Recebe o id do cliente do Gestão que absorveu este contato. */
  onVinculado: (clienteQueFicou: string) => void;
}) {
  const t = useT();
  const localeDaData = useLocaleDeData();
  const podeVincular = usePermission("contact.merge");
  const [vinculando, setVinculando] = useState(false);

  if (carregando) return null;

  if (cliente) {
    return (
      <div className="space-y-1 rounded-md border border-border p-2 text-xs" data-testid="selo-cliente-gestao">
        <div className="flex flex-wrap items-center gap-1">
          <Badge className="h-5 px-1.5 text-[10px]">{t("Cliente VendePay")}</Badge>
          {cliente.faixa && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {cliente.faixa}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground">
          {t("Faturamento 30 dias")}:{" "}
          {cliente.gmv_30d_centavos != null ? reais(cliente.gmv_30d_centavos) : t("sem dado")}
          {" · "}
          {t("Última venda")}:{" "}
          {cliente.ultima_venda_em
            ? format(new Date(cliente.ultima_venda_em), "dd/MM/yyyy", { locale: localeDaData })
            : t("sem dado")}
        </p>
        <p className="text-muted-foreground">
          {t("CSM")}: {cliente.csm_nome ?? t("sem responsável")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded-md border border-dashed border-border p-2 text-xs" data-testid="selo-contato-novo">
      <p className="font-medium text-text">{t("Contato novo")}</p>
      <p className="text-muted-foreground">
        {t("Não está vinculado a um cliente do Gestão VendePay.")}
      </p>
      {podeVincular ? (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setVinculando(true)}>
          {t("Vincular a cliente do Gestão")}
        </Button>
      ) : (
        <p className="text-muted-foreground">
          {t("Se for um cliente, peça a um gestor para vincular este contato.")}
        </p>
      )}
      {vinculando && (
        <VincularAoGestao
          contactId={contactId}
          onFechar={() => setVinculando(false)}
          onVinculado={(clienteQueFicou) => {
            setVinculando(false);
            onVinculado(clienteQueFicou);
          }}
        />
      )}
    </div>
  );
}

function VincularAoGestao({
  contactId,
  onFechar,
  onVinculado,
}: {
  contactId: string;
  onFechar: () => void;
  onVinculado: (clienteQueFicou: string) => void;
}) {
  const t = useT();
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<ContatoDoGestao | null>(null);
  const juntar = useMergeContacts();
  const termo = busca.trim();

  const resultados = useQuery({
    queryKey: ["contatos-do-gestao", termo],
    enabled: termo.length >= 2,
    queryFn: async () => {
      // Pelo VÍNCULO (`gestao_account_id`), a mesma régua do selo — e não pela
      // origem: um contato criado à mão e depois ligado ao Gestão é cliente, e
      // um que veio de lá e perdeu o vínculo não é.
      const qs = new URLSearchParams({ search: termo, vinculo: "gestao", limit: "10" });
      const r = await apiClient.get<{ data: ContatoDoGestao[] }>(`/api/v1/contacts?${qs}`);
      return r.data.filter((c) => c.id !== contactId);
    },
  });

  const nome = (c: ContatoDoGestao) => c.name ?? c.display_name ?? c.email ?? c.phone_number ?? "—";

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Vincular a cliente do Gestão")}</DialogTitle>
          <DialogDescription>
            {t(
              "Este contato é absorvido pelo cliente escolhido: conversas, negócios e histórico passam para ele.",
            )}
          </DialogDescription>
        </DialogHeader>

        {escolhido ? (
          <p className="text-sm">
            {t("Vincular a")} <strong>{nome(escolhido)}</strong>?
          </p>
        ) : (
          <div className="space-y-2">
            <Input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={t("Nome, e-mail ou telefone do cliente")}
              aria-label={t("Buscar cliente do Gestão")}
            />
            {termo.length >= 2 && !resultados.isLoading && (resultados.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">{t("Nenhum cliente do Gestão encontrado.")}</p>
            )}
            <ul className="space-y-1">
              {(resultados.data ?? []).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border border-border p-2 text-left text-xs hover:bg-muted"
                    onClick={() => setEscolhido(c)}
                  >
                    <span className="font-medium">{nome(c)}</span>
                    {c.email && <span className="text-muted-foreground"> · {c.email}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={escolhido ? () => setEscolhido(null) : onFechar}>
            {escolhido ? t("Voltar") : t("Cancelar")}
          </Button>
          {escolhido && (
            <Button
              disabled={juntar.isPending}
              onClick={() =>
                juntar.mutate(
                  { primary_contact_id: escolhido.id, secondary_contact_ids: [contactId] },
                  { onSuccess: () => onVinculado(escolhido.id) },
                )
              }
            >
              {juntar.isPending ? t("Vinculando…") : t("Vincular")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
