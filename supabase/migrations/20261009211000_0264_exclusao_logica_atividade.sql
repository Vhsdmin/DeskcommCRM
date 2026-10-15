-- 0264: exclusão lógica restrita, preservando a política de visibilidade.
create or replace function public.fn_delete_customer_activity(p_id uuid, p_contact uuid, p_org uuid, p_revision integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
  if auth.uid() is null or public.fn_user_role_in_org(p_org) not in ('agent','manager','admin') then
    return false;
  end if;
  update public.crm_lead_activities a set deleted_at=now(), edited_at=now(), edited_by_user_id=auth.uid(), revision=a.revision+1
  where a.id=p_id and a.contact_id=p_contact and a.organization_id=p_org
    and a.revision=p_revision and a.deleted_at is null and a.lead_id is null
    and a.source_module='crm' and a.actor_kind='user'
    and a.type in ('customer_support','customer_meeting','customer_ebr','customer_qbr')
    and (a.performed_by_user_id=auth.uid() or public.fn_user_role_in_org(p_org) in ('manager','admin'))
    and exists(select 1 from public.contacts c where c.id=p_contact and c.organization_id=p_org and not c.is_anonymized and c.is_merged_into is null);
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.fn_delete_customer_activity(uuid,uuid,uuid,integer) from public, anon;
grant execute on function public.fn_delete_customer_activity(uuid,uuid,uuid,integer) to authenticated;
