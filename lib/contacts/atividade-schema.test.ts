import { describe, expect, it } from "vitest";
import { atividadeDoClienteSchema } from "./atividade-schema";
const base = {
  kind: "support",
  summary: "Retorno realizado",
  performed_at: "2026-01-01T12:00:00Z",
};
describe("registro de relacionamento", () => {
  it("aceita os quatro tipos sem lead", () => {
    for (const kind of ["support", "meeting", "ebr", "qbr"])
      expect(atividadeDoClienteSchema.safeParse({ ...base, kind }).success).toBe(true);
  });
  it("recusa resumo vazio, tipo desconhecido e data futura", () => {
    for (const change of [
      { summary: "  " },
      { kind: "sale" },
      { performed_at: "2099-01-01T12:00:00Z" },
    ])
      expect(atividadeDoClienteSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });
  it("recusa identidade e organização enviadas pelo cliente", () => {
    expect(atividadeDoClienteSchema.safeParse({ ...base, organization_id: "fake" }).success).toBe(
      false,
    );
    expect(
      atividadeDoClienteSchema.safeParse({ ...base, performed_by_user_id: "fake" }).success,
    ).toBe(false);
  });
});
