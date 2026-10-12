-- 0270: leitura agregada sobre as fontes existentes. Sem snapshots nem nova conta.
-- SECURITY INVOKER: preserva RLS/colunas; autenticação e org também validadas no RPC.
create index if not exists customer_nps_org_created_idx on public.customer_nps_surveys(organization_id,created_at desc,id);
create index if not exists cs_activity_org_actor_time_idx on public.crm_lead_activities(organization_id,performed_by_user_id,performed_at) where deleted_at is null and type in ('customer_support','customer_meeting','customer_ebr','customer_qbr');
create or replace function public.fn_cs_nps_dashboard(p_org uuid,p_from timestamptz,p_to timestamptz,p_status text default 'all',p_class text default 'all',p_offset integer default 0,p_owner uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
 if auth.uid() is null or public.fn_user_role_in_org(p_org) is null then raise insufficient_privilege; end if;
 if p_from is null or p_to is null or p_from>=p_to or p_to-p_from>interval '732 days' or p_offset<0 or p_offset>1000000 or p_status not in('all','answered','pending','expired','cancelled') or p_class not in('all','detractor','neutral','promoter') then raise check_violation; end if;
 with base as materialized (
  select s.id,s.contact_id,c.name,c.cs_owner_user_id,s.created_by_user_id,s.created_at,s.answered_at,s.score,s.comment,s.expires_at,
   case when s.answered_at is not null then 'answered' when s.cancelled_at is not null then 'cancelled' when s.expires_at<=now() then 'expired' else 'pending' end status
  from public.customer_nps_surveys s join public.contacts c on c.id=s.contact_id and c.organization_id=p_org
  where s.organization_id=p_org and not c.is_anonymized and c.is_merged_into is null and s.created_at>=p_from and s.created_at<p_to and (p_owner is null or s.created_by_user_id=p_owner)
 ), summary as (
  select count(*) total,count(*) filter(where status='answered') answered,count(*) filter(where status='pending') pending,count(*) filter(where status='expired') expired,count(*) filter(where status='cancelled') cancelled,
   count(*) filter(where score<=6) detractors,count(*) filter(where score between 7 and 8) neutrals,count(*) filter(where score>=9) promoters,
   round(avg(score)*10,1) average_100,
   round(100.0*(count(*) filter(where score>=9)-count(*) filter(where score<=6))/nullif(count(score),0),1) nps
  from base
 ), filtered as materialized (
  select * from base where (p_status='all' or status=p_status) and (p_class='all' or (p_class='detractor' and score<=6) or (p_class='neutral' and score between 7 and 8) or (p_class='promoter' and score>=9))
 ), page as (select * from filtered order by created_at desc,id desc limit 25 offset p_offset)
 select jsonb_build_object('summary',(select to_jsonb(summary) from summary),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb),'filtered_total',(select count(*) from filtered),'as_of',now()) into result;
 return result;
end; $$;
revoke all on function public.fn_cs_nps_dashboard(uuid,timestamptz,timestamptz,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.fn_cs_nps_dashboard(uuid,timestamptz,timestamptz,text,text,integer,uuid) to authenticated;

create or replace function public.fn_cs_performance(p_org uuid,p_from timestamptz,p_to timestamptz,p_owner uuid default null,p_silence integer default 30,p_focus text default 'silence',p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare role_name text; effective_owner uuid; result jsonb;
begin
 role_name:=public.fn_user_role_in_org(p_org);
 if auth.uid() is null or role_name is null then raise insufficient_privilege; end if;
 if p_from is null or p_to is null or p_from>=p_to or p_to-p_from>interval '732 days' or p_silence not in(7,14,30,60,90) or p_focus not in('silence','detractor') or p_offset<0 or p_offset>1000000 then raise check_violation; end if;
 if role_name not in ('manager','admin') and p_owner is not null and p_owner<>auth.uid() then raise insufficient_privilege; end if;
 effective_owner:=case when role_name in('manager','admin') then p_owner else auth.uid() end;
 with clients as materialized (
  select c.id,c.name,c.cs_owner_user_id,c.cs_phase,c.created_at,
   (select max(a.performed_at) from public.crm_lead_activities a where a.organization_id=p_org and a.contact_id=c.id and a.deleted_at is null and a.type in('customer_support','customer_meeting','customer_ebr','customer_qbr') and a.performed_at<=now()) last_contact,
   (select max(s.answered_at) from public.customer_nps_surveys s where s.organization_id=p_org and s.contact_id=c.id and s.score<=6 and not exists(select 1 from public.crm_lead_activities a where a.organization_id=p_org and a.contact_id=c.id and a.deleted_at is null and a.type in('customer_support','customer_meeting','customer_ebr','customer_qbr') and a.performed_at>=s.answered_at and a.performed_at<=now())) detractor_since
  from public.contacts c where c.organization_id=p_org and not c.is_anonymized and c.is_merged_into is null and (effective_owner is null or c.cs_owner_user_id=effective_owner)
 ), activity as materialized (
  select a.performed_by_user_id user_id,a.type,a.contact_id from public.crm_lead_activities a join public.contacts c on c.id=a.contact_id and c.organization_id=p_org
  where a.organization_id=p_org and a.deleted_at is null and not c.is_anonymized and c.is_merged_into is null and a.type in('customer_support','customer_meeting','customer_ebr','customer_qbr') and a.performed_at>=p_from and a.performed_at<p_to and a.performed_at<=now() and (effective_owner is null or a.performed_by_user_id=effective_owner)
 ), overdue as materialized (
  select t.assigned_to user_id from public.crm_tasks t join public.contacts c on c.id=t.contact_id and c.organization_id=p_org where t.organization_id=p_org and not c.is_anonymized and c.is_merged_into is null and t.status in('pending','in_progress') and t.due_date<now() and (effective_owner is null or t.assigned_to=effective_owner)
 ), owners as (select user_id from activity union select cs_owner_user_id from clients union select user_id from overdue), performance as (
  select o.user_id,
   (select count(*) from activity a where a.user_id is not distinct from o.user_id and type='customer_support') supports,
   (select count(*) from activity a where a.user_id is not distinct from o.user_id and type in('customer_meeting','customer_ebr','customer_qbr')) meetings,
   (select count(*) from activity a where a.user_id is not distinct from o.user_id and type='customer_ebr') ebr,
   (select count(*) from activity a where a.user_id is not distinct from o.user_id and type='customer_qbr') qbr,
   (select count(distinct contact_id) from activity a where a.user_id is not distinct from o.user_id) contacted_clients,
   (select count(*) from clients c where c.cs_owner_user_id is not distinct from o.user_id) portfolio,
   (select count(*) from overdue t where t.user_id is not distinct from o.user_id) overdue_tasks,
   (select count(*) from clients c where c.cs_owner_user_id is not distinct from o.user_id and coalesce(c.last_contact,c.created_at)<now()-make_interval(days=>p_silence)) silent_clients,
   (select count(*) from clients c where c.cs_owner_user_id is not distinct from o.user_id and c.detractor_since is not null) unattended_detractors
  from owners o
 ), attention as materialized (
  select * from clients where case when p_focus='silence' then coalesce(last_contact,created_at)<now()-make_interval(days=>p_silence) else detractor_since is not null end
 ), page as (select * from attention order by coalesce(detractor_since,last_contact,created_at),id limit 25 offset p_offset)
 select jsonb_build_object('performance',coalesce((select jsonb_agg(to_jsonb(performance) order by user_id) from performance),'[]'::jsonb),'attention',coalesce((select jsonb_agg(to_jsonb(page) order by coalesce(detractor_since,last_contact,created_at),id) from page),'[]'::jsonb),'attention_total',(select count(*) from attention),'as_of',now()) into result;
 return result;
end; $$;
revoke all on function public.fn_cs_performance(uuid,timestamptz,timestamptz,uuid,integer,text,integer) from public,anon,authenticated;
grant execute on function public.fn_cs_performance(uuid,timestamptz,timestamptz,uuid,integer,text,integer) to authenticated;
