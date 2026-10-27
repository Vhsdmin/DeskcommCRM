-- Fixture inteiramente revertida pelo runner; nenhum dado real é apagado.
insert into auth.users(id,email) values ('c2810000-0000-4000-8000-000000000001','exclusao@invariant.test');
insert into public.organizations(id,slug,legal_name,display_name) values
 ('c2810000-0000-4000-8000-00000000000a','exclusao-inv-a','Fixture A','Fixture A'),
 ('c2810000-0000-4000-8000-00000000000b','exclusao-inv-b','Fixture B','Fixture B');
insert into public.user_organizations(user_id,organization_id,role,accepted_at) values
 ('c2810000-0000-4000-8000-000000000001','c2810000-0000-4000-8000-00000000000a','admin',now());
insert into public.contacts(id,organization_id,name) values
 ('c2810000-0000-4000-8000-0000000000ca','c2810000-0000-4000-8000-00000000000a','Fixture A'),
 ('c2810000-0000-4000-8000-0000000000cb','c2810000-0000-4000-8000-00000000000b','Fixture B');
insert into public.crm_lead_activities(organization_id,contact_id,source_module,type,payload,actor_kind)
values ('c2810000-0000-4000-8000-00000000000a','c2810000-0000-4000-8000-0000000000ca','crm','customer_support','{}','system');
insert into public.calendar_appointments(organization_id,contact_id,title,starts_at,ends_at)
values ('c2810000-0000-4000-8000-00000000000a','c2810000-0000-4000-8000-0000000000ca','Fixture',now()+interval '1 day',now()+interval '2 days');
select set_config('request.jwt.claims','{"sub":"c2810000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if public.fn_delete_contact('c2810000-0000-4000-8000-00000000000a','c2810000-0000-4000-8000-0000000000cb') is not null then raise exception 'Outro tenant apagado'; end if;
 begin
  perform public.fn_delete_contact('c2810000-0000-4000-8000-00000000000a','c2810000-0000-4000-8000-0000000000ca');
  raise exception 'Agenda não bloqueou';
 exception when foreign_key_violation or restrict_violation then null; end;
 if not exists(select 1 from public.crm_lead_activities where contact_id='c2810000-0000-4000-8000-0000000000ca') then raise exception 'Histórico perdido na falha'; end if;
end $$;
reset role;
delete from public.calendar_appointments where organization_id='c2810000-0000-4000-8000-00000000000a';
update public.user_organizations set role='viewer' where user_id='c2810000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin
  perform public.fn_delete_contact('c2810000-0000-4000-8000-00000000000a','c2810000-0000-4000-8000-0000000000ca');
  raise exception 'Viewer apagou';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
-- A RPC não é a única porta: o PostgREST também permite DELETE de tabela.
set local role authenticated;
do $$ declare n integer; begin
 delete from public.contacts where id='c2810000-0000-4000-8000-0000000000ca';
 get diagnostics n=row_count;
 if n <> 0 then raise exception 'Viewer excluiu ficha pelo DELETE direto'; end if;
 if not exists(select 1 from public.crm_lead_activities where contact_id='c2810000-0000-4000-8000-0000000000ca') then raise exception 'Viewer destruiu histórico pelo trigger'; end if;
end $$;
reset role;
update public.user_organizations set module_access=array['/app/contacts'] where user_id='c2810000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare n integer; begin
 delete from public.contacts where id='c2810000-0000-4000-8000-0000000000ca';
 get diagnostics n=row_count;
 if n <> 0 then raise exception 'Viewer com módulo Clientes excluiu ficha'; end if;
end $$;
reset role;
update public.user_organizations set role='agent',module_access=array['/app/tasks'] where user_id='c2810000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 if public.fn_delete_contact('c2810000-0000-4000-8000-00000000000a','c2810000-0000-4000-8000-0000000000ca') is not null then raise exception 'Módulo não autorizado apagou'; end if;
end $$;
reset role;
update public.user_organizations set role='agent',module_access=array['/app/contacts'] where user_id='c2810000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 if public.fn_delete_contact('c2810000-0000-4000-8000-00000000000a','c2810000-0000-4000-8000-0000000000ca') is distinct from 'c2810000-0000-4000-8000-0000000000ca'::uuid then raise exception 'Exclusão autorizada falhou'; end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.contacts where id='c2810000-0000-4000-8000-0000000000ca') then raise exception 'Ficha sobreviveu'; end if;
 if exists(select 1 from public.crm_lead_activities where contact_id='c2810000-0000-4000-8000-0000000000ca') then raise exception 'Histórico órfão'; end if;
 if not exists(select 1 from public.contacts where id='c2810000-0000-4000-8000-0000000000cb') then raise exception 'Outra organização alterada'; end if;
end $$;
