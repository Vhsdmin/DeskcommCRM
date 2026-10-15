-- 0271: conexão por webhook com o Gestão VendePay.
--
-- O Gestão é a fonte das contas; o CRM recebe "conta cadastrada" e "conta
-- atualizada" por webhook assinado e cria/atualiza o cliente pelo ID do usuário
-- no Gestão — nunca por e-mail ou telefone, que podem mudar ou coincidir.
--
-- 1. `contacts.gestao_account_id`: o vínculo do cliente com a conta no Gestão,
--    único por organização entre clientes não mesclados.
-- 2. `gestao_conexoes`: uma conexão por organização (endereço secreto + segredo
--    de assinatura cifrado). RLS ligada SEM policies e grants revogados de
--    anon/authenticated: só o servidor (service_role), atrás do gate de papel da
--    API, lê e grava. O segredo nunca volta ao navegador depois de criado.
-- 3. `webhook_events_log.provider` aceita 'gestao', e o `external_id` (o
--    `event_id` do Gestão) é único por organização nesse provider: reenvio do
--    mesmo evento não processa duas vezes.

alter table public.contacts add column if not exists gestao_account_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_gestao_account_id_format' and conrelid = 'public.contacts'::regclass) then
    alter table public.contacts add constraint contacts_gestao_account_id_format
      check (gestao_account_id is null or (length(gestao_account_id) between 1 and 128 and gestao_account_id = btrim(gestao_account_id)));
  end if;
end $$;
create unique index if not exists uniq_contacts_org_gestao_account
  on public.contacts (organization_id, gestao_account_id)
  where gestao_account_id is not null and is_merged_into is null;
comment on column public.contacts.gestao_account_id is
  'ID do usuário/conta no Gestão VendePay. Chave do vínculo do webhook do Gestão; e-mail e telefone nunca são usados para casar contas.';

create table if not exists public.gestao_conexoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  path_token text not null unique,
  secret_encrypted bytea not null,
  is_active boolean not null default true,
  last_received_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gestao_conexoes_path_token_format check (length(path_token) >= 32)
);
comment on table public.gestao_conexoes is
  'Conexão por webhook com o Gestão VendePay (uma por organização). Server-side only: RLS ligada sem policies e grants revogados de anon/authenticated.';
comment on column public.gestao_conexoes.secret_encrypted is
  'Segredo do HMAC SHA-256 que assina cada envio, cifrado por fn_encrypt_oauth. Exibido uma vez ao criar ou trocar.';

alter table public.gestao_conexoes enable row level security;
revoke all on public.gestao_conexoes from anon, authenticated;
grant select, insert, update, delete on public.gestao_conexoes to service_role;

drop trigger if exists trg_gestao_conexoes_updated_at on public.gestao_conexoes;
create trigger trg_gestao_conexoes_updated_at
  before update on public.gestao_conexoes
  for each row execute function public.fn_set_updated_at();

alter table public.webhook_events_log drop constraint if exists webhook_events_log_provider_check;
alter table public.webhook_events_log add constraint webhook_events_log_provider_check
  check (provider = any (array['waha'::text, 'nuvemshop'::text, 'generic'::text, 'meta_cloud'::text, 'zernio'::text, 'gestao'::text]));

create unique index if not exists uniq_webhook_events_gestao_event
  on public.webhook_events_log (organization_id, external_id)
  where provider = 'gestao' and external_id is not null;
