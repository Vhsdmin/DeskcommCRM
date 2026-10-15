import { z } from "zod";
export const atividadeDoClienteSchema = z
  .object({
    kind: z.enum(["support", "meeting", "ebr", "qbr"]),
    summary: z.string().trim().min(1).max(4000),
    next_steps: z.string().trim().max(2000).default(""),
    performed_at: z.iso
      .datetime({ offset: true })
      .refine((value) => Date.parse(value) <= Date.now() + 60_000, "Data futura"),
  })
  .strict();
export const TIPO_ATIVIDADE = {
  support: "customer_support",
  meeting: "customer_meeting",
  ebr: "customer_ebr",
  qbr: "customer_qbr",
} as const;
