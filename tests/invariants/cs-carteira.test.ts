/**
 * Carteira por faixa (migration 0274): isolamento, quem configura e o ciclo
 * "subiu de faixa → assumir".
 *
 *  - `cs_carteira_faixas`: membro de A lê as faixas de A e ZERO de B; agente não
 *    configura faixa (só manager+);
 *  - cliente novo entra na faixa do GMV (sem GMV = primeira) e fica no nome do
 *    responsável dela; na faixa de SUPORTE não gera alerta de CS;
 *  - GMV alcançou a faixa de CSM: abre `mudanca_de_faixa` para a responsável;
 *  - só ela (ou um gestor) assume; outro agente e outra org levam
 *    insufficient_privilege; depois de assumir o sinal se resolve e a queda de GMV não rebaixa.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

const ORG_A = "c7000000-0000-4000-8000-00000000000a";
const ORG_B = "c7000000-0000-4000-8000-00000000000b";
const CSM_A = "c7000000-0000-4000-8000-0000000000a1";
const SUPORTE_A = "c7000000-0000-4000-8000-0000000000a2";
const USER_B = "c7000000-0000-4000-8000-0000000000b1";
const CONTACT_A = "c7000000-0000-4000-8000-0000000000ac";
const FAIXA_SUPORTE = "c7000000-0000-4000-8000-0000000000f1";
const FAIXA_CSM = "c7000000-0000-4000-8000-0000000000f2";
const FAIXA_B = "c7000000-0000-4000-8000-0000000000f3";

function limpar(): void {
  sql(`
    delete from public.crm_lead_activities where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.cs_sinais_dia where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.cs_sinais where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.contacts where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.cs_carteira_faixas where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.user_organizations where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
    delete from auth.users where id in ('${CSM_A}', '${SUPORTE_A}', '${USER_B}');
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

function comoUsuario(userId: string, comando: string): string {
  return lastLine(
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${comando};
    `),
  );
}

const recalcular = () => sql(`select public.fn_cs_recalcular_sinais('${ORG_A}');`);
const campo = (coluna: string) =>
  lastLine(sql(`select ${coluna} from public.contacts where id = '${CONTACT_A}';`));
const abertos = (tipo: string) =>
  lastLine(
    sql(
      `select count(*) from public.cs_sinais where contact_id = '${CONTACT_A}' and tipo = '${tipo}' and resolvido_em is null;`,
    ),
  );

beforeAll(() => {
  limpar();
  sql(`
    insert into auth.users (id, email) values
      ('${CSM_A}', 'carteira-csm@invariant.test'),
      ('${SUPORTE_A}', 'carteira-suporte@invariant.test'),
      ('${USER_B}', 'carteira-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'carteira-inv-a', 'Carteira A', 'Carteira A'),
      ('${ORG_B}', 'carteira-inv-b', 'Carteira B', 'Carteira B');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${CSM_A}', '${ORG_A}', 'agent', now()),
      ('${SUPORTE_A}', '${ORG_A}', 'agent', now()),
      ('${USER_B}', '${ORG_B}', 'agent', now());
    insert into public.cs_carteira_faixas (id, organization_id, nome, inicio_centavos, tipo, responsavel_user_id) values
      ('${FAIXA_SUPORTE}', '${ORG_A}', 'Suporte', 0, 'suporte', '${SUPORTE_A}'),
      ('${FAIXA_CSM}', '${ORG_A}', 'CSM', 1000001, 'csm', '${CSM_A}'),
      ('${FAIXA_B}', '${ORG_B}', 'Suporte B', 0, 'suporte', '${USER_B}');
    -- Cliente novo, 40 dias sem vender e sem GMV informado.
    insert into public.contacts (id, organization_id, name, cs_phase, gestao_ultima_venda_em) values
      ('${CONTACT_A}', '${ORG_A}', 'Seller Carteira', 'adocao', now() - interval '40 days');
  `);
  recalcular();
});

afterAll(() => {
  limpar();
});

describe("cs_carteira_faixas — isolamento e quem configura", () => {
  it("membro de A lê as faixas de A e nenhuma de B", () => {
    expect(countAs(CSM_A, `select count(*) from public.cs_carteira_faixas where organization_id = '${ORG_A}';`)).toBe(2);
    expect(countAs(CSM_A, `select count(*) from public.cs_carteira_faixas where organization_id = '${ORG_B}';`)).toBe(0);
  });

  it("agente não cria nem altera faixa", () => {
    expect(
      erroComoUsuario(
        CSM_A,
        `insert into public.cs_carteira_faixas (organization_id, nome, inicio_centavos, tipo)
         values ('${ORG_A}', 'Intrusa', 5000000, 'csm')`,
      ),
    ).toMatch(/row-level security|permission denied/);
    expect(
      comoUsuario(
        CSM_A,
        `with x as (update public.cs_carteira_faixas set nome = 'x' where organization_id = '${ORG_A}' returning 1)
         select count(*) from x`,
      ),
    ).toBe("0");
  });
});

describe("subiu de faixa → assumir", () => {
  it("cliente novo entra na faixa de suporte, no nome do suporte, sem alerta de CS", () => {
    expect(campo("carteira_faixa_id")).toBe(FAIXA_SUPORTE);
    expect(campo("cs_owner_user_id")).toBe(SUPORTE_A);
    expect(abertos("sem_venda")).toBe("0");
  });

  it("GMV alcançou a faixa de CSM: alerta ALTO para a responsável dela", () => {
    sql(`update public.contacts set gestao_gmv_30d_centavos = 1500000 where id = '${CONTACT_A}';`);
    recalcular();
    expect(abertos("mudanca_de_faixa")).toBe("1");
    expect(
      lastLine(
        sql(
          `select severidade || '|' || dono_user_id from public.cs_sinais where contact_id = '${CONTACT_A}' and tipo = 'mudanca_de_faixa' and resolvido_em is null;`,
        ),
      ),
    ).toBe(`alta|${CSM_A}`);
  });

  it("outra org e outro agente não assumem", () => {
    expect(erroComoUsuario(USER_B, `select public.fn_cs_assumir_cliente('${ORG_A}', '${CONTACT_A}')`)).toMatch(
      /insufficient_privilege|permission denied/,
    );
    expect(erroComoUsuario(SUPORTE_A, `select public.fn_cs_assumir_cliente('${ORG_A}', '${CONTACT_A}')`)).toMatch(
      /insufficient_privilege|permission denied/,
    );
    expect(campo("carteira_faixa_id")).toBe(FAIXA_SUPORTE);
  });

  it("a responsável assume: muda faixa e dono, registra no histórico e o alerta se resolve", () => {
    expect(comoUsuario(CSM_A, `select public.fn_cs_assumir_cliente('${ORG_A}', '${CONTACT_A}') ->> 'status'`)).toBe(
      "saved",
    );
    expect(campo("carteira_faixa_id")).toBe(FAIXA_CSM);
    expect(campo("cs_owner_user_id")).toBe(CSM_A);
    expect(
      lastLine(
        sql(
          `select count(*) from public.crm_lead_activities where contact_id = '${CONTACT_A}' and type = 'customer_portfolio_changed';`,
        ),
      ),
    ).toBe("1");
    recalcular();
    expect(abertos("mudanca_de_faixa")).toBe("0");
    // Agora é cliente de CSM: os alertas de CS passam a valer.
    expect(abertos("sem_venda")).toBe("1");
  });

  it("GMV caiu: o cliente não desce de faixa sozinho", () => {
    sql(`update public.contacts set gestao_gmv_30d_centavos = 100 where id = '${CONTACT_A}';`);
    recalcular();
    expect(campo("carteira_faixa_id")).toBe(FAIXA_CSM);
    expect(abertos("mudanca_de_faixa")).toBe("0");
  });
});
