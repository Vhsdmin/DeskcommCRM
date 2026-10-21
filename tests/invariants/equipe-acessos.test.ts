import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sql } from "./gov-helpers";

describe("permissões de módulos no banco real", () => {
  it("isola tenants, limita escritas, bloqueia RPC e preserva membros legados", () => {
    const proof = readFileSync("tests/fixtures/sql/equipe-acessos.sql", "utf8");
    expect(() => sql(`begin;\n${proof}\nrollback;`)).not.toThrow();
  });
});
