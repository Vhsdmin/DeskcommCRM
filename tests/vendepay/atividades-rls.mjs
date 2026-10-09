// Run with: node --env-file=.env.local tests/vendepay/atividades-rls.mjs
// Fixtures are transaction-scoped and always rolled back.
import pg from 'pg';
const { Client } = pg;
import assert from 'node:assert/strict';
(async () => {
  const target = new URL(process.env.SUPABASE_DB_URL);
  assert(target.hostname.includes('mypaqsvyygunlqnmpvfj') || decodeURIComponent(target.username).includes('mypaqsvyygunlqnmpvfj'), 'Development target required');
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10000 });
  try {
    await db.connect(); await db.query('begin');
    const who = await db.query("select u.id as actor, o.id as org from auth.users u join public.user_organizations m on m.user_id=u.id join public.organizations o on o.id=m.organization_id where u.email=$1 and o.slug='vendepay'", [process.env.OWNER_EMAIL]);
    assert.equal(who.rows.length, 1); const { actor, org } = who.rows[0];
    const own = await db.query("insert into public.contacts(organization_id,name,email) values($1,'Fixture RLS','rls@example.invalid') returning id", [org]);
    const otherOrg = await db.query("insert into public.organizations(slug,legal_name,display_name) values('fixture-cs-'||gen_random_uuid(),'Fixture','Fixture') returning id");
    const foreign = await db.query("insert into public.contacts(organization_id,name,email) values($1,'Foreign fixture','foreign@example.invalid') returning id", [otherOrg.rows[0].id]);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role: 'authenticated' })]);
    await db.query('set local role authenticated');
    const insert = "insert into public.crm_lead_activities(organization_id,contact_id,lead_id,source_module,type,payload,performed_by_user_id,actor_kind) values($1,$2,null,'crm','customer_support','{}',$3,'user') returning id";
    const saved = await db.query(insert, [org, own.rows[0].id, actor]);
    assert.equal((await db.query('select id from public.crm_lead_activities where id=$1', [saved.rows[0].id])).rows.length, 1);
    assert.equal((await db.query('select id from public.contacts where id=$1', [foreign.rows[0].id])).rows.length, 0);
    async function denied(values) {
      await db.query('savepoint refusal'); let code;
      try { await db.query(insert, values); } catch (e) { code = e.code; }
      await db.query('rollback to savepoint refusal'); assert(['42501','23503','23514'].includes(code), 'Forbidden write must be rejected');
    }
    await denied([org, foreign.rows[0].id, actor]);
    await denied([otherOrg.rows[0].id, foreign.rows[0].id, actor]);
    await db.query('reset role');
    await db.query("update public.user_organizations set role='viewer' where user_id=$1 and organization_id=$2", [actor, org]);
    await db.query('set local role authenticated'); await denied([org, own.rows[0].id, actor]);
    await db.query('reset role');
    await db.query("update public.user_organizations set role='admin' where user_id=$1 and organization_id=$2", [actor, org]);
    await db.query("update public.contacts set is_anonymized=true,anonymized_at=now() where id=$1", [own.rows[0].id]);
    await db.query('set local role authenticated'); await denied([org, own.rows[0].id, actor]);
    process.stdout.write('RLS verified: own history readable; cross-tenant, viewer and anonymized writes denied.\n');
  } finally { await db.query('rollback').catch(() => {}); await db.end(); }
})().catch(e => { process.stderr.write(`RLS verification failed: ${e.code || e.name} ${e.constraint || ""} ${e.message}\n`); process.exitCode = 1; });
