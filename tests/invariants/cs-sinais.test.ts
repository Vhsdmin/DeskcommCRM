/**
 * Sinais de CS (migration 0273): isolamento, escrita só pelo servidor e o laço
 * que se fecha sozinho.
 *
 *  - `cs_sinais` / `cs_sinais_dia`: membro de A lê os sinais de A e ZERO de B;
 *    `authenticated` não escreve (só `fn_cs_recalcular_sinais`, service_role);
 *  - a função de recálculo não é executável pela sessão;
 *  - um sinal nasce quando a condição aparece (seller 16 dias sem vender = alta)
 *    e se resolve quando ela deixa de valer (voltou a vender), com fotografia
 *    diária espelhando os abertos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

const ORG_A = "c6000000-0000-4000-8000-00000000000a";
const ORG_B = "c6000000-0000-4000-8000-00000000000b";
const USER_A = "c6000000-0000-4000-8000-0000000000a1";
const USER_B = "c6000000-0000-4000-8000-0000000000b1";
const CONTACT_A = "c6000000-0000-4000-8000-0000000000ac";
const CONTACT_B = "c6000000-0000-4000-8000-0000000000bc";

function limpar(): void {
  sql(`
    delete from public.cs_sinais_dia where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.cs_sinais where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.contacts where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.user_organizations where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
    delete from auth.users where id in ('${USER_A}', '${USER_B}');
  `);
}

function erroComoUsuario(userId: string, comando: string): string | null {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${comando};
    `);
    return null;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

const abertos = (org: string, tipo: string) =>
  lastLine(sql(`select count(*) from public.cs_sinais where organization_id = '${org}' and tipo = '${tipo}' and resolvido_em is null;`));

beforeAll(() => {
  limpar();
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'sinais-a@invariant.test'), ('${USER_B}', 'sinais-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'sinais-inv-a', 'Sinais A', 'Sinais A'), ('${ORG_B}', 'sinais-inv-b', 'Sinais B', 'Sinais B');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${USER_A}', '${ORG_A}', 'agent', now()), ('${USER_B}', '${ORG_B}', 'agent', now());
    insert into public.contacts (id, organization_id, name, cs_phase, cs_owner_user_id, gestao_ultima_venda_em) values
      ('${CONTACT_A}', '${ORG_A}', 'Seller A', 'adocao', '${USER_A}', now() - interval '16 days'),
      ('${CONTACT_B}', '${ORG_B}', 'Seller B', 'adocao', '${USER_B}', now() - interval '40 days');
    select public.fn_cs_recalcular_sinais('${ORG_A}');
    select public.fn_cs_recalcular_sinais('${ORG_B}');
  `);
});

afterAll(() => {
  limpar();
});

describe("cs_sinais — isolamento e escrita", () => {
  it("membro de A lê os sinais de A e nenhum de B", () => {
    expect(countAs(USER_A, `select count(*) from public.cs_sinais where organization_id = '${ORG_A}';`)).toBeGreaterThan(0);
    expect(countAs(USER_A, `select count(*) from public.cs_sinais where organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(USER_A, `select count(*) from public.cs_sinais_dia where organization_id = '${ORG_B}';`)).toBe(0);
  });

  it("a sessão não escreve sinal nem roda o recálculo", () => {
    expect(
      erroComoUsuario(
        USER_A,
        `insert into public.cs_sinais (organization_id, contact_id, tipo, severidade, motivo, regra_versao, prazo)
         values ('${ORG_A}', '${CONTACT_A}', 'sem_contato', 'media', 'x', 'v', now())`,
      ),
    ).toContain("permission denied");
    expect(erroComoUsuario(USER_A, `update public.cs_sinais set severidade = 'media'`)).toContain("permission denied");
    expect(erroComoUsuario(USER_A, `select public.fn_cs_recalcular_sinais('${ORG_A}')`)).toContain("permission denied");
  });
});

describe("o laço se fecha sozinho", () => {
  it("16 dias sem vender abre sem_venda ALTA; 40 dias, CRÍTICA", () => {
    expect(lastLine(sql(`select severidade from public.cs_sinais where contact_id = '${CONTACT_A}' and tipo = 'sem_venda' and resolvido_em is null;`))).toBe("alta");
    expect(lastLine(sql(`select severidade from public.cs_sinais where contact_id = '${CONTACT_B}' and tipo = 'sem_venda' and resolvido_em is null;`))).toBe("critica");
  });

  it("recalcular de novo não duplica", () => {
    sql(`select public.fn_cs_recalcular_sinais('${ORG_A}');`);
    expect(abertos(ORG_A, "sem_venda")).toBe("1");
  });

  it("o seller voltou a vender: o sinal se resolve e sai da fotografia do dia", () => {
    sql(`
      update public.contacts set gestao_ultima_venda_em = now() where id = '${CONTACT_A}';
      select public.fn_cs_recalcular_sinais('${ORG_A}');
    `);
    expect(abertos(ORG_A, "sem_venda")).toBe("0");
    expect(lastLine(sql(`select count(*) from public.cs_sinais where contact_id = '${CONTACT_A}' and tipo = 'sem_venda' and resolvido_em is not null;`))).toBe("1");
    expect(lastLine(sql(`select count(*) from public.cs_sinais_dia where contact_id = '${CONTACT_A}' and tipo = 'sem_venda';`))).toBe("0");
  });
});
