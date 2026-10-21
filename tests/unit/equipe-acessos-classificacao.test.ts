/**
 * A classificação de módulos mora em três lugares que precisam falar a mesma
 * língua: o catálogo de navegação (\`NAV_CATALOG\`), o mapa de APIs
 * (\`lib/auth/acessos.ts\`) e a tabela \`acesso_modulo_recursos\` do banco
 * (semeada na migration 0280). Um destino digitado errado em qualquer um deles
 * nega acesso em silêncio — ou o concede a um módulo que não existe na tela.
 */
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DESTINOS_PESSOAIS, destinosDaRota, rotaSempreLiberada } from "@/lib/auth/acessos";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

const HREFS = new Set<string>(NAV_CATALOG.map((d) => d.href));

describe("classificação de módulos", () => {
  it("todo destino citado pelo mapa de APIs existe no catálogo", () => {
    const fonte = readFileSync("lib/auth/acessos.ts", "utf8");
    const citados = [...fonte.matchAll(/"(\/app\/[a-z0-9/_-]+)"/g)].map((m) => m[1]!);
    const curtos = [...fonte.matchAll(/^\s+"?[a-z0-9/_-]+"?: \[([^\]]+)\],?$/gm)].flatMap((m) =>
      [...m[1]!.matchAll(/"([a-z0-9/_-]+)"/g)].map((x) => (x[1]!.startsWith("/app/") ? x[1]! : "/app/" + x[1]!)),
    );
    // Guarda contra a regex deixar de casar e o teste passar no vazio.
    expect(citados.length + curtos.length).toBeGreaterThan(60);
    const desconhecidos = [...new Set([...citados, ...curtos])].filter((h) => !HREFS.has(h));
    expect(desconhecidos).toEqual([]);
  });

  it("todo destino semeado no banco (acesso_modulo_recursos) existe no catálogo", () => {
    const arquivo = readdirSync("supabase/migrations").find((f) => f.includes("_0280_"));
    const sql = readFileSync(`supabase/migrations/${arquivo}`, "utf8");
    const seed = sql.slice(sql.indexOf("insert into public.acesso_modulo_recursos"), sql.indexOf("on conflict (recurso)"));
    const destinos = [...seed.matchAll(/'(\/app\/[a-z0-9/_-]+)'/g)].map((m) => m[1]!);
    expect(destinos.length).toBeGreaterThan(50);
    expect([...new Set(destinos)].filter((h) => !HREFS.has(h))).toEqual([]);
  });

  it("as áreas pessoais existem no catálogo e são sempre liberadas", () => {
    for (const d of DESTINOS_PESSOAIS) {
      expect(HREFS.has(d as string)).toBe(true);
      expect(rotaSempreLiberada(d)).toBe(true);
    }
    expect(rotaSempreLiberada("/api/v1/notifications")).toBe(true);
    expect(rotaSempreLiberada("/api/v1/contacts")).toBe(false);
    expect(rotaSempreLiberada("/app/area-futura")).toBe(false);
    expect(destinosDaRota("/app/area-futura")).toEqual([]);
  });
});
