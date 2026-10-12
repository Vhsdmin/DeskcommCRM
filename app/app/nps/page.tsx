import type { Metadata } from "next";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { NpsDashboard } from "@/components/cs/NpsDashboard";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard NPS" };
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  return <NpsDashboard canCompare={!!org && ROLE_RANK[org.role] >= ROLE_RANK.manager} />;
}
