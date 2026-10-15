-- 0261: histórico de relacionamento do contato sem negócio comercial.
-- Não amplia a visibilidade de atividades vinculadas a leads.
alter table public.crm_lead_activities alter column lead_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'activity_contact_or_lead' and conrelid = 'public.crm_lead_activities'::regclass) then
    alter table public.crm_lead_activities add constraint activity_contact_or_lead check (lead_id is not null or contact_id is not null);
  end if;
end $$;
drop policy if exists contact_activity_select on public.crm_lead_activities;
create policy contact_activity_select on public.crm_lead_activities for select to authenticated using (
  lead_id is null and exists (
    select 1 from public.contacts c where c.id = contact_id and c.organization_id = crm_lead_activities.organization_id
  )
);
-- Restritiva: policies permissivas existentes não podem contornar esta regra.
drop policy if exists contact_activity_insert_guard on public.crm_lead_activities;
create policy contact_activity_insert_guard on public.crm_lead_activities as restrictive for insert to authenticated with check (
  lead_id is not null or (
    public.fn_user_role_in_org(organization_id) in ('agent','manager','admin')
    and performed_by_user_id = auth.uid() and actor_kind = 'user'
    and exists (select 1 from public.contacts c where c.id = contact_id and c.organization_id = crm_lead_activities.organization_id and not c.is_anonymized and c.is_merged_into is null)
  )
);
create index if not exists contact_activities_performed_idx on public.crm_lead_activities (organization_id, contact_id, performed_at desc) where lead_id is null;
