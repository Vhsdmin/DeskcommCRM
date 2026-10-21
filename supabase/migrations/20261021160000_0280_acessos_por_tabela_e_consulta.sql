-- 0280: acessos por módulo — classificação numa tabela, RLS por consulta (não
-- por linha), eventos pela entidade e política para tabelas futuras.
--
-- Correções da revisão do PR #9:
--  1. As policies restritivas da 0276 chamavam `fn_acesso_modulo` (SECURITY
--     DEFINER, não inlinável) uma vez POR LINHA em toda tabela de tenant, para
--     todo usuário — inclusive admin e legado. Agora a policy compara
--     `organization_id` com `(select fn_orgs_com_acesso(...))`: um initplan,
--     calculado uma vez por consulta.
--  2. A classificação recurso → módulos era um CASE copiado inteiro em cada
--     migration (0276–0279), com o mapa de escrita à parte. Agora mora em
--     `acesso_modulo_recursos` (leitura e escrita por recurso, prioridade = a
--     ordem dos WHEN antigos, resultado idêntico). Mudar a classificação passa a
--     ser um INSERT … ON CONFLICT, não uma função nova.
--  3. `emit_event` classifica pela ENTIDADE + domínio do tipo (`fn_recurso_do_evento`):
--     antes, `user.profile_updated`, `user.mentioned`,
--     `crm.activity_write_failed` e eventos de LGPD caíam em
--     "não classificado" e eram recusados para usuários restritos.
--  4. `fn_aplicar_acesso_modulo()` (re)cria as policies em toda tabela de
--     tenant com RLS. Migration que criar tabela nova chama esta função; o
--     invariante `tests/invariants/equipe-acessos.test.ts` reprova tabela de
--     tenant sem a policy (o Realtime não passa pelo `db_pre_request`).
--  5. LGPD (`lgpd_requests`) passa a ser classificada para `/app/lgpd/requests`.

create table if not exists public.acesso_modulo_recursos (
  recurso text primary key,
  padrao boolean not null default false,
  prioridade integer not null,
  leitura text[] not null,
  escrita text[]
);
comment on table public.acesso_modulo_recursos is
  'Recurso (tabela, view ou RPC) → destinos de navegação que o liberam. padrao = LIKE. Menor prioridade vence. escrita nula = igual à leitura. *pessoal e *contexto valem para todos.';
alter table public.acesso_modulo_recursos enable row level security;
revoke all on public.acesso_modulo_recursos from anon, authenticated;
grant all on public.acesso_modulo_recursos to service_role;

insert into public.acesso_modulo_recursos (recurso, padrao, prioridade, leitura, escrita) values
  ('contacts', false, 1, array['/app/contacts','/app/inbox','/app/kanban','/app/agenda','/app/central','/app/carteira','/app/nps','/app/assistente'], array['/app/contacts']),
  ('contact_phones', false, 1, array['/app/contacts','/app/inbox','/app/kanban','/app/agenda','/app/central','/app/carteira','/app/nps','/app/assistente'], array['/app/contacts']),
  ('contact_identifiers', false, 1, array['/app/contacts','/app/inbox','/app/kanban','/app/agenda','/app/central','/app/carteira','/app/nps','/app/assistente'], array['/app/contacts']),
  ('contact_addresses', false, 1, array['/app/contacts','/app/inbox','/app/kanban','/app/agenda','/app/central','/app/carteira','/app/nps','/app/assistente'], array['/app/contacts']),
  ('contact_tags', false, 1, array['/app/contacts','/app/inbox','/app/kanban','/app/agenda','/app/central','/app/carteira','/app/nps','/app/assistente'], array['/app/contacts']),
  ('crm_tasks', false, 2, array['/app/tasks','/app/central','/app/playbooks','/app/contacts'], array['/app/tasks']),
  ('cs_sinais', false, 3, array['/app/central','/app/carteira'], null),
  ('cs_sinais_dia', false, 3, array['/app/central','/app/carteira'], null),
  ('cs_carteira_faixas', false, 4, array['/app/carteira','/app/contacts'], array['/app/carteira']),
  ('skill_%', true, 5, array['/app/ai/skills','/app/ai/agents'], array['/app/ai/skills','/app/ai/agents']),
  ('ai_provider_credentials', false, 6, array['/app/ai/credentials'], array['/app/ai/credentials']),
  ('ai_provider_credentials_safe', false, 6, array['/app/ai/credentials'], array['/app/ai/credentials']),
  ('ai_budgets', false, 7, array['/app/ai/usage'], array['/app/ai/usage']),
  ('ai_agent_proposals', false, 8, array['/app/ai/proposals','/app/ai/agents'], array['/app/ai/proposals','/app/ai/agents']),
  ('ai_agent_proposal_evaluations', false, 8, array['/app/ai/proposals','/app/ai/agents'], array['/app/ai/proposals','/app/ai/agents']),
  ('automation_rules', false, 9, array['/app/kanban','/app/settings/tenant/pipelines'], array['/app/kanban','/app/settings/tenant/pipelines']),
  ('channel_sessions', false, 10, array['/app/inbox','/app/connections'], array['/app/connections']),
  ('contact_field_proposals', false, 11, array['/app/contacts'], null),
  ('orders', false, 11, array['/app/contacts'], null),
  ('webhook_sources', false, 12, array['/app/webhooks'], null),
  ('webhook_endpoints', false, 12, array['/app/webhooks'], null),
  ('gestao_connections', false, 12, array['/app/webhooks'], null),
  ('gestao_webhook_events', false, 12, array['/app/webhooks'], null),
  ('cs_playbooks', false, 13, array['/app/playbooks'], null),
  ('crm_pipelines', false, 14, array['/app/kanban','/app/settings/tenant/pipelines','/app/contacts','/app/inbox'], array['/app/settings/tenant/pipelines']),
  ('crm_stages', false, 14, array['/app/kanban','/app/settings/tenant/pipelines','/app/contacts','/app/inbox'], array['/app/settings/tenant/pipelines']),
  ('crm_leads', false, 15, array['/app/kanban','/app/contacts','/app/inbox','/app/activities'], array['/app/kanban','/app/contacts']),
  ('crm_lead_links', false, 15, array['/app/kanban','/app/contacts','/app/inbox','/app/activities'], array['/app/kanban','/app/contacts']),
  ('crm_lead_activities', false, 15, array['/app/kanban','/app/contacts','/app/inbox','/app/activities'], array['/app/kanban','/app/contacts']),
  ('crm_lead_scores', false, 15, array['/app/kanban','/app/contacts','/app/inbox','/app/activities'], null),
  ('lead_state', false, 15, array['/app/kanban','/app/contacts','/app/inbox','/app/activities'], null),
  ('lead_notes', false, 15, array['/app/kanban','/app/contacts','/app/inbox','/app/activities'], null),
  ('crm_lead_reactivations', false, 15, array['/app/kanban','/app/contacts','/app/inbox','/app/activities'], null),
  ('conversations', false, 16, array['/app/inbox','/app/radar','/app/contacts','/app/agenda','/app/kanban'], array['/app/inbox']),
  ('messages', false, 16, array['/app/inbox','/app/radar','/app/contacts','/app/agenda','/app/kanban'], array['/app/inbox']),
  ('conversation_tags', false, 16, array['/app/inbox','/app/radar','/app/contacts','/app/agenda','/app/kanban'], array['/app/inbox']),
  ('conversation_notes', false, 16, array['/app/inbox','/app/radar','/app/contacts','/app/agenda','/app/kanban'], array['/app/inbox']),
  ('conversation_tag_links', false, 16, array['/app/inbox','/app/radar','/app/contacts','/app/agenda','/app/kanban'], array['/app/inbox']),
  ('demandas', false, 16, array['/app/inbox','/app/radar','/app/contacts','/app/agenda','/app/kanban'], array['/app/inbox']),
  ('calendar_%', true, 17, array['/app/agenda','/app/settings/tenant/agenda','/app/team'], null),
  ('appointment%', true, 17, array['/app/agenda','/app/settings/tenant/agenda','/app/team'], null),
  ('attendant_availability', false, 17, array['/app/agenda','/app/settings/tenant/agenda','/app/team'], null),
  ('%nps%', true, 18, array['/app/nps','/app/contacts'], null),
  ('message_templates', false, 19, array['/app/templates','/app/inbox'], array['/app/templates']),
  ('catalog_products', false, 20, array['/app/products'], null),
  ('nuvemshop_products', false, 20, array['/app/products'], null),
  ('ai_knowledge%', true, 21, array['/app/ai/knowledge/sources','/app/ai/agents'], null),
  ('ai_chunks', false, 21, array['/app/ai/knowledge/sources','/app/ai/agents'], null),
  ('ai_faq_items', false, 21, array['/app/ai/knowledge/sources','/app/ai/agents'], null),
  ('ai_agents', false, 22, array['/app/ai/agents','/app/assistente','/app/kanban','/app/inbox'], array['/app/ai/agents']),
  ('ai_agent_versions', false, 22, array['/app/ai/agents','/app/assistente','/app/kanban','/app/inbox'], array['/app/ai/agents']),
  ('ai_agent_runs', false, 23, array['/app/ai/runs','/app/ai/usage'], null),
  ('ai_invocations', false, 23, array['/app/ai/runs','/app/ai/usage'], null),
  ('llm_calls', false, 23, array['/app/ai/runs','/app/ai/usage'], null),
  ('followup_%', true, 24, array['/app/ai/followups'], null),
  ('agent_case%', true, 25, array['/app/ai/cases'], null),
  ('agent_inbox_items', false, 26, array['/app/ai/inbox','/app/kanban'], array['/app/ai/inbox']),
  ('org_memory%', true, 27, array['/app/ai/memory'], null),
  ('flywheel_%', true, 28, array['/app/ai/proposals','/app/ai/evolution'], null),
  ('api_audit_log', false, 29, array['/app/audit'], null),
  ('notification%', true, 30, array['*pessoal'], null),
  ('push_subscriptions', false, 30, array['*pessoal'], null),
  ('organizations', false, 31, array['*contexto'], null),
  ('user_organizations', false, 31, array['*contexto'], null),
  ('platform_admins', false, 31, array['*contexto'], null),
  ('platform_branding', false, 31, array['*contexto'], null),
  ('ai_models', false, 31, array['*contexto'], null),
  ('ai_pricing', false, 31, array['*contexto'], null),
  ('user_recovery_codes', false, 31, array['*contexto'], null),
  ('emit_event', false, 31, array['*contexto'], null),
  ('fn_cs_nps_dashboard', false, 32, array['/app/nps'], null),
  ('fn_cs_performance', false, 33, array['/app/metrics'], null),
  ('fn_atrito_metrics', false, 33, array['/app/metrics'], null),
  ('fn_attendant_metrics', false, 33, array['/app/metrics'], null),
  ('fn_activity_report', false, 34, array['/app/activities'], null),
  ('fn_cs_assumir_cliente', false, 35, array['/app/carteira','/app/central'], null),
  ('fn_update_contact_cs', false, 36, array['/app/contacts'], null),
  ('fn_manage_customer_nps', false, 36, array['/app/contacts'], null),
  ('fn_delete_customer_activity', false, 36, array['/app/contacts'], null),
  ('fn_mesclar_contatos', false, 36, array['/app/contacts'], null),
  ('decrypt_cpf', false, 36, array['/app/contacts'], null),
  ('fn_conversation_assign', false, 37, array['/app/inbox'], null),
  ('fn_reply_action', false, 37, array['/app/inbox'], null),
  ('fn_appointment_change', false, 38, array['/app/agenda'], null),
  ('fn_agenda_settings', false, 38, array['/app/agenda'], null),
  ('fn_mover_leads_em_lote', false, 39, array['/app/kanban'], null),
  ('fn_user_org_ids', false, 40, array['*contexto'], null),
  ('fn_user_role_in_org', false, 40, array['*contexto'], null),
  ('fn_user_role_in', false, 40, array['*contexto'], null),
  ('fn_role_at_least', false, 40, array['*contexto'], null),
  ('fn_is_platform_admin', false, 40, array['*contexto'], null),
  ('fn_support_context', false, 40, array['*contexto'], null),
  ('lgpd_requests', false, 41, array['/app/lgpd/requests'], null)
on conflict (recurso) do update
  set padrao = excluded.padrao, prioridade = excluded.prioridade,
      leitura = excluded.leitura, escrita = excluded.escrita;

create or replace function public.fn_modulos_do_recurso(p_resource text) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select r.leitura from public.acesso_modulo_recursos r
     where r.recurso = p_resource or (r.padrao and p_resource like r.recurso)
     order by r.prioridade limit 1), array[]::text[]);
$$;
revoke execute on function public.fn_modulos_do_recurso(text) from public, anon;
grant execute on function public.fn_modulos_do_recurso(text) to authenticated, service_role;

create or replace function public.fn_modulos_de_escrita(p_resource text) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select coalesce(r.escrita, r.leitura) from public.acesso_modulo_recursos r
     where r.recurso = p_resource or (r.padrao and p_resource like r.recurso)
     order by r.prioridade limit 1), array[]::text[]);
$$;
revoke execute on function public.fn_modulos_de_escrita(text) from public, anon;
grant execute on function public.fn_modulos_de_escrita(text) to authenticated, service_role;

-- Mesma regra da 0279, lendo a tabela.
create or replace function public.fn_acesso_modulo(p_org uuid, p_resource text, p_write boolean default false) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (p_org is null and (public.fn_modulos_do_recurso(p_resource) && array['*pessoal'] or not exists (
    select 1 from public.user_organizations u
    where u.user_id = auth.uid() and u.revoked_at is null
      and u.role <> 'admin' and u.module_access is not null
  ))) or exists (
    select 1 from public.user_organizations u
    where u.user_id = auth.uid() and u.organization_id = p_org and u.revoked_at is null
      and (u.role = 'admin' or u.module_access is null
        or public.fn_modulos_do_recurso(p_resource) && array['*pessoal','*contexto']
        or u.module_access && case when p_write then public.fn_modulos_de_escrita(p_resource)
                                   else public.fn_modulos_do_recurso(p_resource) end)
  ) or public.fn_is_platform_admin();
$$;
revoke execute on function public.fn_acesso_modulo(uuid,text,boolean) from public, anon;
grant execute on function public.fn_acesso_modulo(uuid,text,boolean) to authenticated, service_role;

-- As organizações em que a pessoa pode ler/escrever o recurso. Usada pelas
-- policies dentro de `(select …)`: o Postgres calcula uma vez por consulta.
create or replace function public.fn_orgs_com_acesso(p_resource text, p_write boolean default false) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(u.organization_id), array[]::uuid[])
    from public.user_organizations u
   where u.user_id = auth.uid() and u.revoked_at is null
     and (u.role = 'admin' or u.module_access is null
       or public.fn_modulos_do_recurso(p_resource) && array['*pessoal','*contexto']
       or u.module_access && case when p_write then public.fn_modulos_de_escrita(p_resource)
                                  else public.fn_modulos_do_recurso(p_resource) end);
$$;
revoke execute on function public.fn_orgs_com_acesso(text,boolean) from public, anon;
grant execute on function public.fn_orgs_com_acesso(text,boolean) to authenticated, service_role;

-- (Re)cria as policies restritivas em toda tabela de tenant com RLS. Idempotente.
-- Migration que criar tabela de tenant chama `select public.fn_aplicar_acesso_modulo();`.
create or replace function public.fn_aplicar_acesso_modulo() returns integer
language plpgsql set search_path = public, pg_temp as $$
declare t record; n integer := 0; leitura text; escrita text;
begin
  for t in select c.table_name from information_schema.columns c
    join pg_class pc on pc.oid = to_regclass(format('public.%I', c.table_name))
    where c.table_schema = 'public' and c.column_name = 'organization_id'
      and c.udt_name = 'uuid' and pc.relkind = 'r' and pc.relrowsecurity
  loop
    leitura := format('(select public.fn_is_platform_admin()) or organization_id = any (coalesce((select public.fn_orgs_com_acesso(%L, false)), array[]::uuid[])) or (organization_id is null and (select public.fn_acesso_modulo(null::uuid, %L, false)))', t.table_name, t.table_name);
    escrita := format('(select public.fn_is_platform_admin()) or organization_id = any (coalesce((select public.fn_orgs_com_acesso(%L, true)), array[]::uuid[])) or (organization_id is null and (select public.fn_acesso_modulo(null::uuid, %L, true)))', t.table_name, t.table_name);
    execute format('drop policy if exists acesso_modulo_restritivo on public.%I', t.table_name);
    execute format('drop policy if exists acesso_modulo_select on public.%I', t.table_name);
    execute format('drop policy if exists acesso_modulo_insert on public.%I', t.table_name);
    execute format('drop policy if exists acesso_modulo_update on public.%I', t.table_name);
    execute format('drop policy if exists acesso_modulo_delete on public.%I', t.table_name);
    execute format('create policy acesso_modulo_select on public.%I as restrictive for select to authenticated using (%s)', t.table_name, leitura);
    execute format('create policy acesso_modulo_insert on public.%I as restrictive for insert to authenticated with check (%s)', t.table_name, escrita);
    execute format('create policy acesso_modulo_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)', t.table_name, escrita, escrita);
    execute format('create policy acesso_modulo_delete on public.%I as restrictive for delete to authenticated using (%s)', t.table_name, escrita);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.fn_aplicar_acesso_modulo() from public, anon, authenticated;
select public.fn_aplicar_acesso_modulo();

-- Recurso do evento pela ENTIDADE, exigindo que o tipo do evento seja do mesmo
-- domínio: `lead.created` com entidade `contact` continua recusado (entidade
-- disfarçada). Evento sobre a própria pessoa = área pessoal.
create or replace function public.fn_recurso_do_evento(p_event_type text, p_entity_kind text, p_entity_id uuid) returns text
language sql stable set search_path = public, pg_temp as $$
  select case
    when p_entity_kind = 'contact' and p_event_type like 'contact.%' then 'contacts'
    when p_entity_kind = 'crm_lead' and (p_event_type like 'lead.%' or p_event_type like 'crm.%') then 'crm_leads'
    when p_entity_kind = 'conversation' and (p_event_type like 'conversation.%' or p_event_type like 'ai.handoff_%') then 'conversations'
    when p_entity_kind = 'conversation_note' and p_event_type = 'user.mentioned' then 'conversations'
    when p_entity_kind = 'message' and p_event_type = 'message.sent' then 'messages'
    when p_entity_kind = 'appointment' and p_event_type like 'appointment.%' then 'calendar_appointments'
    when p_entity_kind = 'lgpd_request' and p_event_type like 'lgpd.%' then 'lgpd_requests'
    when p_entity_kind = 'organization' and p_event_type like 'org.%' then 'organizations'
    when p_entity_kind = 'user' and p_event_type like 'user.%' and p_entity_id = auth.uid() then 'notifications'
    else '__evento_nao_classificado' end;
$$;
revoke execute on function public.fn_recurso_do_evento(text,text,uuid) from public, anon;
grant execute on function public.fn_recurso_do_evento(text,text,uuid) to authenticated, service_role;

-- emit_event: mesmo corpo da 0276, com o módulo vindo da entidade.
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

  -- O módulo vem da entidade + domínio do tipo (fn_recurso_do_evento, 0280):
  -- `crm.activity_write_failed` é do funil, `user.mentioned` é do Inbox e
  -- evento sobre a própria pessoa é área pessoal.
  if auth.uid() is not null and not public.fn_acesso_modulo(v_org_id,
    public.fn_recurso_do_evento(p_event_type, p_entity_kind, p_entity_id), true) then
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

notify pgrst, 'reload schema';
