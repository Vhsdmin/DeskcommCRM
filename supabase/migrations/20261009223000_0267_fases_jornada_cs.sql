-- 0267: fases da jornada definidas pela equipe VendePay.
alter table public.contacts drop constraint if exists contacts_cs_phase_check;
alter table public.contacts add constraint contacts_cs_phase_check check(cs_phase is null or cs_phase in ('entrada','onboarding','ativacao','adocao','expansao','renovacao'));
create or replace function public.fn_update_contact_cs(p_org uuid,p_contact uuid,p_phase text,p_owner uuid,p_revision integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c public.contacts%rowtype; next_revision integer; actor_role text;
begin
  actor_role := public.fn_user_role_in_org(p_org);
  if auth.uid() is null or coalesce(actor_role,'') not in ('agent','manager','admin') then raise insufficient_privilege; end if;
  if p_revision is null or p_revision<0 or (p_phase is not null and p_phase not in ('entrada','onboarding','ativacao','adocao','expansao','renovacao')) then raise check_violation; end if;
  select * into c from public.contacts where id=p_contact and organization_id=p_org and not is_anonymized and is_merged_into is null for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if c.cs_revision<>p_revision then return jsonb_build_object('status','conflict'); end if;
  if p_owner is distinct from c.cs_owner_user_id and p_owner is not null and not exists(select 1 from public.user_organizations where organization_id=p_org and user_id=p_owner and revoked_at is null and accepted_at is not null and role in ('agent','manager','admin')) then return jsonb_build_object('status','invalid_owner'); end if;
  if p_owner is distinct from c.cs_owner_user_id and actor_role='agent' and p_owner is distinct from auth.uid() then raise insufficient_privilege; end if;
  if p_phase is not distinct from c.cs_phase and p_owner is not distinct from c.cs_owner_user_id then return jsonb_build_object('status','saved','revision',c.cs_revision); end if;
  update public.contacts set cs_phase=p_phase,cs_owner_user_id=p_owner,cs_revision=cs_revision+1 where id=p_contact and organization_id=p_org returning cs_revision into next_revision;
  insert into public.crm_lead_activities(organization_id,contact_id,lead_id,source_module,type,performed_by_user_id,actor_kind,reason,payload)
    values(p_org,p_contact,null,'crm','customer_journey_updated',auth.uid(),'user','Jornada de atendimento atualizada',jsonb_build_object('previous_phase',c.cs_phase,'phase',p_phase,'previous_owner_user_id',c.cs_owner_user_id,'owner_user_id',p_owner));
  return jsonb_build_object('status','saved','revision',next_revision);
end;
$$;
revoke all on function public.fn_update_contact_cs(uuid,uuid,text,uuid,integer) from public,anon;
grant execute on function public.fn_update_contact_cs(uuid,uuid,text,uuid,integer) to authenticated;
