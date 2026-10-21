-- Cadastro direto: NULL preserva os direitos legados por papel. [] só áreas pessoais.
alter table public.user_organizations add column if not exists module_access text[];

-- Recursos compartilhados são dependências de leitura da operação, não portas
-- de navegação. Recursos não classificados ficam fechados para perfis restritos.
create or replace function public.fn_modulos_do_recurso(p_resource text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
select case
  when p_resource in ('contacts','contact_phones','contact_identifiers','contact_addresses','contact_tags') then array['/app/contacts','/app/inbox','/app/kanban','/app/tasks','/app/agenda','/app/central','/app/carteira','/app/nps','/app/assistente']
  when p_resource in ('crm_tasks') then array['/app/tasks','/app/central','/app/playbooks','/app/contacts']
  when p_resource in ('cs_sinais','cs_sinais_dia') then array['/app/central','/app/carteira']
  when p_resource = 'cs_carteira_faixas' then array['/app/carteira','/app/contacts']
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

-- Restritiva: soma-se às policies existentes; nunca concede o que o RBAC/tenant nega.
-- Cobre também embeds PostgREST e subscriptions de Realtime.
do $$ declare t record; op text; begin
  for t in select c.table_name from information_schema.columns c
    join pg_class pc on pc.oid = to_regclass(format('public.%I',c.table_name))
    where c.table_schema='public' and c.column_name='organization_id'
      and c.udt_name='uuid' and pc.relkind='r' and pc.relrowsecurity
  loop
    execute format('drop policy if exists acesso_modulo_restritivo on public.%I', t.table_name);
    foreach op in array array['select','insert','update','delete'] loop
      execute format('drop policy if exists %I on public.%I', 'acesso_modulo_'||op, t.table_name);
      if op = 'select' then
        execute format('create policy acesso_modulo_select on public.%I as restrictive for select to authenticated using (public.fn_acesso_modulo(organization_id, %L, false))', t.table_name, t.table_name);
      elsif op = 'insert' then
        execute format('create policy acesso_modulo_insert on public.%I as restrictive for insert to authenticated with check (public.fn_acesso_modulo(organization_id, %L, true))', t.table_name, t.table_name);
      elsif op = 'update' then
        execute format('create policy acesso_modulo_update on public.%I as restrictive for update to authenticated using (public.fn_acesso_modulo(organization_id, %L, true)) with check (public.fn_acesso_modulo(organization_id, %L, true))', t.table_name, t.table_name, t.table_name);
      else
        execute format('create policy acesso_modulo_delete on public.%I as restrictive for delete to authenticated using (public.fn_acesso_modulo(organization_id, %L, true))', t.table_name, t.table_name);
      end if;
    end loop;
  end loop;
end $$;

-- Definers RPC ignoram RLS. Interceptar a chamada REST antes de entrar neles.
-- Conservador para multi-org: se um vínculo é restrito, o RPC precisa ser
-- permitido em TODOS os vínculos restritos (não inferir org a partir do body).
create or replace function public.fn_modulo_rpc_permitido(p_resource text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not exists (
    select 1 from public.user_organizations u where u.user_id=auth.uid()
    and u.revoked_at is null and u.role <> 'admin' and u.module_access is not null
    and not (public.fn_modulos_do_recurso(p_resource) && array['*contexto','*pessoal']
      or u.module_access && public.fn_modulos_do_recurso(p_resource))
  );
$$;
revoke execute on function public.fn_modulo_rpc_permitido(text) from public, anon;
grant execute on function public.fn_modulo_rpc_permitido(text) to authenticated, service_role;

create or replace function public.fn_pgrst_validar_acessos() returns void
language plpgsql set search_path = public, pg_temp as $$
declare caminho text := current_setting('request.path',true); recurso text;
begin
  perform public.fn_pgrst_recusar_replay_do_gateway();
  if current_user <> 'authenticated' then return; end if;
  recurso := regexp_replace(coalesce(caminho,''), '^.*/', '');
  -- O gate de recurso também fecha views/global tables sem organization_id.
  if not public.fn_modulo_rpc_permitido(recurso) then
    raise exception 'Acesso ao recurso não permitido.' using errcode='42501';
  end if;
end $$;
revoke execute on function public.fn_pgrst_validar_acessos() from public, anon;
grant execute on function public.fn_pgrst_validar_acessos() to anon, authenticated, service_role;
do $$ begin
  if to_regrole('authenticator') is not null then
    execute $c$alter role authenticator set pgrst.db_pre_request = 'public.fn_pgrst_validar_acessos'$c$;
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Emissão mantém suas validações originais e valida o módulo da entidade.
CREATE OR REPLACE FUNCTION public.emit_event(p_event_type text, p_entity_kind text, p_entity_id uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_metadata jsonb DEFAULT '{}'::jsonb, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_event_id uuid;
  v_contact uuid;
  v_origin jsonb;
begin
  -- message.received nasce somente do INSERT inbound interno. Um chamador
  -- público não pode reapresentar uma mensagem existente como evento novo.
  if auth.uid() is not null and p_event_type in ('message.received','appointment.outcome_confirmed') then
    raise exception 'reserved_message_received' using errcode='42501';
  end if;
  -- Estes campos autorizam efeitos operacionais; não são payload público.
  if auth.uid() is not null and (
    coalesce(p_payload,'{}'::jsonb) ?| array['service_origin','service_boundary']
    or coalesce(p_metadata,'{}'::jsonb) ?| array['service_origin','service_boundary']
  ) then raise exception 'reserved_service_origin' using errcode='42501'; end if;
  v_org_id := coalesce(p_organization_id, (public.fn_support_context()->>'organization_id')::uuid);
  if v_org_id is null then
    select organization_id into v_org_id
      from public.user_organizations
      where user_id = auth.uid() and revoked_at is null
      limit 1;
  end if;
  if v_org_id is null then
    raise exception 'emit_event: organization_id obrigatorio';
  end if;

  if auth.uid() is not null
     and not public.fn_role_at_least(v_org_id, 'viewer') then
    raise exception 'caller_not_authorized_for_org'
      using hint = 'emit_event: caller must be an active member of the organization';
  end if;

  if auth.uid() is not null and not public.fn_acesso_modulo(v_org_id,
    case when p_entity_kind = 'contact' and p_event_type like 'contact.%' then 'contacts'
      when p_entity_kind = 'crm_lead' and p_event_type like 'lead.%' then 'crm_leads'
      when p_entity_kind = 'conversation' and p_event_type like 'conversation.%' then 'conversations'
      when p_entity_kind = 'message' and p_event_type = 'message.sent' then 'messages'
      when p_entity_kind = 'appointment' and p_event_type like 'appointment.%' then 'calendar_appointments'
      else '__evento_nao_classificado' end, true) then
    raise exception 'Acesso ao módulo do evento não permitido.' using errcode='42501';
  end if;

  if not public.fn_support_write_allowed(v_org_id) then raise exception 'support_readonly' using errcode='42501'; end if;

  -- A ORIGEM E RESERVADA AO SERVIDOR — ENTAO O SERVIDOR TEM DE ESCREVE-LA.
  --
  -- O bloco acima recusa `service_origin` vindo de chamador autenticado (42501,
  -- e com razao: e o campo que AUTORIZA efeito operacional, nao payload
  -- publico). So que ninguem o escrevia no lugar dele. Efeito medido: quem move
  -- o negocio pela IA carimba a origem no servidor (`agent-stage-sync`,
  -- `appointment-stage-move`, `handoff-stage-move`) e o follow-up nasce; quem
  -- move PELO QUADRO — o operador, pela rota HTTP autenticada — emitia um
  -- evento SEM origem, `fn_service_event_origin` caia no `service_stale` final
  -- (40001), `serviceForEvent` engolia como `stale_origin` e o follow-up nunca
  -- nascia. Sem erro em lugar nenhum: o gatilho de etapa era inalcancavel pelo
  -- caminho que o produto oferece na tela.
  --
  -- O retrato e tirado AQUI, no instante da emissao, que e exatamente a
  -- semantica de procedencia que a 0223 quer: "quando este evento nasceu, o
  -- atendimento estava assim". A resolucao do contato repete a mesma regra de
  -- `fn_service_event_origin` — se ela nao souber resolver o tipo, nao ha o que
  -- carimbar e o evento segue sem origem, como antes.
  if not (coalesce(p_payload,'{}'::jsonb) ? 'service_origin')
     and not (coalesce(p_metadata,'{}'::jsonb) ? 'service_origin') then
    if p_event_type in ('lead.created','lead.stage_changed','lead.tag_added') and p_entity_kind='crm_lead' then
      select contact_id into v_contact from public.crm_leads where organization_id=v_org_id and id=p_entity_id;
    elsif p_event_type='contact.tag_added' and p_entity_kind='contact' then
      select id into v_contact from public.contacts where organization_id=v_org_id and id=p_entity_id;
    end if;
    if v_contact is not null
       and exists(select 1 from public.contacts
                   where organization_id=v_org_id and id=v_contact
                     and not is_anonymized and is_merged_into is null) then
      v_origin := jsonb_build_object('kind','command',
        'observed', public.fn_service_observe_command(v_org_id, v_contact));
    end if;
  end if;

  insert into public.event_log
    (organization_id, event_type, entity_kind, entity_id, payload, metadata)
  values
    (v_org_id, p_event_type, p_entity_kind, p_entity_id,
     coalesce(p_payload, '{}'::jsonb)
       || case when v_origin is null then '{}'::jsonb else jsonb_build_object('service_origin', v_origin) end,
     coalesce(p_metadata, '{}'::jsonb)
       || jsonb_build_object('emitted_at', extract(epoch from now())))
  returning id into v_event_id;

  return v_event_id;
end $function$;
revoke execute on function public.emit_event(text,text,uuid,jsonb,jsonb,uuid) from public, anon;
grant execute on function public.emit_event(text,text,uuid,jsonb,jsonb,uuid) to authenticated, service_role;
