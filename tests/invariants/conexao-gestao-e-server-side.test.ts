/**
 * `gestao_conexoes` é server-side only (migration 0271).
 *
 * A linha guarda o segredo que assina os envios do Gestão VendePay: quem o lê
 * forja "conta cadastrada" e cria clientes no CRM. Por isso o desenho é o mesmo
 * de `platform_meta_app`: RLS ligada SEM policies e privilégio nenhum para
 * `anon`/`authenticated` — só o servidor, atrás do gate de papel da API, toca a
 * tabela. Este arquivo mede isso sob `set role`, não pela leitura do catálogo.
 */
import { describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const TABELA = "gestao_conexoes";

function erroSob(papel: string, comando: string): string | null {
  try {
    sql(`set role ${papel};\n${comando};\nreset role;`);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

function esperaBarrado(papel: string, comando: string): void {
  const erro = erroSob(papel, comando);
  expect(erro, `\`${papel}\` executou "${comando}" SEM erro — a tabela está exposta`).not.toBeNull();
  expect(erro).toContain("permission denied");
}

function privilegiosDe(papel: string): string {
  return sql(`
    select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NENHUM')
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = '${TABELA}'
       and grantee = '${papel}';
  `).trim();
}

describe("o PostgREST não serve a conexão com o Gestão", () => {
  it("`anon` e `authenticated` não têm privilégio nenhum", () => {
    expect(privilegiosDe("anon")).toBe("NENHUM");
    expect(privilegiosDe("authenticated")).toBe("NENHUM");
  });

  it("`service_role` continua com privilégio — controle positivo", () => {
    expect(privilegiosDe("service_role")).toContain("SELECT");
  });

  it("ler e escrever sob `authenticated` é barrado com permission denied", () => {
    esperaBarrado("authenticated", `select id from public.${TABELA}`);
    esperaBarrado("anon", `select id from public.${TABELA}`);
    esperaBarrado(
      "authenticated",
      `insert into public.${TABELA} (organization_id, path_token, secret_encrypted) values (gen_random_uuid(), repeat('x', 32), '\\x00')`,
    );
  });

  it("a RLS está ligada e não há policy nenhuma", () => {
    expect(sql(`select relrowsecurity from pg_class where oid = 'public.${TABELA}'::regclass;`).trim()).toBe("t");
    expect(sql(`select count(*) from pg_policies where schemaname = 'public' and tablename = '${TABELA}';`).trim()).toBe("0");
  });
});
