import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sql } from "./gov-helpers";

describe("permissões de módulos no banco real", () => {
  it("isola tenants, limita escritas, bloqueia RPC e preserva membros legados", () => {
    const proof = readFileSync("tests/fixtures/sql/equipe-acessos.sql", "utf8");
    expect(() => sql(`begin;\n${proof}\nrollback;`)).not.toThrow();
  });

  it("toda tabela de tenant com RLS tem as policies de módulo (Realtime não passa pelo pre-request)", () => {
    // Tabela nova de tenant sem `acesso_modulo_*` abriria o Realtime para perfis
    // restritos. Conserto: `select public.fn_aplicar_acesso_modulo();` na migration.
    const sem = sql(`
      select coalesce(string_agg(c.table_name, ','), '')
        from information_schema.columns c
        join pg_class pc on pc.oid = to_regclass(format('public.%I', c.table_name))
       where c.table_schema = 'public' and c.column_name = 'organization_id'
         and c.udt_name = 'uuid' and pc.relkind = 'r' and pc.relrowsecurity
         and (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.table_name
                 and p.policyname in ('acesso_modulo_select','acesso_modulo_insert','acesso_modulo_update','acesso_modulo_delete')) < 4;
    `).trim().split("\n").pop();
    expect(sem).toBe("");
  });

  it("as policies de módulo calculam o acesso uma vez por consulta, não por linha", () => {
    const porLinha = sql(`
      select count(*) from pg_policies
       where schemaname = 'public' and policyname like 'acesso_modulo_%'
         and coalesce(qual, with_check) like '%fn_acesso_modulo(organization_id%';
    `).trim().split("\n").pop();
    expect(porLinha).toBe("0");
  });
});
