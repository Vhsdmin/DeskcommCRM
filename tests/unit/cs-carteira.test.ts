import { describe, expect, it } from "vitest";

import { centavosDoTexto, comFim, faixasSchema, reais } from "@/lib/cs/carteira";

const UUID = "c7000000-0000-4000-8000-0000000000a1";
const faixa = (inicio_centavos: number, tipo: "suporte" | "csm" = "csm") => ({
  nome: `Faixa ${inicio_centavos}`,
  inicio_centavos,
  tipo,
  responsavel_user_id: UUID,
});

describe("faixas da carteira", () => {
  it("aceita as faixas da VendePay (suporte até 10 mil, CSMs acima)", () => {
    const r = faixasSchema.safeParse([
      faixa(0, "suporte"),
      faixa(1_000_001),
      faixa(10_000_001),
      faixa(100_000_001),
    ]);
    expect(r.success).toBe(true);
  });

  it("exige uma faixa começando em zero e inícios distintos", () => {
    expect(faixasSchema.safeParse([faixa(100)]).success).toBe(false);
    expect(faixasSchema.safeParse([faixa(0), faixa(500), faixa(500)]).success).toBe(false);
    expect(faixasSchema.safeParse([]).success).toBe(false);
  });

  it("cada faixa termina 1 centavo antes da próxima; a última não tem fim", () => {
    const r = comFim([faixa(1_000_001), faixa(0, "suporte"), faixa(10_000_001)]);
    expect(r.map((f) => [f.inicio_centavos, f.fim_centavos])).toEqual([
      [0, 1_000_000],
      [1_000_001, 10_000_000],
      [10_000_001, null],
    ]);
  });
});

describe("valores em reais", () => {
  it("lê o que se digita em reais", () => {
    expect(centavosDoTexto("10.000,01")).toBe(1_000_001);
    expect(centavosDoTexto("R$ 1.000.000,01")).toBe(100_000_001);
    expect(centavosDoTexto("0,00")).toBe(0);
    expect(centavosDoTexto("150")).toBe(15_000);
    expect(centavosDoTexto("")).toBeNull();
    expect(centavosDoTexto("1,2,3")).toBeNull();
  });

  it("formata centavos como BRL", () => {
    expect(reais(1_500_000).replace(/\s/g, " ")).toBe("R$ 15.000,00");
  });
});
