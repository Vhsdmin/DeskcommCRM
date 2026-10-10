-- 0268: pesquisa pública autorizada por link opaco; gestão interna via sessão/RLS.
create table if not exists public.customer_nps_surveys (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 contact_id uuid not null references public.contacts(id) on delete cascade,
 created_by_user_id uuid references auth.users(id) on delete set null,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '30 days'),
 cancelled_at timestamptz,
 score integer check(score between 0 and 10),
 comment text check(char_length(comment)<=2000),
 answered_at timestamptz,
 constraint nps_answer_consistent check((score is null and answered_at is null) or (score is not null and answered_at is not null))
);
create index if not exists customer_nps_contact_idx on public.customer_nps_surveys(organization_id,contact_id,created_at desc);
create unique index if not exists customer_nps_one_pending on public.customer_nps_surveys(contact_id) where score is null and cancelled_at is null;
alter table public.customer_nps_surveys enable row level security;
revoke all on public.customer_nps_surveys from public,anon,authenticated;
grant select(id,organization_id,contact_id,created_by_user_id,created_at,expires_at,cancelled_at,score,comment,answered_at) on public.customer_nps_surveys to authenticated;
grant all on public.customer_nps_surveys to service_role;
drop policy if exists customer_nps_read on public.customer_nps_surveys;
create policy customer_nps_read on public.customer_nps_surveys for select to authenticated using (
 organization_id in(select public.fn_user_org_ids()) and exists(select 1 from public.contacts c where c.id=contact_id and c.organization_id=customer_nps_surveys.organization_id and not c.is_anonymized and c.is_merged_into is null)
);
-- Definer necessário: colunas de token e writes não são expostas ao cliente SQL.
create or replace function public.fn_manage_customer_nps(p_org uuid,p_contact uuid,p_action text,p_hash text default null,p_survey uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare role_name text; survey public.customer_nps_surveys%rowtype; c public.contacts%rowtype;
begin
 role_name:=public.fn_user_role_in_org(p_org);
 if auth.uid() is null or coalesce(role_name,'') not in('agent','manager','admin') then raise insufficient_privilege; end if;
 select * into c from public.contacts where id=p_contact and organization_id=p_org and not is_anonymized and is_merged_into is null for update;
 if not found then return jsonb_build_object('status','not_found'); end if;
 if p_action='create' then
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise check_violation; end if;
  update public.customer_nps_surveys set cancelled_at=now() where organization_id=p_org and contact_id=p_contact and score is null and cancelled_at is null;
  insert into public.customer_nps_surveys(organization_id,contact_id,created_by_user_id,token_hash) values(p_org,p_contact,auth.uid(),p_hash) returning * into survey;
 elsif p_action='cancel' then
  select * into survey from public.customer_nps_surveys where id=p_survey and organization_id=p_org and contact_id=p_contact for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if role_name='agent' and survey.created_by_user_id is distinct from auth.uid() then raise insufficient_privilege; end if;
  if survey.score is not null or survey.cancelled_at is not null then return jsonb_build_object('status','conflict'); end if;
  update public.customer_nps_surveys set cancelled_at=now() where id=survey.id and organization_id=p_org;
 else raise check_violation; end if;
 insert into public.crm_lead_activities(organization_id,contact_id,lead_id,source_module,type,actor_kind,performed_by_user_id,reason,payload)
 values(p_org,p_contact,null,'crm',case when p_action='create' then 'customer_nps_requested' else 'customer_nps_cancelled' end,'user',auth.uid(),case when p_action='create' then 'Link NPS criado' else 'Pesquisa NPS cancelada' end,jsonb_build_object('survey_id',survey.id));
 return jsonb_build_object('status','saved','id',survey.id,'expires_at',survey.expires_at);
end; $$;
revoke all on function public.fn_manage_customer_nps(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.fn_manage_customer_nps(uuid,uuid,text,text,uuid) to authenticated;
-- Inbound público: chamado somente pelo servidor após prova do token; nunca retorna PII, org ou resposta anterior.
create or replace function public.fn_public_customer_nps(p_hash text,p_score integer default null,p_comment text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare survey public.customer_nps_surveys%rowtype;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('status','unavailable'); end if;
 select * into survey from public.customer_nps_surveys where token_hash=p_hash for update;
 if not found then return jsonb_build_object('status','unavailable'); end if;
 -- A organização é resolvida exclusivamente pelo hash, nunca pela requisição.
 if survey.cancelled_at is not null or survey.expires_at<=now() or not exists(select 1 from public.contacts c where c.id=survey.contact_id and c.organization_id=survey.organization_id and not c.is_anonymized and c.is_merged_into is null) then return jsonb_build_object('status','unavailable'); end if;
 if survey.answered_at is not null then return jsonb_build_object('status','answered'); end if;
 if p_score is null then return jsonb_build_object('status','ready'); end if;
 if p_score not between 0 and 10 or char_length(p_comment)>2000 then raise check_violation; end if;
 update public.customer_nps_surveys set score=p_score,comment=nullif(btrim(p_comment),''),answered_at=now() where id=survey.id and organization_id=survey.organization_id;
 insert into public.crm_lead_activities(organization_id,contact_id,lead_id,source_module,type,actor_kind,reason,payload)
 values(survey.organization_id,survey.contact_id,null,'crm','customer_nps_answered','contact','Cliente respondeu ao NPS',jsonb_build_object('survey_id',survey.id,'score',p_score));
 insert into public.api_audit_log(organization_id,action,resource_type,resource_id,bypassed_rls,metadata) values(survey.organization_id,'contact.updated','contacts',survey.contact_id,true,jsonb_build_object('operation','customer.nps_answered','survey_id',survey.id,'actor_kind','contact'));
 return jsonb_build_object('status','saved');
end; $$;
revoke all on function public.fn_public_customer_nps(text,integer,text) from public,anon,authenticated;
grant execute on function public.fn_public_customer_nps(text,integer,text) to service_role;
-- Comentário pode conter dados pessoais: anonimização do contato também limpa a pesquisa.
create or replace function public.fn_redact_customer_nps() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.is_anonymized and not old.is_anonymized then
  update public.customer_nps_surveys set score=null,comment=null,answered_at=null,cancelled_at=coalesce(cancelled_at,now()) where contact_id=new.id and organization_id=new.organization_id;
  update public.crm_lead_activities set payload='{}',reason='Pesquisa NPS anonimizada' where contact_id=new.id and organization_id=new.organization_id and type in('customer_nps_requested','customer_nps_cancelled','customer_nps_answered');
 end if;
 return new;
end; $$;
revoke all on function public.fn_redact_customer_nps() from public,anon,authenticated;
drop trigger if exists contacts_redact_nps on public.contacts;
create trigger contacts_redact_nps after update of is_anonymized on public.contacts for each row execute function public.fn_redact_customer_nps();
