"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";

import { useT } from "@/hooks/i18n/useT";
import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ShieldCheck, PencilSimple } from "@/lib/ui/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useContact } from "@/hooks/contacts/useContact";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useDefaultPipeline } from "@/hooks/pipelines/useDefaultPipeline";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { ROLE_RANK } from "@/lib/auth/types";
import { NpsDoCliente } from "@/components/contacts/NpsDoCliente";
import { JornadaDoCliente } from "@/components/contacts/JornadaDoCliente";
import { RegistrarAtividade } from "@/components/contacts/RegistrarAtividade";
import { TarefasClient } from "@/app/app/tasks/_components/TarefasClient";
import { TimelineView } from "@/components/contacts/TimelineView";
import { EditContactDialog } from "@/components/contacts/EditContactDialog";
import { AnonymizeDialog } from "@/components/contacts/AnonymizeDialog";
import { PropostasDeDado } from "@/components/contacts/PropostasDeDado";
import { ConversaNoDossie } from "@/components/kanban/ConversaNoDossie";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { DialButton } from "@/components/voice/DialButton";
import { CHAMADA_DE_VOZ_VISIVEL } from "@/lib/voice/visibilidade";

interface Props {
  contactId: string;
}

export function ContactDetailClient({ contactId }: Props) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const q = useContact(contactId);
  const { user, activeOrg } = useAuth();
  // As DEFINIÇÕES continuam no funil (`crm_pipelines.settings.fields[]`) — só o
  // VALOR mora no contato. `camposDoFunil` é o mesmo leitor que o Kanban usa.
  const pipelineQuery = useDefaultPipeline(Boolean(activeOrg));
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = searchParams.get("aba") ?? "overview";
  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("aba", value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const [editOpen, setEditOpen] = useState(false);
  const [anonOpen, setAnonOpen] = useState(false);

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <Card className="p-6 text-center text-sm text-error-fg">
          {t("Erro ao carregar contato.")}
        </Card>
      </div>
    );
  }

  const contact = q.data.data;
  const isAdmin =
    (user.is_platform_admin && !user.support) ||
    (activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin);

  // Uma decisão, um lugar (lib/contacts/rotulo-do-contato.ts). Esta tela era
  // uma das DUAS que ignoravam o telefone: contato com número e sem nome
  // aparecia como "Sem nome" aqui e com o número no inbox.
  const displayName = rotuloDoContato(contact, t);

  return (
    <div className="space-y-4 p-6">
      {contact.is_anonymized && (
        <div
          role="alert"
          className="sticky top-0 z-20 flex items-center gap-3 rounded-md border border-error-fg/30 bg-error-bg p-3 text-sm text-error-fg"
        >
          <ShieldCheck size={18} weight="duotone" aria-hidden />
          <span>
            {t("Contato anonimizado (LGPD)")}
            {contact.anonymized_at &&
              ` em ${format(new Date(contact.anonymized_at), "dd/MM/yyyy", { locale: localeDaData })}`}
            {t(" — edição bloqueada.")}
          </span>
        </div>
      )}

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          {/* Sem truncar: nome é dado que a tela existe pra mostrar, e cortar
              com reticências sem um jeito de ver o resto violaria o princípio
              de nunca esconder informação crítica. Deixa quebrar linha. */}
          <h1 className="text-2xl font-semibold tracking-tight break-words">{displayName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {contact.email && <span>{contact.email}</span>}
            {contact.email && contact.phone_number && <span>•</span>}
            {contact.phone_number && <span>{phoneForDisplay(contact.phone_number)}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {contact.tags.map((t) => (
              <Badge key={t} variant="neutral">
                {t}
              </Badge>
            ))}
            {contact.is_blocked && <Badge variant="warning">{t("Bloqueado")}</Badge>}
            {contact.is_anonymized && <Badge variant="destructive">{t("Anonimizado")}</Badge>}
          </div>
        </div>
        {!contact.is_anonymized && user.support?.access_mode !== "support_readonly" && (
          <div className="flex shrink-0 items-center gap-2">
            {CHAMADA_DE_VOZ_VISIVEL && (
              <DialButton contactId={contactId} hasPhone={!!contact.phone_number} />
            )}
            <Button variant="outline" onClick={() => setEditOpen(true)} className="shrink-0">
              <PencilSimple size={16} weight="bold" aria-hidden />
              <span>{t("Editar")}</span>
            </Button>
          </div>
        )}
      </header>

      <ConversaNoDossie conversa={contact.conversa} />

      {/* ANTES das abas, e não dentro de uma delas: é o único conteúdo desta
          tela que PEDE uma ação. Enterrado numa aba, viraria pendência que só
          quem já sabe que existe encontra — e a fila deixaria de ser fila.
          Some sozinho quando não há nada aguardando. */}
      {!contact.is_anonymized && user.support?.access_mode !== "support_readonly" && (
        <PropostasDeDado
          contactId={contactId}
          podeDecidir={Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent)}
          aoDecidir={() => void q.refetch()}
        />
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">{t("Visão geral")}</TabsTrigger>
          <TabsTrigger value="timeline">{t("Histórico")}</TabsTrigger>
          <TabsTrigger value="tasks">{t("Tarefas")}</TabsTrigger>
          <TabsTrigger value="nps">NPS</TabsTrigger>
          <TabsTrigger value="gestao">{t("Dados do Gestão")}</TabsTrigger>
          {isAdmin && <TabsTrigger value="lgpd">LGPD</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <JornadaDoCliente
            contact={contact}
            actorId={user.id}
            actorName={user.full_name ?? "Você"}
            manager={Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager)}
            canEdit={
              !contact.is_anonymized &&
              !contact.is_merged_into &&
              user.support?.access_mode !== "support_readonly" &&
              Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent)
            }
            onTasks={() => setTab("tasks")}
          />
          <Card className="p-4">
            <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground uppercase">{t("Nome")}</dt>
                <dd className="mt-1">{contact.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase">Display name</dt>
                <dd className="mt-1">{contact.display_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase">Email</dt>
                <dd className="mt-1">{contact.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase">{t("Telefone")}</dt>
                <dd className="mt-1">
                  {contact.phone_number ? phoneForDisplay(contact.phone_number) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase">{t("Origem")}</dt>
                <dd className="mt-1">{contact.source}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase">{t("Última atividade")}</dt>
                <dd className="mt-1">
                  {contact.last_activity_at
                    ? format(new Date(contact.last_activity_at), "dd/MM/yyyy HH:mm", {
                        locale: localeDaData,
                      })
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase">{t("Criado em")}</dt>
                <dd className="mt-1">
                  {format(new Date(contact.created_at), "dd/MM/yyyy", { locale: localeDaData })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground uppercase">Tags</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {contact.tags.length === 0
                    ? "—"
                    : contact.tags.map((t) => (
                        <Badge key={t} variant="neutral">
                          {t}
                        </Badge>
                      ))}
                </dd>
              </div>
            </dl>
          </Card>
        </TabsContent>

        <TabsContent value="timeline" className="mt-4 space-y-4">
          {!contact.is_anonymized &&
            !contact.is_merged_into &&
            user.support?.access_mode !== "support_readonly" &&
            Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent) && (
              <div className="flex flex-wrap items-center gap-2">
                <RegistrarAtividade contactId={contactId} />
                <Button asChild variant="outline">
                  <Link href={`/app/agenda?contato=${contactId}`}>{t("Marcar compromisso")}</Link>
                </Button>
              </div>
            )}
          <TimelineView
            contactId={contactId}
            actorUserId={user.id}
            manager={Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager)}
            canEdit={
              !contact.is_anonymized &&
              !contact.is_merged_into &&
              user.support?.access_mode !== "support_readonly" &&
              Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent)
            }
          />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <TarefasClient
            contactId={contactId}
            podeEditar={
              !contact.is_anonymized &&
              user.support?.access_mode !== "support_readonly" &&
              Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent)
            }
          />
        </TabsContent>
        <TabsContent value="nps" className="mt-4">
          <NpsDoCliente
            contactId={contactId}
            actorId={user.id}
            manager={Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager)}
            canEdit={
              !contact.is_anonymized &&
              !contact.is_merged_into &&
              user.support?.access_mode !== "support_readonly" &&
              Boolean(activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent)
            }
          />
        </TabsContent>
        <TabsContent value="gestao" className="mt-4">
          <Card className="space-y-2 p-4">
            <h2 className="font-semibold">{t("Integração com o Gestão VendePay")}</h2>
            <p className="text-sm text-muted-foreground">
              {t(
                "Os dados cadastrais e financeiros serão consultados no Gestão. A conexão ainda não está configurada.",
              )}
            </p>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="lgpd" className="mt-4">
            <Card className="space-y-4 p-4">
              <div>
                <h2 className="text-lg font-semibold">{t("Direito ao esquecimento (LGPD)")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    "A anonimização é irreversível. Use somente após confirmação formal do titular ou ordem judicial.",
                  )}
                </p>
              </div>
              {contact.is_anonymized ? (
                <p className="text-sm text-muted-foreground">
                  {t("Este contato já foi anonimizado")}
                  {contact.anonymized_at &&
                    ` em ${format(new Date(contact.anonymized_at), "dd/MM/yyyy HH:mm", { locale: localeDaData })}`}
                  .
                </p>
              ) : (
                <Button variant="destructive" onClick={() => setAnonOpen(true)}>
                  {t("Anonimizar contato")}
                </Button>
              )}
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <EditContactDialog
        contact={contact}
        open={editOpen}
        onOpenChange={setEditOpen}
        customFieldDefs={camposDoFunil(pipelineQuery.data?.pipeline.settings ?? null)}
      />
      <AnonymizeDialog contactId={contactId} open={anonOpen} onOpenChange={setAnonOpen} />
    </div>
  );
}
