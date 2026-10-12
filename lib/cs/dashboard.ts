import { z } from "zod";
const calendarDate = z.iso.date();
export const dashboardQuery = z
  .object({
    from: calendarDate,
    to: calendarDate,
    owner: z.uuid().optional(),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    status: z.enum(["all", "answered", "pending", "expired", "cancelled"]).default("all"),
    category: z.enum(["all", "detractor", "neutral", "promoter"]).default("all"),
    silence: z.coerce
      .number()
      .refine((n) => [7, 14, 30, 60, 90].includes(n))
      .default(30),
    focus: z.enum(["silence", "detractor"]).default("silence"),
  })
  .strict()
  .refine(
    (q) => q.from <= q.to && (Date.parse(q.to) - Date.parse(q.from)) / 86400000 < 732,
    "Período inválido (máximo 2 anos).",
  );
/** Datas civis inclusivas no fuso VendePay; SQL recebe [de, até). */
export function windowUtc(from: string, to: string) {
  const next = new Date(`${to}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    from: `${from}T00:00:00-03:00`,
    to: `${next.toISOString().slice(0, 10)}T00:00:00-03:00`,
  };
}
export function presetDates(days: number, now = new Date()) {
  const to = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: start.toISOString().slice(0, 10), to };
}
export interface NpsRow {
  id: string;
  contact_id: string;
  name: string | null;
  cs_owner_user_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  answered_at: string | null;
  expires_at: string;
  score: number | null;
  comment: string | null;
  status: "answered" | "pending" | "expired" | "cancelled";
}
export interface NpsDashboardData {
  summary: {
    total: number;
    answered: number;
    pending: number;
    expired: number;
    cancelled: number;
    detractors: number;
    neutrals: number;
    promoters: number;
    average_100: number | null;
    nps: number | null;
  };
  rows: NpsRow[];
  filtered_total: number;
  as_of: string;
}
export interface PerformanceRow {
  user_id: string | null;
  supports: number;
  meetings: number;
  ebr: number;
  qbr: number;
  contacted_clients: number;
  portfolio: number;
  overdue_tasks: number;
  silent_clients: number;
  unattended_detractors: number;
}
export interface PerformanceData {
  performance: PerformanceRow[];
  attention: {
    id: string;
    name: string | null;
    cs_owner_user_id: string | null;
    cs_phase: string | null;
    created_at: string;
    last_contact: string | null;
    detractor_since: string | null;
  }[];
  attention_total: number;
  as_of: string;
}
