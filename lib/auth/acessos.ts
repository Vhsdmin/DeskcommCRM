/** Autorizações por vínculo; independentes da preferência visual de menu. */
import { z } from "zod";
import { NAV_CATALOG, NAV_GROUPS } from "@/lib/navigation/catalogo";
import { ROLE_RANK, type Role } from "@/lib/auth/types";

export const CONVITES_DE_EQUIPE_ATIVOS = false;
export const DESTINOS_PESSOAIS = [
  "/app/settings/profile",
  "/app/settings/security",
  "/app/settings/notifications",
];
const destinos = NAV_CATALOG.map((d) => d.href);
export const acessosSchema = z
  .array(z.enum(destinos as [string, ...string[]]))
  .max(destinos.length)
  .transform((v) => [...new Set(v)]);
export type Acessos = string[] | null;
export function podeAcessar(acessos: Acessos | undefined, role: Role, destino: string): boolean {
  return (
    role === "admin" ||
    acessos == null ||
    DESTINOS_PESSOAIS.includes(destino) ||
    (acessos.includes(destino) && acessosValidos([destino], role))
  );
}
export function acessosValidos(acessos: string[], role: Role): boolean {
  return acessos.every((href) =>
    NAV_CATALOG.some(
      (d) =>
        d.href === href &&
        ROLE_RANK[role] >= ROLE_RANK[(d as { minRole?: Role }).minRole ?? "viewer"],
    ),
  );
}
const api: Record<string, string[]> = {
  "cs/nps": ["nps"],
  "cs/central": ["central"],
  "cs/carteira/assumir": ["carteira", "central"],
  "cs/carteira": ["carteira"],
  "cs/playbooks": ["playbooks"],
  "cs/performance": ["metrics"],
  contacts: ["contacts"],
  "conversation-tags": ["inbox"],
  leads: ["kanban"],
  pipelines: ["kanban", "settings/tenant/pipelines"],
  tasks: ["tasks"],
  "automation-rules": ["kanban", "settings/tenant/pipelines"],
  nps: ["nps"],
  messages: ["inbox"],
  conversations: ["inbox"],
  demandas: ["inbox"],
  "ai/replies": ["inbox"],
  "agenda/configuracao": ["agenda", "settings/tenant/agenda"],
  "agenda/tipos": ["agenda", "settings/tenant/agenda"],
  radar: ["radar"],
  templates: ["templates"],
  "message-templates": ["templates"],
  agenda: ["agenda"],
  calendar: ["agenda"],
  attendants: ["team"],
  products: ["products"],
  assistente: ["assistente"],
  ai: ["ai/agents"],
  "channel-sessions": ["connections"],
  channels: ["connections"],
  "integracoes/gestao": ["webhooks"],
  gestao: ["webhooks"],
  "webhook-sources": ["webhooks"],
  webhooks: ["webhooks"],
  "webhook-endpoints": ["webhooks"],
  metrics: ["metrics"],
  "reports/activities": ["activities"],
  audit: ["audit"],
  team: ["team"],
  "settings/routing": ["settings/atendimento"],
  "settings/api-tokens": ["settings/api-tokens"],
  lgpd: ["lgpd/requests"],
  marca: ["settings/marca"],
  "integrations/nuvemshop": ["integrations/nuvemshop"],
};
const compartilhados = ["/api/v1/me", "/api/v1/auth", "/api/v1/notifications", "/api/v1/interface"];
export function destinosDaRota(pathname: string): string[] {
  const path = pathname.replace(/\/$/, "");
  if (compartilhados.some((p) => path === p || path.startsWith(p + "/")))
    return DESTINOS_PESSOAIS.slice(0, 1);
  if (path === "/api/v1/system/version") return DESTINOS_PESSOAIS.slice(0, 1);
  if (path === "/api/v1/channel-sessions") return ["/app/connections", "/app/inbox"];
  if (path === "/api/v1/team") return ["/app/team", "/app/carteira", "/app/playbooks"];
  if (path === "/api/v1/team/assignable") return ["/app/inbox", "/app/tasks", "/app/agenda"];
  if (path.startsWith("/api/v1/ai/replies/")) return ["/app/inbox"];
  const aiDependencies: Record<string, string[]> = {
    "followup-flows": ["/app/ai/followups"],
    budget: ["/app/ai/usage"],
    "operator-metrics": ["/app/ai/usage"],
    "automatico-ativo": ["/app/ai/agents", "/app/inbox"],
    "guardrail-layers": ["/app/ai/agents"],
    pacing: ["/app/ai/agents"],
    "knowledge/chave": ["/app/ai/knowledge/sources"],
    "agents/assignable": ["/app/ai/agents", "/app/inbox", "/app/kanban"],
  };
  if (path.startsWith("/api/v1/ai/")) {
    const rest = path.slice("/api/v1/ai/".length);
    const dependency = Object.keys(aiDependencies).find(
      (k) => rest === k || rest.startsWith(k + "/"),
    );
    if (dependency) return aiDependencies[dependency] ?? [];

    const candidate = "/app/" + path.slice("/api/v1/".length);
    const found = [...NAV_CATALOG]
      .sort((a, b) => b.href.length - a.href.length)
      .find((d) => candidate === d.href || candidate.startsWith(d.href + "/"));
    return found ? [found.href] : [];
  }
  if (path.startsWith("/api/v1/")) {
    const rest = path.slice("/api/v1/".length);
    const key = Object.keys(api)
      .sort((a, b) => b.length - a.length)
      .find((k) => rest === k || rest.startsWith(k + "/"));
    return key ? (api[key] ?? []).map((s) => "/app/" + s) : [];
  }
  const hub = NAV_GROUPS.find((g) => g.hub?.href === path);
  if (hub) return NAV_CATALOG.filter((d) => d.group === hub.id).map((d) => d.href);
  if (path === "/app") return destinos;
  const found = [...NAV_CATALOG]
    .sort((a, b) => b.href.length - a.href.length)
    .find((d) => path === d.href || path.startsWith(d.href + "/"));
  return found ? [found.href] : [];
}
/**
 * Rota que qualquer vínculo pode usar (perfil, segurança, notificações, sessão,
 * versão). O proxy pula a consulta de vínculo nelas: são as chamadas de
 * polling mais frequentes, e a resposta seria sempre "pode".
 */
export function rotaSempreLiberada(pathname: string): boolean {
  const destinos = destinosDaRota(pathname);
  return destinos.length > 0 && destinos.every((d) => DESTINOS_PESSOAIS.includes(d));
}
export function podeAcessarRota(acessos: Acessos | undefined, role: Role, path: string): boolean {
  if (role === "admin" || acessos == null) return true;
  return destinosDaRota(path).some((d) => podeAcessar(acessos, role, d));
}
export const cadastroUsuarioSchema = z
  .object({
    nome: z.string().trim().min(2).max(120),
    email: z.string().trim().email().toLowerCase(),
    senha: z.string().min(12).max(128),
    role: z.enum(["viewer", "agent", "manager", "admin"]),
    acessos: acessosSchema,
  })
  .strict()
  .refine(
    (v) => acessosValidos(v.acessos, v.role),
    "Há acessos incompatíveis com o papel escolhido.",
  );
