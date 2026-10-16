import type { Metadata } from "next";

import { CentralDePrioridades } from "@/components/cs/CentralDePrioridades";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Central de Prioridades" };

export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const gestor = !!org && ROLE_RANK[org.role] >= ROLE_RANK.manager;
  return <CentralDePrioridades gestor={gestor} userId={user.id} />;
}
