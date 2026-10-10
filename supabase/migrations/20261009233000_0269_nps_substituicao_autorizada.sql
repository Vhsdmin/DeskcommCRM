-- 0269: substituição de convite pendente respeita o mesmo autor/gestor do cancelamento.
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
  if role_name='agent' and exists(select 1 from public.customer_nps_surveys where organization_id=p_org and contact_id=p_contact and score is null and cancelled_at is null and expires_at>now() and created_by_user_id is distinct from auth.uid()) then raise insufficient_privilege; end if;
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
