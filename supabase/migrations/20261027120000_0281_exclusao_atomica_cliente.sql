-- 0281: exclusão de cliente e histórico numa única transação, com RLS.
-- A FK SET NULL era incompatível com activity_contact_or_lead (0261).
-- Atividades com negócio sobrevivem; as ancoradas só na ficha saem com ela.
create or replace function public.fn_limpar_atividades_do_cliente_excluido()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  delete from public.crm_lead_activities
   where organization_id = old.organization_id and contact_id = old.id and lead_id is null;
  return old;
end $$;
revoke execute on function public.fn_limpar_atividades_do_cliente_excluido() from public, anon, authenticated;

drop trigger if exists trg_limpar_atividades_do_cliente_excluido on public.contacts;
create trigger trg_limpar_atividades_do_cliente_excluido before delete on public.contacts
for each row execute function public.fn_limpar_atividades_do_cliente_excluido();

-- INVOKER: conserva RLS, escopo da conversa, módulos e papéis do chamador.
-- Qualquer erro (inclusive FK criada entre checagem e delete) desfaz TUDO.
create or replace function public.fn_delete_contact(p_org uuid, p_contact uuid)
returns uuid language plpgsql security invoker
set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if current_user <> 'service_role' and not (
    public.fn_is_platform_admin() or public.fn_role_at_least(p_org, 'agent')
  ) then
    raise exception 'contact_delete_forbidden' using errcode = '42501';
  end if;
  select id into v_id from public.contacts
   where id = p_contact and organization_id = p_org for update;
  if v_id is null then return null; end if;
  -- A agenda não é apagada: a FK RESTRICT preserva compromissos e reverte
  -- também os deletes abaixo, mesmo se a agenda não for visível ao chamador.
  delete from public.messages where contact_id = p_contact and organization_id = p_org;
  delete from public.conversations where contact_id = p_contact and organization_id = p_org;
  delete from public.contacts where id = p_contact and organization_id = p_org returning id into v_id;
  -- RLS pode filtrar o DELETE sem lançar erro. Nunca devolver falso sucesso
  -- nem confirmar mensagens apagadas se a ficha não pôde sair.
  if v_id is null then
    raise exception 'contact_delete_forbidden' using errcode = '42501';
  end if;
  return v_id;
end $$;
revoke execute on function public.fn_delete_contact(uuid,uuid) from public, anon;
grant execute on function public.fn_delete_contact(uuid,uuid) to authenticated, service_role;
insert into public.acesso_modulo_recursos(recurso,padrao,prioridade,leitura,escrita)
values ('fn_delete_contact',false,36,array['/app/contacts'],null)
on conflict(recurso) do update set padrao=excluded.padrao,prioridade=excluded.prioridade,
leitura=excluded.leitura,escrita=excluded.escrita;
notify pgrst, 'reload schema';
