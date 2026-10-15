// DEV only: test the migration transactionally, with fixtures always rolled back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const target = new URL(process.env.SUPABASE_DB_URL);
assert(target.hostname.includes('mypaqsvyygunlqnmpvfj') || decodeURIComponent(target.username).includes('mypaqsvyygunlqnmpvfj'), 'Development target required');
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10000 });
try {
 await db.connect(); await db.query('begin');
 const migration = await readFile('supabase/migrations/20261009220000_0266_jornada_cs_do_cliente.sql','utf8');
 await db.query(migration); await db.query(migration);
 const phases = await readFile('supabase/migrations/20261009223000_0267_fases_jornada_cs.sql','utf8');
 await db.query(phases); await db.query(phases);
 const {rows:[who]} = await db.query("select u.id as actor,m.organization_id as org from auth.users u join public.user_organizations m on m.user_id=u.id join public.organizations o on o.id=m.organization_id where u.email=$1 and o.slug='vendepay'",[process.env.OWNER_EMAIL]);
 assert(who); const {actor,org}=who;
 const {rows:[contact]}=await db.query("insert into public.contacts(organization_id,name,custom_fields) values($1,'Jornada fixture','{\"preserved\":true}') returning id",[org]);
 const {rows:[foreignOrg]}=await db.query("insert into public.organizations(slug,legal_name,display_name) values('fixture-jornada-'||gen_random_uuid(),'Fixture','Fixture') returning id");
 const {rows:[foreign]}=await db.query("insert into public.contacts(organization_id,name) values($1,'Foreign') returning id",[foreignOrg.id]);
 await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})]);
 await db.query('set local role authenticated');
 const update=async(id,phase,owner,revision)=>(await db.query('select public.fn_update_contact_cs($1,$2,$3,$4,$5) as result',[org,id,phase,owner,revision])).rows[0].result;
 assert.deepEqual(await update(contact.id,'onboarding',actor,0),{status:'saved',revision:1});
 assert.equal((await update(contact.id,'expansao',actor,0)).status,'conflict');
 assert.equal((await update(foreign.id,'onboarding',actor,0)).status,'not_found');
 assert.equal((await update(contact.id,'adocao',foreign.id,1)).status,'invalid_owner');
 assert.deepEqual(await update(contact.id,'onboarding',actor,1),{status:'saved',revision:1});
 assert.deepEqual(await update(contact.id,'adocao',null,1),{status:'saved',revision:2});
 const history=await db.query("select payload,performed_by_user_id from public.crm_lead_activities where contact_id=$1 and type='customer_journey_updated' order by created_at",[contact.id]);
 assert.equal(history.rowCount,2);assert.equal(history.rows[0].performed_by_user_id,actor);
 assert.equal(history.rows[0].payload.phase,'onboarding');
 assert.equal((await db.query('select custom_fields from public.contacts where id=$1',[contact.id])).rows[0].custom_fields.preserved,true);
 await db.query('reset role');
 await db.query("update public.user_organizations set role='viewer' where user_id=$1 and organization_id=$2",[actor,org]);
 await db.query('set local role authenticated');
 await db.query('savepoint denied');let denied;
 try {await update(contact.id,'expansao',null,2);}catch(e){denied=e.code;}
 await db.query('rollback to savepoint denied');assert.equal(denied,'42501');
 await db.query('reset role');
 await db.query("update public.user_organizations set role='agent' where user_id=$1 and organization_id=$2",[actor,org]);
 await db.query('set local role authenticated');
 assert.deepEqual(await update(contact.id,'expansao',actor,2),{status:'saved',revision:3});
 await db.query('savepoint denied');denied=undefined;
 try {await update(contact.id,'expansao',null,3);}catch(e){denied=e.code;}
 await db.query('rollback to savepoint denied');assert.equal(denied,'42501');
 await db.query('reset role');
 await db.query('update public.contacts set is_anonymized=true,anonymized_at=now() where id=$1',[contact.id]);
 await db.query('set local role authenticated');
 assert.equal((await update(contact.id,'onboarding',actor,3)).status,'not_found');
 process.stdout.write('PASS: idempotent migration, tenant isolation, viewer denial, agent assignment, revision conflict, unchanged no-op, preserved fields and atomic customer history.\n');
} finally {await db.query('rollback').catch(()=>{});await db.end();}
