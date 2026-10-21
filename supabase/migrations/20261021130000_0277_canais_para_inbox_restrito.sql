-- Dependência de leitura do seletor de canais no Inbox. Escrita continua em Conexões.
create or replace function public.fn_modulos_do_recurso(p_resource text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
select case
  when p_resource in ('contacts','contact_phones','contact_identifiers','contact_addresses','contact_tags') then array['/app/contacts','/app/inbox','/app/kanban','/app/tasks','/app/agenda','/app/central','/app/carteira','/app/nps','/app/assistente']
  when p_resource in ('crm_tasks') then array['/app/tasks','/app/central','/app/playbooks','/app/contacts']
  when p_resource in ('cs_sinais','cs_sinais_dia') then array['/app/central','/app/carteira']
  when p_resource = 'cs_carteira_faixas' then array['/app/carteira','/app/contacts']
  when p_resource = 'channel_sessions' then array['/app/inbox','/app/connections']
  when p_resource in ('contact_field_proposals','orders') then array['/app/contacts']
  when p_resource in ('webhook_sources','webhook_endpoints','gestao_connections','gestao_webhook_events') then array['/app/webhooks']
  when p_resource = 'cs_playbooks' then array['/app/playbooks']
  when p_resource in ('crm_pipelines','crm_stages') then array['/app/kanban','/app/settings/tenant/pipelines','/app/contacts','/app/inbox']
  when p_resource in ('crm_leads','crm_lead_links','crm_lead_activities','crm_lead_scores','lead_state','lead_notes','crm_lead_reactivations') then array['/app/kanban','/app/contacts','/app/inbox','/app/activities']
  when p_resource in ('conversations','messages','conversation_tags','conversation_notes','conversation_tag_links','demandas') then array['/app/inbox','/app/radar','/app/contacts','/app/agenda','/app/kanban']
  when p_resource like 'calendar_%' or p_resource like 'appointment%' or p_resource = 'attendant_availability' then array['/app/agenda','/app/settings/tenant/agenda','/app/team']
  when p_resource like '%nps%' then array['/app/nps','/app/contacts']
  when p_resource = 'message_templates' then array['/app/templates','/app/inbox']
  when p_resource in ('catalog_products','nuvemshop_products') then array['/app/products']
  when p_resource like 'ai_knowledge%' or p_resource in ('ai_chunks','ai_faq_items') then array['/app/ai/knowledge/sources','/app/ai/agents']
  when p_resource in ('ai_agents','ai_agent_versions') then array['/app/ai/agents','/app/assistente','/app/kanban','/app/inbox']
  when p_resource in ('ai_agent_runs','ai_invocations','llm_calls') then array['/app/ai/runs','/app/ai/usage']
  when p_resource like 'followup_%' then array['/app/ai/followups']
  when p_resource like 'agent_case%' then array['/app/ai/cases']
  when p_resource = 'agent_inbox_items' then array['/app/ai/inbox','/app/kanban']
  when p_resource like 'org_memory%' then array['/app/ai/memory']
  when p_resource like 'flywheel_%' then array['/app/ai/proposals','/app/ai/evolution']
  when p_resource = 'api_audit_log' then array['/app/audit']
  when p_resource like 'notification%' or p_resource = 'push_subscriptions' then array['*pessoal']
  when p_resource in ('organizations','user_organizations','platform_admins','platform_branding','ai_models','ai_pricing','user_recovery_codes','emit_event') then array['*contexto']
  -- RPCs permitidas mantêm suas validações de papel e organização originais.
  when p_resource in ('fn_cs_nps_dashboard') then array['/app/nps']
  when p_resource in ('fn_cs_performance') then array['/app/metrics']
  when p_resource in ('fn_cs_assumir_cliente') then array['/app/carteira','/app/central']
  when p_resource in ('fn_update_contact_cs','fn_manage_customer_nps','fn_delete_customer_activity','fn_mesclar_contatos','decrypt_cpf') then array['/app/contacts']
  when p_resource in ('fn_conversation_assign','fn_reply_action') then array['/app/inbox']
  when p_resource in ('fn_appointment_change','fn_agenda_settings') then array['/app/agenda']
  when p_resource in ('fn_mover_leads_em_lote') then array['/app/kanban']
  when p_resource in ('fn_user_org_ids','fn_user_role_in_org','fn_user_role_in','fn_role_at_least','fn_is_platform_admin','fn_support_context') then array['*contexto']
  else array[]::text[] end;
$$;
revoke execute on function public.fn_modulos_do_recurso(text) from public, anon;
grant execute on function public.fn_modulos_do_recurso(text) to authenticated, service_role;

create or replace function public.fn_acesso_modulo(p_org uuid, p_resource text, p_write boolean default false) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.user_organizations u
    where u.user_id = auth.uid() and u.organization_id = p_org and u.revoked_at is null
      and (u.role = 'admin' or u.module_access is null
        or public.fn_modulos_do_recurso(p_resource) && array['*pessoal','*contexto']
        or u.module_access && case when p_write then
          case
            when p_resource in ('contacts','contact_phones','contact_identifiers','contact_addresses','contact_tags') then array['/app/contacts']
            when p_resource in ('conversations','messages','conversation_tags','conversation_notes','conversation_tag_links','demandas') then array['/app/inbox']
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

notify pgrst, 'reload schema';
