-- 0263: correção de registros manuais de CS. Exclusão lógica preserva o registro.
alter table public.crm_lead_activities add column if not exists revision integer not null default 0;
alter table public.crm_lead_activities add column if not exists deleted_at timestamptz;
alter table public.crm_lead_activities add column if not exists edited_at timestamptz;
alter table public.crm_lead_activities add column if not exists edited_by_user_id uuid references auth.users(id);
revoke update on public.crm_lead_activities from authenticated;
grant update (payload, type, performed_at, revision, deleted_at, edited_at, edited_by_user_id) on public.crm_lead_activities to authenticated;
drop policy if exists contact_activity_visible on public.crm_lead_activities;
create policy contact_activity_visible on public.crm_lead_activities as restrictive for select to authenticated using (deleted_at is null);
drop policy if exists contact_activity_update on public.crm_lead_activities;
create policy contact_activity_update on public.crm_lead_activities for update to authenticated using (
  lead_id is null and source_module = 'crm' and actor_kind = 'user'
  and type in ('customer_support','customer_meeting','customer_ebr','customer_qbr')
  and deleted_at is null
  and public.fn_user_role_in_org(organization_id) in ('agent','manager','admin')
  and (performed_by_user_id = auth.uid() or public.fn_user_role_in_org(organization_id) in ('manager','admin'))
  and exists (select 1 from public.contacts c where c.id = contact_id and c.organization_id = crm_lead_activities.organization_id and not c.is_anonymized and c.is_merged_into is null)
) with check (
  lead_id is null and source_module = 'crm' and actor_kind = 'user'
  and type in ('customer_support','customer_meeting','customer_ebr','customer_qbr')
  and public.fn_user_role_in_org(organization_id) in ('agent','manager','admin')
  and (performed_by_user_id = auth.uid() or public.fn_user_role_in_org(organization_id) in ('manager','admin'))
  and edited_by_user_id = auth.uid()
  and exists (select 1 from public.contacts c where c.id = contact_id and c.organization_id = crm_lead_activities.organization_id and not c.is_anonymized and c.is_merged_into is null)
);
