/**
 * Playbooks de CS (migration 0275): isolamento, quem configura e o laço
 * "alerta abre → tarefas → alerta se resolve → tarefas canceladas".
 *
 *  - `cs_playbooks`: membro de A lê os de A e ZERO de B; agente não grava;
 *  - `fn_cs_aplicar_playbooks` não é executável pela sessão;
 *  - sem vender 8 dias cria só o passo de severidade média; 16 dias acrescenta o
 *    de alta; 31, o de crítica, com o responsável fixo do passo;
 *  - recalcular não duplica; voltou a vender: as tarefas abertas são canceladas.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

const ORG_A = "c8000000-0000-4000-8000-00000000000a";
const ORG_B = "c8000000-0000-4000-8000-00000000000b";
const CSM_A = "c8000000-0000-4000-8000-0000000000a1";
const HEAD_A = "c8000000-0000-4000-8000-0000000000a2";
const USER_B = "c8000000-0000-4000-8000-0000000000b1";
const CONTACT_A = "c8000000-0000-4000-8000-0000000000ac";
const FAIXA_A = "c8000000-0000-4000-8000-0000000000f1";

function limpar(): void {
  sql(`
    delete from public.crm_tasks where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.cs_sinais_dia where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.cs_sinais where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.cs_playbooks where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.contacts where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.cs_carteira_faixas where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.user_organizations where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
    delete from auth.users where id in ('${CSM_A}', '${HEAD_A}', '${USER_B}');
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

const recalcular = () => sql(`select public.fn_cs_recalcular_sinais('${ORG_A}');`);
const tarefas = () =>
  lastLine(
    sql(`
      select coalesce(string_agg(cs_playbook_passo || ':' || status, ',' order by cs_playbook_passo), '-')
        from public.crm_tasks where contact_id = '${CONTACT_A}';
    `),
  );
const semVendaHa = (dias: number) =>
  sql(
    `update public.contacts set gestao_ultima_venda_em = now() - interval '${dias} days' where id = '${CONTACT_A}';`,
  );

beforeAll(() => {
  limpar();
  sql(`
    insert into auth.users (id, email) values
      ('${CSM_A}', 'playbook-csm@invariant.test'),
      ('${HEAD_A}', 'playbook-head@invariant.test'),
      ('${USER_B}', 'playbook-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'playbook-inv-a', 'Playbook A', 'Playbook A'),
      ('${ORG_B}', 'playbook-inv-b', 'Playbook B', 'Playbook B');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${CSM_A}', '${ORG_A}', 'agent', now()),
      ('${HEAD_A}', '${ORG_A}', 'manager', now()),
      ('${USER_B}', '${ORG_B}', 'agent', now());
    insert into public.cs_carteira_faixas (id, organization_id, nome, inicio_centavos, tipo, responsavel_user_id) values
      ('${FAIXA_A}', '${ORG_A}', 'CSM', 0, 'csm', '${CSM_A}');
    insert into public.cs_playbooks (organization_id, tipo_sinal, passos) values
      ('${ORG_A}', 'sem_venda', '[
        {"chave": "a_whatsapp", "titulo": "Contato pelo WhatsApp", "dias": 0, "prioridade": "medium", "severidade_minima": "media"},
        {"chave": "b_ligacao", "titulo": "Ligação", "dias": 1, "prioridade": "high", "severidade_minima": "alta"},
        {"chave": "c_escalar", "titulo": "Escalar para o head", "dias": 0, "prioridade": "urgent",
         "severidade_minima": "critica", "responsavel_user_id": "${HEAD_A}"}
      ]'),
      ('${ORG_B}', 'sem_venda', '[]');
    insert into public.contacts (id, organization_id, name, cs_phase, cs_owner_user_id, gestao_ultima_venda_em, last_activity_at) values
      ('${CONTACT_A}', '${ORG_A}', 'Seller Playbook', 'adocao', '${CSM_A}', now() - interval '8 days', now());
  `);
  recalcular();
});

afterAll(() => {
  limpar();
});

describe("cs_playbooks — isolamento e quem configura", () => {
  it("membro de A lê o playbook de A e nenhum de B", () => {
    expect(countAs(CSM_A, `select count(*) from public.cs_playbooks where organization_id = '${ORG_A}';`)).toBe(1);
    expect(countAs(CSM_A, `select count(*) from public.cs_playbooks where organization_id = '${ORG_B}';`)).toBe(0);
  });

  it("agente não grava playbook nem roda a aplicação", () => {
    expect(
      erroComoUsuario(
        CSM_A,
        `insert into public.cs_playbooks (organization_id, tipo_sinal) values ('${ORG_A}', 'sem_contato')`,
      ),
    ).toMatch(/row-level security|permission denied/);
    expect(erroComoUsuario(CSM_A, `select public.fn_cs_aplicar_playbooks('${ORG_A}')`)).toContain(
      "permission denied",
    );
  });
});

describe("alerta → tarefas → resolvido", () => {
  it("8 dias sem vender (média): só o primeiro passo, para o dono do alerta", () => {
    expect(tarefas()).toBe("a_whatsapp:pending");
    expect(
      lastLine(sql(`select assigned_to from public.crm_tasks where contact_id = '${CONTACT_A}' and cs_playbook_passo = 'a_whatsapp';`)),
    ).toBe(CSM_A);
  });

  it("recalcular de novo não duplica", () => {
    recalcular();
    expect(tarefas()).toBe("a_whatsapp:pending");
  });

  it("a escada: 16 dias acrescenta a ligação; 31, a escalada para o head", () => {
    semVendaHa(16);
    recalcular();
    expect(tarefas()).toBe("a_whatsapp:pending,b_ligacao:pending");
    semVendaHa(31);
    recalcular();
    expect(tarefas()).toBe("a_whatsapp:pending,b_ligacao:pending,c_escalar:pending");
    expect(
      lastLine(sql(`select assigned_to from public.crm_tasks where contact_id = '${CONTACT_A}' and cs_playbook_passo = 'c_escalar';`)),
    ).toBe(HEAD_A);
  });

  it("voltou a vender: o alerta se resolve e as tarefas abertas são canceladas", () => {
    sql(`update public.crm_tasks set status = 'done' where contact_id = '${CONTACT_A}' and cs_playbook_passo = 'a_whatsapp';`);
    semVendaHa(0);
    recalcular();
    expect(tarefas()).toBe("a_whatsapp:done,b_ligacao:cancelled,c_escalar:cancelled");
  });
});
