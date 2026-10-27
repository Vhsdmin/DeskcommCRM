import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sql } from "./gov-helpers";
it("exclusão atômica: histórico CS, agenda, papéis, módulos e tenants", () => {
  expect(() =>
    sql(`begin;\n${readFileSync("tests/fixtures/sql/contato-exclusao.sql", "utf8")}\nrollback;`),
  ).not.toThrow();
});
