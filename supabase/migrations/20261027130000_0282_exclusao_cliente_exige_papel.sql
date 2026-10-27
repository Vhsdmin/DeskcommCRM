-- 0282: revisão da 0281 — viewer não pode acionar a limpeza privilegiada
-- pelo DELETE direto do PostgREST, contornando o guard agent+ da RPC.
-- Restritiva: soma às policies existentes de tenant, módulos e suporte.
-- service_role/rotinas internas conservam seu bypass de RLS.
drop policy if exists contacts_agent_delete_guard on public.contacts;
create policy contacts_agent_delete_guard on public.contacts
as restrictive for delete to authenticated
using ((select public.fn_is_platform_admin()) or public.fn_role_at_least(organization_id, 'agent'));
notify pgrst, 'reload schema';
