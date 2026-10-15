import type { Metadata } from "next";

import { ConversaComAssistente } from "@/components/assistente/ConversaComAssistente";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Assistente" };

export default function Page() {
  return <ConversaComAssistente />;
}
