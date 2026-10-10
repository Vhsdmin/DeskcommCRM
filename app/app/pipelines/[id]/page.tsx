import { notFound, redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { JornadaCSBoard } from "@/components/kanban/JornadaCSBoard";
import { ROLE_RANK } from "@/lib/auth/types";
import { PipelinePageClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const { id } = await params;
  const supabase = await createClient();
  // Mesma razão da Agenda: a RLS é piso, não escopo. Sem este filtro o funil de
  // OUTRA organização do mesmo usuário abre, e o quadro monta com as etapas de
  // um lugar e o cabeçalho de outro.
  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id, name, vocabulary, is_default, is_archived")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!pipeline || pipeline.is_archived) notFound();
  if (pipeline.is_default)
    return (
      <JornadaCSBoard
        pipelineId={id}
        name={pipeline.name}
        canEdit={
          ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent &&
          user.support?.access_mode !== "support_readonly"
        }
      />
    );
  return <PipelinePageClient pipelineId={id} initialName={pipeline.name} />;
}
