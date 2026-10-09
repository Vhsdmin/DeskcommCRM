export const OWNERS = ["Suporte", "Náthali", "Fernanda", "Filipe"] as const;
export type Owner = (typeof OWNERS)[number];
/** Valores monetários em centavos; carteira sempre usa GMV desde o cadastro. */
export function portfolioOwner(lifetimeGmvCents: number): Owner {
  if (!Number.isSafeInteger(lifetimeGmvCents) || lifetimeGmvCents < 0)
    throw new Error("GMV inválido");
  if (lifetimeGmvCents < 1_000_000) return "Suporte";
  if (lifetimeGmvCents < 10_000_000) return "Náthali";
  if (lifetimeGmvCents < 100_000_000) return "Fernanda";
  return "Filipe";
}
export function disputeFeeUsdCents(disputeIds: string[]): number {
  return new Set(disputeIds).size * 2700;
}
export interface Account {
  id: string;
  name: string;
  person: "CPF" | "CNPJ";
  since: string;
  lifetimeGmvCents: number;
  refundsCents: number;
  chargebacksCents: number;
  disputeIds: string[];
  products: string[];
}
export const DEMO_ACCOUNTS: Account[] = [
  {
    id: "demo-001",
    name: "Aurora Educação · exemplo",
    person: "CNPJ",
    since: "2025-03-12",
    lifetimeGmvCents: 138_500_000,
    refundsCents: 320_000,
    chargebacksCents: 90_000,
    disputeIds: ["d1", "d2", "d3"],
    products: ["Curso de fotografia", "Mentoria Aurora"],
  },
  {
    id: "demo-002",
    name: "Estúdio Horizonte · exemplo",
    person: "CNPJ",
    since: "2025-08-04",
    lifetimeGmvCents: 28_700_000,
    refundsCents: 80_000,
    chargebacksCents: 0,
    disputeIds: ["d4"],
    products: ["Design para negócios"],
  },
  {
    id: "demo-003",
    name: "Marina Costa · exemplo",
    person: "CPF",
    since: "2026-02-10",
    lifetimeGmvCents: 4_850_000,
    refundsCents: 0,
    chargebacksCents: 0,
    disputeIds: [],
    products: ["Oficina de escrita"],
  },
  {
    id: "demo-004",
    name: "Ateliê Semente · exemplo",
    person: "CNPJ",
    since: "2026-09-15",
    lifetimeGmvCents: 780_000,
    refundsCents: 0,
    chargebacksCents: 0,
    disputeIds: [],
    products: ["Guia de cerâmica"],
  },
  {
    id: "demo-005",
    name: "Pedro Lima · exemplo",
    person: "CPF",
    since: "2026-10-01",
    lifetimeGmvCents: 0,
    refundsCents: 0,
    chargebacksCents: 0,
    disputeIds: [],
    products: [],
  },
];
export const ACTIVITY_KINDS = ["Atendimento", "Reunião", "EBR", "QBR", "Tarefa"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export interface Activity {
  id: string;
  accountId: string;
  kind: ActivityKind;
  owner: Owner;
  date: string;
  summary: string;
  done: boolean;
}
export function parseActivities(raw: string): Activity[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Histórico inválido");
  return value.filter(
    (item): item is Activity =>
      !!item &&
      typeof item === "object" &&
      typeof item.id === "string" &&
      DEMO_ACCOUNTS.some((a) => a.id === item.accountId) &&
      ACTIVITY_KINDS.includes(item.kind) &&
      OWNERS.includes(item.owner) &&
      typeof item.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
      typeof item.summary === "string" &&
      item.summary.length <= 2000 &&
      typeof item.done === "boolean",
  );
}
