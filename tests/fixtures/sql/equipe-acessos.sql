-- Executado dentro de transação descartável pelo teste e pela prova em DEV.
insert into auth.users (id,email) values
 ('c7600000-0000-4000-8000-000000000001','modulos-restrito@invariant.test'),
 ('c7600000-0000-4000-8000-000000000002','modulos-legado@invariant.test'),
 ('c7600000-0000-4000-8000-000000000003','modulos-admin@invariant.test');
insert into public.organizations (id,slug,legal_name,display_name) values
 ('c7600000-0000-4000-8000-00000000000a','modulos-inv-a','Modulos A','Modulos A'),
 ('c7600000-0000-4000-8000-00000000000b','modulos-inv-b','Modulos B','Modulos B');
insert into public.user_organizations (user_id,organization_id,role,module_access,accepted_at) values
 ('c7600000-0000-4000-8000-000000000001','c7600000-0000-4000-8000-00000000000a','agent',array['/app/tasks'],now()),
 ('c7600000-0000-4000-8000-000000000002','c7600000-0000-4000-8000-00000000000a','agent',null,now()),
 ('c7600000-0000-4000-8000-000000000003','c7600000-0000-4000-8000-00000000000a','admin',array[]::text[],now());
insert into public.contacts (id,organization_id,name) values
 ('c7600000-0000-4000-8000-0000000000ca','c7600000-0000-4000-8000-00000000000a','Contato A'),
 ('c7600000-0000-4000-8000-0000000000cb','c7600000-0000-4000-8000-00000000000b','Contato B');
insert into public.crm_tasks (organization_id,title) values
 ('c7600000-0000-4000-8000-00000000000a','Tarefa A'),
 ('c7600000-0000-4000-8000-00000000000b','Tarefa B');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c7600000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare n int; begin
 if (select count(*) from public.crm_tasks) <> 1 then raise exception 'Tarefas vazaram de tenant ou acesso permitido falhou'; end if;
 if exists(select 1 from public.contacts) then raise exception 'Tarefas concedeu leitura geral de Clientes'; end if;
 update public.contacts set name='NÃO PODE'; get diagnostics n=row_count;
 if n <> 0 then raise exception 'Tarefas concedeu escrita em Clientes'; end if;
 update public.crm_tasks set title='Tarefa alterada'; get diagnostics n=row_count;
 if n <> 1 then raise exception 'Escrita de tarefa autorizada falhou'; end if;
 update public.user_organizations set module_access=null where user_id=auth.uid(); get diagnostics n=row_count;
 if n <> 0 then raise exception 'Membro removeu sua própria restrição'; end if;
 if public.fn_acesso_modulo('c7600000-0000-4000-8000-00000000000b','crm_tasks',true) then raise exception 'Helper concedeu outro tenant'; end if;
 begin
  insert into public.contacts(organization_id,name) values ('c7600000-0000-4000-8000-00000000000a','Proibido');
  raise exception 'INSERT indevido permitido';
 exception when insufficient_privilege then null; end;
 perform set_config('request.path','/rpc/fn_cs_nps_dashboard',true);
 begin
  perform public.fn_pgrst_validar_acessos(); raise exception 'RPC de NPS passou sem permissão';
 exception when insufficient_privilege then null; end;
 perform set_config('request.path','/recurso_futuro',true);
 begin
  perform public.fn_pgrst_validar_acessos(); raise exception 'Recurso desconhecido passou';
 exception when insufficient_privilege then null; end;
 perform set_config('request.path','/rpc/emit_event',true);
 perform public.fn_pgrst_validar_acessos();
 begin
  perform public.emit_event('contact.updated','contact','c7600000-0000-4000-8000-0000000000ca','{}','{}','c7600000-0000-4000-8000-00000000000a');
  raise exception 'Emissão contornou módulo de escrita';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- A alteração de acesso já vale na próxima consulta, sem trocar JWT.
update public.user_organizations set module_access=array['/app/contacts'] where user_id='c7600000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare n int; begin
 update public.contacts set name='Contato autorizado'; get diagnostics n=row_count;
 if n <> 1 then raise exception 'Permissão atualizada não entrou em vigor'; end if;
 update public.crm_tasks set title='Proibido'; get diagnostics n=row_count;
 if n <> 0 then raise exception 'Escrita em Tarefas persistiu após retirada do acesso'; end if;
 perform public.emit_event('contact.updated','contact','c7600000-0000-4000-8000-0000000000ca','{}','{}','c7600000-0000-4000-8000-00000000000a');
 begin
  perform public.emit_event('lead.created','contact','c7600000-0000-4000-8000-0000000000ca','{}','{}','c7600000-0000-4000-8000-00000000000a');
  raise exception 'Evento com entidade disfarçada passou';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.user_organizations set module_access=array[]::text[] where user_id='c7600000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 if exists(select 1 from public.contacts) or exists(select 1 from public.crm_tasks) then raise exception 'Sem módulos ainda lê dados'; end if;
 if not public.fn_acesso_modulo(null,'notification_preferences',false) then raise exception 'Preferência pessoal global bloqueada'; end if;
 if public.fn_acesso_modulo(null,'__global',false) then raise exception 'Restrito recebeu registros globais implicitamente'; end if;
 if not public.fn_modulo_rpc_permitido('user_organizations') then raise exception 'Contexto pessoal bloqueado'; end if;
end $$;
-- NULL legado continua respeitando o papel e isolamento anteriores.
select set_config('request.jwt.claims','{"sub":"c7600000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
 if (select count(*) from public.contacts) <> 1 then raise exception 'Acesso legado mudou'; end if;
 if not public.fn_acesso_modulo(null,'__global',false) then raise exception 'Registro global legado perdeu acesso'; end if;
 if not public.fn_modulo_rpc_permitido('recurso_legado') then raise exception 'RPC legado mudou'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"c7600000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ begin
 if (select count(*) from public.contacts) <> 1 then raise exception 'Administrador perdeu acesso'; end if;
end $$;
reset role;
-- Toda tabela tenant servida pela sessão (com policy permissiva) ganhou a camada
-- restritiva; tabela só do servidor (RLS sem policy nenhuma) continua SEM policy.
do $$ begin
 if exists (
   select 1 from information_schema.columns c join pg_class t on t.oid=to_regclass(format('public.%I',c.table_name))
   where c.table_schema='public' and c.column_name='organization_id' and c.udt_name='uuid'
     and t.relkind='r' and t.relrowsecurity
     and exists (select 1 from pg_policy p where p.polrelid=t.oid and p.polpermissive and p.polname not like 'acesso_modulo_%')
     and (select count(*) from pg_policy p where p.polrelid=t.oid and not p.polpermissive and p.polname like 'acesso_modulo_%') <> 4
 ) then raise exception 'Tabela tenant sem proteção completa de módulos'; end if;
 if exists (
   select 1 from information_schema.columns c join pg_class t on t.oid=to_regclass(format('public.%I',c.table_name))
   where c.table_schema='public' and c.column_name='organization_id' and c.udt_name='uuid'
     and t.relkind='r' and t.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid=t.oid and p.polpermissive and p.polname not like 'acesso_modulo_%')
     and exists (select 1 from pg_policy p where p.polrelid=t.oid and p.polname like 'acesso_modulo_%')
 ) then raise exception 'Tabela só do servidor ganhou policy de módulo'; end if;
end $$;
