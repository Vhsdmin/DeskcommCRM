// Prova isolada das constraints e transações. Não substitui test:db (schema completo/RLS).
// PGLITE_MODULE=/caminho/temporario/node_modules/@electric-sql/pglite/dist/index.js node tests/vendepay/exclusao-cliente-isolada.mjs
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = new URL("../../", import.meta.url);
const db = new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema auth;
create function public.fn_is_platform_admin() returns boolean language sql as $$select false$$;
create function public.fn_role_at_least(uuid,text) returns boolean language sql as $$select true$$;
create table contacts(id uuid primary key,organization_id uuid);
create table crm_lead_activities(id uuid primary key,organization_id uuid,lead_id uuid,contact_id uuid references contacts(id) on delete set null,constraint activity_contact_or_lead check(lead_id is not null or contact_id is not null));
create table conversations(id uuid primary key,organization_id uuid,contact_id uuid references contacts(id) on delete restrict);
create table messages(id uuid primary key,organization_id uuid,contact_id uuid references contacts(id) on delete restrict);
create table calendar_appointments(id uuid primary key,contact_id uuid references contacts(id) on delete restrict);
create table acesso_modulo_recursos(recurso text primary key,padrao boolean,prioridade int,leitura text[],escrita text[]);`);
const org = "c2810000-0000-4000-8000-00000000000a",
  c = "c2810000-0000-4000-8000-0000000000ca";
await db.query("insert into contacts values($1,$2)", [c, org]);
await db.query("insert into crm_lead_activities values($1,$2,null,$1)", [c, org]);
await assert.rejects(
  () => db.query("delete from contacts where id=$1", [c]),
  (e) => e.code === "23514",
);
console.info("RED comprovado: exclusão anterior falha com 23514 (activity_contact_or_lead)");
const migration = readFileSync(
  new URL("supabase/migrations/20261027120000_0281_exclusao_atomica_cliente.sql", root),
  "utf8",
);
await db.exec(migration);
await db.exec(migration);
await db.query("insert into conversations values($1,$2,$1);", [c, org]);
await db.query("insert into messages values($1,$2,$1);", [c, org]);
await db.query("insert into calendar_appointments values($1,$1)", [c]);
await assert.rejects(
  () => db.query("select fn_delete_contact($1,$2)", [org, c]),
  (e) => ["23503", "23001"].includes(e.code),
);
for (const t of ["contacts", "crm_lead_activities", "messages", "conversations"])
  assert.equal((await db.query(`select count(*)::int as n from ${t}`)).rows[0].n, 1);
console.info("PASS: agenda bloqueia com rollback de ficha, atividades, mensagens e conversas");
await db.exec("delete from calendar_appointments");
await db.query(
  "insert into crm_lead_activities values(gen_random_uuid(),$1,gen_random_uuid(),$2)",
  [org, c],
);
assert.equal((await db.query("select fn_delete_contact($1,$2) as id", [org, c])).rows[0].id, c);
assert.equal(
  (
    await db.query(
      "select count(*)::int as n from crm_lead_activities where lead_id is not null and contact_id is null",
    )
  ).rows[0].n,
  1,
);
await db.exec("delete from crm_lead_activities");
for (const t of ["contacts", "crm_lead_activities", "messages", "conversations"])
  assert.equal((await db.query(`select count(*)::int as n from ${t}`)).rows[0].n, 0);
assert.equal((await db.query("select fn_delete_contact($1,$2) as id", [org, c])).rows[0].id, null);
assert.equal(
  (
    await db.query(
      "select has_function_privilege('anon','fn_delete_contact(uuid,uuid)','execute') as allowed",
    )
  ).rows[0].allowed,
  false,
);
console.info(
  "PASS: exclusão completa, repetição, idempotência da migration e RPC negada para anon",
);
// Reproduz a porta alternativa: viewer usa DELETE direto, não a RPC.
await db.query("insert into contacts values($1,$2)", [c, org]);
await db.query("insert into crm_lead_activities values($1,$2,null,$1)", [c, org]);
await db.exec(`alter table contacts enable row level security;
create policy tenant_all on contacts using (true) with check (true);
grant all on contacts to authenticated;
create or replace function public.fn_role_at_least(uuid,text) returns boolean language sql as $$select false$$;`);
await db.exec("begin; set local role authenticated;");
assert.equal((await db.query("delete from contacts where id=$1 returning id", [c])).rows.length, 1);
await db.exec("reset role");
assert.equal((await db.query("select count(*)::int as n from crm_lead_activities")).rows[0].n, 0);
await db.exec("rollback");
console.info("RED comprovado: sem 0282, viewer apaga ficha e histórico pela tabela");
const guard = readFileSync(
  new URL("supabase/migrations/20261027130000_0282_exclusao_cliente_exige_papel.sql", root),
  "utf8",
);
await db.exec(guard);
await db.exec(guard);
await db.exec("begin; set local role authenticated;");
assert.equal((await db.query("delete from contacts where id=$1 returning id", [c])).rows.length, 0);
await assert.rejects(
  () => db.query("select fn_delete_contact($1,$2)", [org, c]),
  (e) => e.code === "42501",
);
await db.exec("rollback");
assert.equal((await db.query("select count(*)::int as n from crm_lead_activities")).rows[0].n, 1);
await db.exec(
  `create or replace function public.fn_role_at_least(uuid,text) returns boolean language sql as $$select true$$;`,
);
await db.exec("begin; set local role authenticated;");
assert.equal((await db.query("delete from contacts where id=$1 returning id", [c])).rows.length, 1);
await db.exec("commit; reset role");
assert.equal((await db.query("select count(*)::int as n from crm_lead_activities")).rows[0].n, 0);
console.info("PASS: 0282 bloqueia DELETE direto/RPC de viewer, mantém histórico e permite agent");
await db.close();
