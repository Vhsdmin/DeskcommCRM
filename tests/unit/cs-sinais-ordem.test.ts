import { describe, expect, it } from "vitest";

import { compararSinais, ROTULO_DO_SINAL, TIPOS_DE_SINAL } from "@/lib/cs/sinais";

describe("Central de Prioridades — ordem de trabalho", () => {
  it("severidade primeiro (crítica > alta > média), depois o prazo mais próximo", () => {
    const sinais = [
      { id: "media-cedo", severidade: "media", prazo: "2026-10-16T00:00:00Z" },
      { id: "critica-tarde", severidade: "critica", prazo: "2026-10-20T00:00:00Z" },
      { id: "alta", severidade: "alta", prazo: "2026-10-17T00:00:00Z" },
      { id: "critica-cedo", severidade: "critica", prazo: "2026-10-16T00:00:00Z" },
    ];
    expect([...sinais].sort(compararSinais).map((s) => s.id)).toEqual([
      "critica-cedo",
      "critica-tarde",
      "alta",
      "media-cedo",
    ]);
  });

  it("todo tipo de sinal do banco tem rótulo na tela", () => {
    for (const tipo of TIPOS_DE_SINAL) expect(ROTULO_DO_SINAL[tipo].titulo).toBeTruthy();
  });

  it("os tipos da tela são exatamente os do CHECK da migration 0273", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261015180000_0273_sinais_de_cs.sql", "utf8");
    const bloco = sql.slice(sql.indexOf("constraint cs_sinais_tipo_check"), sql.indexOf("constraint cs_sinais_severidade_check"));
    const doBanco = [...bloco.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(doBanco.sort()).toEqual([...TIPOS_DE_SINAL].sort());
  });
});
