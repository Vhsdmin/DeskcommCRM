"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/hooks/i18n/useT";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus } from "@/lib/ui/icons";
import { useUpdateContact } from "@/hooks/contacts/useUpdateContact";
import { CHAVE_DE_TODAS_AS_TAGS, useTodasAsTags } from "@/hooks/inbox/useConversationTags";
import { SugestoesDeTags } from "./SugestoesDeTags";

interface Props {
  contactId: string;
  /** Só chaveia o vocabulário de sugestões por organização. */
  orgId: string | null;
  tags: string[];
}

/** Edita as tags do CONTATO (distinto de ConversationTagsEditor, que edita as
 * tags da conversa) — aberto pelo botão "Tag" do painel do Inbox. */
export function ContactTagsEditor({ contactId, orgId, tags }: Props) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const mutation = useUpdateContact(contactId);
  const { data: vocabulary } = useTodasAsTags(orgId);
  const qc = useQueryClient();

  function apply(next: string[]) {
    mutation.mutate(
      { tags: next },
      // Etiqueta nova passa a ser sugestão nos outros editores na hora.
      { onSuccess: () => void qc.invalidateQueries({ queryKey: [CHAVE_DE_TODAS_AS_TAGS] }) },
    );
  }

  function add(raw: string) {
    const tag = raw.trim().toLowerCase().slice(0, 40);
    if (!tag || tags.includes(tag) || tags.length >= 20) return;
    apply([...tags, tag]);
    setDraft("");
  }

  function remove(tag: string) {
    apply(tags.filter((v) => v !== tag));
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border p-2">
      <div className="flex flex-wrap gap-1">
        {tags.length > 0 ? (
          tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                disabled={mutation.isPending}
                aria-label={`${t("Remover tag")} ${tag}`}
                className="rounded-sm hover:text-destructive"
              >
                <X size={10} weight="bold" aria-hidden />
              </button>
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">{t("Sem tags no contato.")}</span>
        )}
      </div>

      <div className="flex gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder={t("Nova tag…")}
          maxLength={40}
          disabled={mutation.isPending || tags.length >= 20}
          className="h-7 text-xs"
          aria-label={t("Adicionar tag ao contato")}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => add(draft)}
          disabled={mutation.isPending || !draft.trim() || tags.length >= 20}
          aria-label={t("Adicionar tag")}
        >
          <Plus size={12} weight="regular" aria-hidden />
        </Button>
      </div>
      <SugestoesDeTags
        vocabulario={vocabulary ?? []}
        atuais={tags}
        rascunho={draft}
        desabilitado={mutation.isPending || tags.length >= 20}
        onEscolher={add}
      />
    </div>
  );
}
