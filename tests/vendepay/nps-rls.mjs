// DEV-only verification: migration and fixtures are rolled back.
import pg from 'pg';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash,randomBytes} from 'node:crypto';
const target=new URL(process.env.SUPABASE_DB_URL);assert(target.hostname.includes('mypaqsvyygunlqnmpvfj')||decodeURIComponent(target.username).includes('mypaqsvyygunlqnmpvfj'));
const db=new pg.Client({connectionString:process.env.SUPABASE_DB_URL});const hash=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
try{await db.connect();await db.query('begin');const sql=await readFile('supabase/migrations/20261009230000_0268_pesquisa_nps_cliente.sql','utf8');await db.query(sql);await db.query(sql);const guard=await readFile('supabase/migrations/20261009233000_0269_nps_substituicao_autorizada.sql','utf8');await db.query(guard);await db.query(guard);
 const {rows:[who]}=await db.query("select u.id actor,m.organization_id org from auth.users u join public.user_organizations m on m.user_id=u.id join public.organizations o on o.id=m.organization_id where u.email=$1 and o.slug='vendepay'",[process.env.OWNER_EMAIL]);assert(who);const {actor,org}=who;
 const {rows:[c]}=await db.query("insert into public.contacts(organization_id,name) values($1,'NPS fixture') returning id",[org]);
 const {rows:[o]}=await db.query("insert into public.organizations(slug,legal_name,display_name) values('fixture-nps-'||gen_random_uuid(),'Fixture','Fixture') returning id");
 const {rows:[foreign]}=await db.query("insert into public.contacts(organization_id,name) values($1,'Foreign') returning id",[o.id]);
 await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})]);await db.query('set local role authenticated');
 const manage=async(action,h=null,survey=null,contact=c.id)=>(await db.query('select public.fn_manage_customer_nps($1,$2,$3,$4,$5) result',[org,contact,action,h,survey])).rows[0].result;
 const publicCall=async(h,score=null,comment=null)=>(await db.query('select public.fn_public_customer_nps($1,$2,$3) result',[h,score,comment])).rows[0].result;
 const h1=hash(),h2=hash(),h3=hash(),h4=hash();
 const first=await manage('create',h1);assert.equal(first.status,'saved');
 assert.equal((await manage('create',hash(),null,foreign.id)).status,'not_found');
 assert.equal((await db.query('select id from public.customer_nps_surveys where id=$1',[first.id])).rowCount,1);
 async function denied(fn){await db.query('savepoint deny');let code;try{await fn();}catch(e){code=e.code;}await db.query('rollback to savepoint deny');assert.equal(code,'42501');}
 await denied(()=>db.query('select token_hash from public.customer_nps_surveys'));await denied(()=>publicCall(h1,9));
 await db.query('reset role');await db.query("update public.user_organizations set role='agent' where user_id=$1 and organization_id=$2",[actor,org]);await db.query('update public.customer_nps_surveys set created_by_user_id=null where id=$1',[first.id]);await db.query('set local role authenticated');await denied(()=>manage('create',hash()));await denied(()=>manage('cancel',null,first.id));await db.query('reset role');await db.query("update public.user_organizations set role='admin' where user_id=$1 and organization_id=$2",[actor,org]);await db.query('set local role authenticated');
 const second=await manage('create',h2);assert.equal(second.status,'saved');
 await db.query('reset role');await db.query('set local role service_role');
 assert.equal((await publicCall(h1)).status,'unavailable');assert.deepEqual(await publicCall(h2),{status:'ready'});
 assert.deepEqual(await publicCall(h2,0,'Comentário de teste'),{status:'saved'});assert.deepEqual(await publicCall(h2,10,'Overwrite'),{status:'answered'});
 await db.query('reset role');
 const row=(await db.query('select score,comment from public.customer_nps_surveys where id=$1',[second.id])).rows[0];assert.equal(row.score,0);assert.equal(row.comment,'Comentário de teste');
 assert.equal((await db.query("select id from public.crm_lead_activities where contact_id=$1 and type='customer_nps_answered'",[c.id])).rowCount,1);
 assert.equal((await db.query("select id from public.api_audit_log where resource_id=$1 and metadata->>'operation'='customer.nps_answered'",[c.id])).rowCount,1);
 await db.query('set local role authenticated');const third=await manage('create',h3);assert.equal((await manage('cancel',null,third.id)).status,'saved');const fourth=await manage('create',h4);await db.query('reset role');await db.query('update public.customer_nps_surveys set expires_at=now()-interval \'1 second\' where id=$1',[fourth.id]);
 await db.query('set local role service_role');assert.equal((await publicCall(h3)).status,'unavailable');assert.equal((await publicCall(h4,8)).status,'unavailable');assert.equal((await publicCall(hash())).status,'unavailable');
 await db.query('reset role');await db.query("update public.user_organizations set role='viewer' where user_id=$1 and organization_id=$2",[actor,org]);await db.query('set local role authenticated');await denied(()=>manage('create',hash()));await db.query('reset role');
 await db.query('update public.contacts set is_anonymized=true,anonymized_at=now() where id=$1',[c.id]);assert.equal((await db.query('select comment from public.customer_nps_surveys where id=$1',[second.id])).rows[0].comment,null);
 assert.equal((await db.query("select payload from public.crm_lead_activities where contact_id=$1 and type='customer_nps_answered'",[c.id])).rows[0].payload.score,undefined);
 await db.query('set local role anon');await denied(()=>publicCall(h2));await denied(()=>db.query('select id from public.customer_nps_surveys'));
 process.stdout.write('PASS NPS: migration idempotent, scoped issuance, hash hidden, one answer including 0, replacement/cancellation/expiry, public minimal response, viewer/anon denial, audit/history and GDPR redaction.\n');
}finally{await db.query('rollback').catch(()=>{});await db.end();}
