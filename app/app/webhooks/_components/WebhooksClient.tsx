"use client";
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ConexaoGestaoTab } from "./ConexaoGestaoTab";
import { RulesTab } from "./RulesTab";
import { ActivityTab } from "./ActivityTab";
import { useT } from "@/hooks/i18n/useT";

export function WebhooksClient() {
  const t = useT();
  // Radix Tabs gera ids via useId; com SSR streamado (Next 15) os ids divergem
  // entre server e client e o React acusa hydration mismatch. Nenhuma outra
  // página do app SSRa Tabs no primeiro paint (todas montam pós-fetch) —
  // seguimos o mesmo padrão: skeleton no SSR, Tabs após mount.
  const mounted = React.useSyncExternalStore(
    React.useCallback(() => () => {}, []),
    () => true,
    () => false,
  );

  if (!mounted) {
    // Mesma altura do TabsList (h-9) e largura MEDIDA da tablist — zero layout
    // shift. 323px é a medida com TRÊS abas (`getBoundingClientRect` em
    // 1440px, sem "Leads recebidos", oculta no CRM da VendePay); com quatro
    // eram 432px, e um skeleton estreito demais faz a página saltar.
    // Ao acrescentar ou renomear aba, MEDIR de novo — este número não se
    // estima a olho.
    return (
      <div className="flex-1">
        <Skeleton className="h-9 w-[323px]" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="sources" className="flex-1">
      <TabsList>
        <TabsTrigger value="sources">{t("Receber dados")}</TabsTrigger>
        {/* "Leads recebidos" fica oculto no CRM da VendePay: os clientes chegam
            pelo Gestão, não por formulário externo. O componente continua em
            `CapturasTab.tsx`. */}
        <TabsTrigger value="rules">{t("Automações")}</TabsTrigger>
        <TabsTrigger value="activity">{t("Atividade")}</TabsTrigger>
      </TabsList>
      <TabsContent value="sources"><ConexaoGestaoTab /></TabsContent>
      <TabsContent value="rules"><RulesTab /></TabsContent>
      <TabsContent value="activity"><ActivityTab /></TabsContent>
    </Tabs>
  );
}
