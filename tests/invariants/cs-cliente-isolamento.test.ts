/**
 * Isolamento entre organizações das peças de CS da VendePay (0261–0269).
 *
 * Prova comportamental — `set role authenticated` + JWT de um usuário real +
 * contagem cross-org — para:
 *  - `customer_nps_surveys`: membro da org A lê as pesquisas de A e ZERO de B;
 *    o `token_hash` (a credencial do link) não é legível pela sessão;
 *  - `fn_manage_customer_nps` (SECURITY DEFINER executável por authenticated):
 *    quem não é da org não cria nem cancela convite nela;
 *  - `fn_delete_customer_activity` (SECURITY DEFINER executável por
 *    authenticated): quem não é da org não apaga registro dela.
 *
 * Os dados são semeados como superusuário e apagados no fim; ids próprios para
 * não esbarrar em nenhum outro arquivo da suíte.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

const ORG_A = "c5000000-0000-4000-8000-00000000000a";
const ORG_B = "c5000000-0000-4000-8000-00000000000b";
const USER_A = "c5000000-0000-4000-8000-0000000000a1";
const USER_B = "c5000000-0000-4000-8000-0000000000b1";
const CONTACT_A = "c5000000-0000-4000-8000-0000000000ac";
const CONTACT_B = "c5000000-0000-4000-8000-0000000000bc";
const SURVEY_A = "c5000000-0000-4000-8000-0000000000a5";
const SURVEY_B = "c5000000-0000-4000-8000-0000000000b5";
const ACTIVITY_A = "c5000000-0000-4000-8000-0000000000a7";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_NOVO = "c".repeat(64);

function limpar(): void {
  sql(`
    delete from public.crm_lead_activities where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.customer_nps_surveys where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.contacts where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.user_organizations where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
    delete from auth.users where id in ('${USER_A}', '${USER_B}');
  `);
}

/** Executa `select <expr>` como `authenticated` com o JWT do usuário. */
function comoUsuario(userId: string, expr: string): string {
  return lastLine(
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      select ${expr};
    `),
  );
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

beforeAll(() => {
  limpar();
  sql(`
    insert into auth.users (id, email) values
      ('${USER_A}', 'cs-a@invariant.test'), ('${USER_B}', 'cs-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'cs-inv-a', 'CS Inv A', 'CS A'), ('${ORG_B}', 'cs-inv-b', 'CS Inv B', 'CS B');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${USER_A}', '${ORG_A}', 'admin', now()), ('${USER_B}', '${ORG_B}', 'admin', now());
    insert into public.contacts (id, organization_id, name) values
      ('${CONTACT_A}', '${ORG_A}', 'Cliente A'), ('${CONTACT_B}', '${ORG_B}', 'Cliente B');
    insert into public.customer_nps_surveys (id, organization_id, contact_id, created_by_user_id, token_hash) values
      ('${SURVEY_A}', '${ORG_A}', '${CONTACT_A}', '${USER_A}', '${HASH_A}'),
      ('${SURVEY_B}', '${ORG_B}', '${CONTACT_B}', '${USER_B}', '${HASH_B}');
    insert into public.crm_lead_activities
      (id, organization_id, contact_id, lead_id, source_module, type, actor_kind, performed_by_user_id, payload)
      values ('${ACTIVITY_A}', '${ORG_A}', '${CONTACT_A}', null, 'crm', 'customer_support', 'user', '${USER_A}', '{"summary":"x"}');
  `);
});

afterAll(() => {
  limpar();
});

describe("customer_nps_surveys — isolamento por organização", () => {
  it("membro de A lê as pesquisas de A e nenhuma de B", () => {
    expect(countAs(USER_A, `select count(*) from public.customer_nps_surveys where organization_id = '${ORG_A}';`)).toBe(1);
    expect(countAs(USER_A, `select count(*) from public.customer_nps_surveys where organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(USER_B, `select count(*) from public.customer_nps_surveys where id = '${SURVEY_A}';`)).toBe(0);
  });

  it("o token_hash do link não é legível pela sessão, nem da própria org", () => {
    const erro = erroComoUsuario(USER_A, `select token_hash from public.customer_nps_surveys`);
    expect(erro).toContain("permission denied");
  });
});

describe("definers de CS executáveis por authenticated não atravessam organização", () => {
  it("fn_manage_customer_nps: quem é de B não cria convite em A", () => {
    const erro = erroComoUsuario(
      USER_B,
      `select public.fn_manage_customer_nps('${ORG_A}', '${CONTACT_A}', 'create', '${HASH_NOVO}', null)`,
    );
    expect(erro).toContain("insufficient_privilege");
    expect(lastLine(sql(`select count(*) from public.customer_nps_surveys where token_hash = '${HASH_NOVO}';`))).toBe("0");
  });

  it("fn_manage_customer_nps: quem é de B não cancela convite de A", () => {
    const erro = erroComoUsuario(
      USER_B,
      `select public.fn_manage_customer_nps('${ORG_A}', '${CONTACT_A}', 'cancel', null, '${SURVEY_A}')`,
    );
    expect(erro).not.toBeNull();
    expect(lastLine(sql(`select cancelled_at is null from public.customer_nps_surveys where id = '${SURVEY_A}';`))).toBe("t");
  });

  it("fn_delete_customer_activity: quem é de B não apaga registro de A", () => {
    expect(
      comoUsuario(USER_B, `public.fn_delete_customer_activity('${ACTIVITY_A}', '${CONTACT_A}', '${ORG_A}', 0)`),
    ).toBe("f");
    expect(lastLine(sql(`select deleted_at is null from public.crm_lead_activities where id = '${ACTIVITY_A}';`))).toBe("t");
  });

  it("controle positivo: o dono do registro em A consegue apagá-lo", () => {
    expect(
      comoUsuario(USER_A, `public.fn_delete_customer_activity('${ACTIVITY_A}', '${CONTACT_A}', '${ORG_A}', 0)`),
    ).toBe("t");
  });
});
