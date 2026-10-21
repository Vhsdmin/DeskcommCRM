-- Linhas globais (organization_id NULL) continuam sob as policies anteriores
-- para vínculos legados/admin. Perfis restritos não ganham esse acesso implícito.
create or replace function public.fn_acesso_modulo(p_org uuid, p_resource text, p_write boolean default false) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (p_org is null and (public.fn_modulos_do_recurso(p_resource) && array['*pessoal'] or not exists (
    select 1 from public.user_organizations u
    where u.user_id=auth.uid() and u.revoked_at is null
      and u.role <> 'admin' and u.module_access is not null
  ))) or exists (
    select 1 from public.user_organizations u
    where u.user_id = auth.uid() and u.organization_id = p_org and u.revoked_at is null
      and (u.role = 'admin' or u.module_access is null
        or public.fn_modulos_do_recurso(p_resource) && array['*pessoal','*contexto']
        or u.module_access && case when p_write then
          case
            when p_resource in ('contacts','contact_phones','contact_identifiers','contact_addresses','contact_tags') then array['/app/contacts']
            when p_resource in ('conversations','messages','conversation_tags','conversation_notes','conversation_tag_links','demandas') then array['/app/inbox']
            when p_resource like 'skill_%' then array['/app/ai/skills','/app/ai/agents']
  when p_resource in ('ai_provider_credentials','ai_provider_credentials_safe') then array['/app/ai/credentials']
  when p_resource = 'ai_budgets' then array['/app/ai/usage']
  when p_resource in ('ai_agent_proposals','ai_agent_proposal_evaluations') then array['/app/ai/proposals','/app/ai/agents']
  when p_resource = 'automation_rules' then array['/app/kanban','/app/settings/tenant/pipelines']
  when p_resource = 'channel_sessions' then array['/app/connections']
            when p_resource in ('ai_agents','ai_agent_versions') then array['/app/ai/agents']
            when p_resource = 'message_templates' then array['/app/templates']
            when p_resource = 'agent_inbox_items' then array['/app/ai/inbox']
            when p_resource = 'crm_tasks' then array['/app/tasks']
            when p_resource = 'cs_carteira_faixas' then array['/app/carteira']
            when p_resource in ('crm_leads','crm_lead_links','crm_lead_activities') then array['/app/kanban','/app/contacts']
            when p_resource in ('crm_pipelines','crm_stages') then array['/app/settings/tenant/pipelines']
            else public.fn_modulos_do_recurso(p_resource) end
          else public.fn_modulos_do_recurso(p_resource) end)
  ) or public.fn_is_platform_admin();
$$;
revoke execute on function public.fn_acesso_modulo(uuid,text,boolean) from public, anon;
grant execute on function public.fn_acesso_modulo(uuid,text,boolean) to authenticated, service_role;

