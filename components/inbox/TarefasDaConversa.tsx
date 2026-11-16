"use client";

import { format } from "date-fns";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormularioDeTarefa } from "@/components/tasks/FormularioDeTarefa";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useTasks } from "@/hooks/tasks/useTasks";
import { estaAtrasada, type NovaTarefa } from "@/lib/tarefas/tipos";
import { ListChecks, Plus } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

/** Quantas pendentes cabem na coluna; o resto fica a um clique, na ficha. */
const MAXIMO_NA_COLUNA = 5;

/**
 * As tarefas do cliente desta conversa — e a criação de uma nova sem sair dela.
 *
 * A tarefa nasce ligada ao CONTATO e ao lead que o painel está mostrando, e
 * com quem a criou como responsável: quem combina o retorno na conversa é quem
 * o deve. O formulário é o mesmo da tela de Tarefas, então as duas portas não
 * divergem sobre o que uma tarefa tem.
 */
export function TarefasDaConversa({
  contactId,
  leadId,
  usuarioId,
  somenteLeitura,
}: {
  contactId: string;
  leadId: string | null;
  usuarioId: string;
  somenteLeitura: boolean;
}) {
  const t = useT();
  const localeDaData = useLocaleDeData();
  // Criar tarefa é `agent` na rota; quem só visualiza preencheria o formulário
  // para levar 403 no fim.
  const podeCriar = usePermission("task.create");
  const { tarefas, carregando, falhou, criarTarefa } = useTasks({
    contact_id: contactId,
    aberto: true,
  });
  const [aberto, setAberto] = useState(false);
  // Remonta o formulário a cada abertura: ele inicializa o estado pelas props.
  const [aberturas, setAberturas] = useState(0);

  const salvar = (entrada: NovaTarefa) =>
    criarTarefa({ ...entrada, assigned_to: entrada.assigned_to ?? usuarioId });

  const visiveis = tarefas.slice(0, MAXIMO_NA_COLUNA);

  return (
    <section data-testid="inbox-tarefas">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-text">{t("Tarefas pendentes")}</h3>
        {!somenteLeitura && podeCriar && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setAberturas((n) => n + 1);
              setAberto(true);
            }}
          >
            <Plus size={12} className="mr-1" weight="regular" aria-hidden />
            {t("Nova tarefa")}
          </Button>
        )}
      </div>

      {carregando ? null : falhou ? (
        <p className="mt-2 text-xs text-destructive">{t("Não foi possível carregar as tarefas.")}</p>
      ) : visiveis.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("Nenhuma tarefa pendente.")}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {visiveis.map((tarefa) => {
            const atrasada = estaAtrasada(tarefa);
            return (
              <li key={tarefa.id} className="flex items-start gap-1.5 text-xs">
                <ListChecks size={12} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-text">{tarefa.title}</p>
                  <p className={cn("text-[11px]", atrasada ? "text-destructive" : "text-muted-foreground")}>
                    {tarefa.due_date
                      ? format(new Date(tarefa.due_date), "dd/MM HH:mm", { locale: localeDaData })
                      : t("Sem prazo")}
                    {atrasada ? ` · ${t("Atrasada")}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {tarefas.length > MAXIMO_NA_COLUNA && (
        <Link className="mt-2 inline-block text-xs underline" href={`/app/contacts/${contactId}?aba=tasks`}>
          {t("Ver todas")}
        </Link>
      )}

      <FormularioDeTarefa
        key={aberturas}
        aberto={aberto}
        aoMudarAbertura={setAberto}
        aoSalvar={salvar}
        contactId={contactId}
        leadId={leadId}
      />
    </section>
  );
}
