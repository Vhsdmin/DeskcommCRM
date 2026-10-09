import { describe, expect, it } from "vitest";
import { portfolioOwner, disputeFeeUsdCents, parseActivities } from "@/lib/customer-success/model";
describe("carteiras VendePay", () => {
  it.each([
    [0, "Suporte"],
    [999999, "Suporte"],
    [1000000, "Náthali"],
    [9999999, "Náthali"],
    [10000000, "Fernanda"],
    [99999999, "Fernanda"],
    [100000000, "Filipe"],
  ])("atribui o limite %s", (value, owner) => expect(portfolioOwner(value as number)).toBe(owner));
  it("rejeita GMV negativo e fracionário", () => {
    expect(() => portfolioOwner(-1)).toThrow();
    expect(() => portfolioOwner(1.5)).toThrow();
  });
  it("cobra uma vez por disputa independentemente do resultado", () =>
    expect(disputeFeeUsdCents(["a", "a", "b"])).toBe(5400));
  it("não recupera registros locais de contas desconhecidas", () =>
    expect(parseActivities('[{"accountId":"real-account"}]')).toEqual([]));
});

import { isDevelopmentCsPreview } from "@/lib/customer-success/preview";
describe("prévia isolada", () => {
  it("permite apenas a rota exata em desenvolvimento", () => {
    expect(isDevelopmentCsPreview("/cs-preview", "development")).toBe(true);
    for (const env of ["production", "test", undefined])
      expect(isDevelopmentCsPreview("/cs-preview", env)).toBe(false);
    for (const path of ["/app/cs", "/cs-preview/admin", "/api/customers"])
      expect(isDevelopmentCsPreview(path, "development")).toBe(false);
  });
});
