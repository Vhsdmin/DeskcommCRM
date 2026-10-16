-- 0273: sinais de CS e fotografia diária — a base da Central de Prioridades.
--
-- UM modelo para todos: a Central, o futuro Health Score, o dashboard de risco e
-- os playbooks leem a MESMA tabela de sinais. Cada sinal é uma condição sobre um
-- cliente, com motivo, evidência, severidade, dono, prazo e a versão da regra que
-- o produziu. Ele nasce quando a condição aparece e se RESOLVE SOZINHO quando ela
-- deixa de valer (o CSM registrou o atendimento, concluiu a tarefa, o seller
-- voltou a vender) — o laço se fecha pelo próprio trabalho, sem botão de "fechar
-- alerta".
--
-- Regras v1 (`cs-sinais-v1`):
--   sem_venda             7 dias sem vender = média, 15 = alta, 30 = crítica.
--                         Lê `contacts.gestao_ultima_venda_em`, que a integração
--                         com o Gestão vai preencher; sem o dado, não dispara.
--   detrator_sem_retorno  NPS 0–6 respondido sem atendimento/reunião depois = crítica.
--   tarefa_vencida        tarefa pendente/em andamento com prazo vencido = alta.
--   sem_contato           cliente acompanhado sem atendimento/reunião há 30 dias =
--                         média, 60 = alta (sem registro, conta desde o cadastro).
--   onboarding_parado     em Entrada/Onboarding há 14 dias sem mudar de fase = média.
--   sem_responsavel       cliente na jornada sem CSM responsável = média.
--
-- "Cliente acompanhado" = está na jornada de CS ou veio do Gestão.
--
-- Prazo pela severidade ao detectar (crítica 1 dia, alta 3, média 7); se a
-- severidade SOBE, o prazo recomeça. Dono = o CSM responsável no momento.
--
-- A fotografia diária (`cs_sinais_dia`) guarda os sinais abertos de cada dia: é o
-- histórico que tendência, Health Score e, um dia, previsão de churn precisam.
--
-- Escrita só pela função (service_role); leitura pela sessão com RLS por org.

alter table public.contacts add column if not exists gestao_ultima_venda_em timestamptz;
comment on column public.contacts.gestao_ultima_venda_em is
  'Última venda confirmada do seller, vinda do Gestão VendePay. Alimenta o sinal sem_venda (7/15/30 dias).';

create table if not exists public.cs_sinais (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tipo text not null,
  severidade text not null,
  motivo text not null,
  evidencia jsonb not null default '{}'::jsonb,
  regra_versao text not null,
  dono_user_id uuid references auth.users(id) on delete set null,
  prazo timestamptz not null,
  detectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  constraint cs_sinais_tipo_check check (tipo in (
    'sem_venda', 'detrator_sem_retorno', 'tarefa_vencida', 'sem_contato', 'onboarding_parado', 'sem_responsavel'
  )),
  constraint cs_sinais_severidade_check check (severidade in ('critica', 'alta', 'media'))
);
create unique index if not exists uniq_cs_sinal_aberto
  on public.cs_sinais (organization_id, contact_id, tipo) where resolvido_em is null;
create index if not exists cs_sinais_abertos_idx
  on public.cs_sinais (organization_id, severidade, prazo) where resolvido_em is null;
comment on table public.cs_sinais is
  'Sinais de CS por cliente (Central de Prioridades). Abre quando a condição aparece, resolve sozinho quando ela deixa de valer. Escrita só por fn_cs_recalcular_sinais.';

create table if not exists public.cs_sinais_dia (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dia date not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tipo text not null,
  severidade text not null,
  primary key (organization_id, dia, contact_id, tipo)
);
comment on table public.cs_sinais_dia is
  'Fotografia diária dos sinais abertos por cliente — histórico para tendência, Health Score e previsão de churn.';

alter table public.cs_sinais enable row level security;
alter table public.cs_sinais_dia enable row level security;
revoke all on public.cs_sinais, public.cs_sinais_dia from anon, authenticated;
grant select on public.cs_sinais, public.cs_sinais_dia to authenticated;
grant all on public.cs_sinais, public.cs_sinais_dia to service_role;

drop policy if exists cs_sinais_select on public.cs_sinais;
create policy cs_sinais_select on public.cs_sinais for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists cs_sinais_dia_select on public.cs_sinais_dia;
create policy cs_sinais_dia_select on public.cs_sinais_dia for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

-- As condições v1, como CONSULTA: cada linha é um sinal que deveria estar aberto
-- agora. Separada para ser lida por quem recalcula (e por teste) sem duplicar regra.
create or replace function public.fn_cs_sinais_candidatos(p_org uuid)
returns table (contact_id uuid, tipo text, severidade text, motivo text, evidencia jsonb, dono uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with clientes as (
  select c.id, c.created_at, c.cs_phase, c.cs_owner_user_id, c.gestao_ultima_venda_em
    from public.contacts c
   where c.organization_id = p_org
     and not c.is_anonymized
     and c.is_merged_into is null
     and (c.cs_phase is not null or c.gestao_account_id is not null)
), ultimo_contato as (
  select a.contact_id, max(a.performed_at) as em
    from public.crm_lead_activities a
   where a.organization_id = p_org
     and a.deleted_at is null
     and a.type in ('customer_support', 'customer_meeting', 'customer_ebr', 'customer_qbr')
     and a.performed_at <= now()
   group by a.contact_id
), ultima_fase as (
  select a.contact_id, max(a.performed_at) as em
    from public.crm_lead_activities a
   where a.organization_id = p_org
     and a.type = 'customer_journey_updated'
   group by a.contact_id
)
-- sem_venda (7/15/30 dias)
select c.id, 'sem_venda',
       case when now() - c.gestao_ultima_venda_em >= interval '30 days' then 'critica'
            when now() - c.gestao_ultima_venda_em >= interval '15 days' then 'alta'
            else 'media' end,
       'Sem vender há ' || floor(extract(epoch from now() - c.gestao_ultima_venda_em) / 86400)::int || ' dias',
       jsonb_build_object('ultima_venda_em', c.gestao_ultima_venda_em),
       c.cs_owner_user_id
  from clientes c
 where c.gestao_ultima_venda_em is not null
   and c.gestao_ultima_venda_em <= now() - interval '7 days'
union all
-- detrator_sem_retorno
select c.id, 'detrator_sem_retorno', 'critica',
       'NPS ' || s.score || ' sem atendimento depois da resposta',
       jsonb_build_object('nota', s.score, 'respondida_em', s.answered_at),
       c.cs_owner_user_id
  from clientes c
  join lateral (
    select n.score, n.answered_at
      from public.customer_nps_surveys n
     where n.organization_id = p_org and n.contact_id = c.id
       and n.score is not null and n.score <= 6
       and not exists (
         select 1 from public.crm_lead_activities a
          where a.organization_id = p_org and a.contact_id = c.id and a.deleted_at is null
            and a.type in ('customer_support', 'customer_meeting', 'customer_ebr', 'customer_qbr')
            and a.performed_at >= n.answered_at and a.performed_at <= now())
     order by n.answered_at desc
     limit 1
  ) s on true
union all
-- tarefa_vencida
select c.id, 'tarefa_vencida', 'alta',
       case when count(*) = 1 then '1 tarefa vencida' else count(*) || ' tarefas vencidas' end,
       jsonb_build_object('quantidade', count(*), 'mais_antiga', min(t.due_date)),
       c.cs_owner_user_id
  from clientes c
  join public.crm_tasks t
    on t.organization_id = p_org and t.contact_id = c.id
   and t.status in ('pending', 'in_progress') and t.due_date < now()
 group by c.id, c.cs_owner_user_id
union all
-- sem_contato (30/60 dias)
select c.id, 'sem_contato',
       case when coalesce(u.em, c.created_at) < now() - interval '60 days' then 'alta' else 'media' end,
       case when u.em is null then 'Sem atendimento registrado desde o cadastro'
            else 'Sem atendimento há ' || floor(extract(epoch from now() - u.em) / 86400)::int || ' dias' end,
       jsonb_build_object('ultimo_contato_em', u.em),
       c.cs_owner_user_id
  from clientes c
  left join ultimo_contato u on u.contact_id = c.id
 where coalesce(u.em, c.created_at) < now() - interval '30 days'
union all
-- onboarding_parado (14 dias na mesma fase de entrada)
select c.id, 'onboarding_parado', 'media',
       'Em ' || case c.cs_phase when 'entrada' then 'Entrada' else 'Onboarding' end
         || ' há ' || floor(extract(epoch from now() - coalesce(f.em, c.created_at)) / 86400)::int || ' dias',
       jsonb_build_object('fase', c.cs_phase, 'desde', coalesce(f.em, c.created_at)),
       c.cs_owner_user_id
  from clientes c
  left join ultima_fase f on f.contact_id = c.id
 where c.cs_phase in ('entrada', 'onboarding')
   and coalesce(f.em, c.created_at) < now() - interval '14 days'
union all
-- sem_responsavel
select c.id, 'sem_responsavel', 'media', 'Cliente na jornada sem CSM responsável',
       jsonb_build_object('fase', c.cs_phase), null::uuid
  from clientes c
 where c.cs_phase is not null and c.cs_owner_user_id is null;
$$;
revoke all on function public.fn_cs_sinais_candidatos(uuid) from public, anon, authenticated;
grant execute on function public.fn_cs_sinais_candidatos(uuid) to service_role;

create or replace function public.fn_cs_recalcular_sinais(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_abertos integer;
  v_resolvidos integer;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_org is null then raise check_violation; end if;


  -- Abre o que é novo; atualiza o que segue aberto (o prazo recomeça se a
  -- severidade subir).
  insert into public.cs_sinais as s
    (organization_id, contact_id, tipo, severidade, motivo, evidencia, regra_versao, dono_user_id, prazo)
  select p_org, k.contact_id, k.tipo, k.severidade, k.motivo, k.evidencia, 'cs-sinais-v1', k.dono,
         now() + case k.severidade when 'critica' then interval '1 day' when 'alta' then interval '3 days' else interval '7 days' end
    from public.fn_cs_sinais_candidatos(p_org) k
  on conflict (organization_id, contact_id, tipo) where resolvido_em is null do update
     set prazo = case
                   when array_position(array['media', 'alta', 'critica'], excluded.severidade)
                      > array_position(array['media', 'alta', 'critica'], s.severidade)
                   then excluded.prazo else s.prazo end,
         severidade = excluded.severidade,
         motivo = excluded.motivo,
         evidencia = excluded.evidencia,
         regra_versao = excluded.regra_versao,
         dono_user_id = excluded.dono_user_id,
         atualizado_em = now();

  -- Resolve o que deixou de valer.
  update public.cs_sinais s
     set resolvido_em = now(), atualizado_em = now()
   where s.organization_id = p_org
     and s.resolvido_em is null
     and not exists (select 1 from public.fn_cs_sinais_candidatos(p_org) k
                      where k.contact_id = s.contact_id and k.tipo = s.tipo);
  get diagnostics v_resolvidos = row_count;

  -- Fotografia do dia: espelha os sinais abertos agora.
  delete from public.cs_sinais_dia d
   where d.organization_id = p_org and d.dia = v_hoje
     and not exists (select 1 from public.cs_sinais s
                      where s.organization_id = p_org and s.resolvido_em is null
                        and s.contact_id = d.contact_id and s.tipo = d.tipo);
  insert into public.cs_sinais_dia (organization_id, dia, contact_id, tipo, severidade)
  select s.organization_id, v_hoje, s.contact_id, s.tipo, s.severidade
    from public.cs_sinais s
   where s.organization_id = p_org and s.resolvido_em is null
  on conflict (organization_id, dia, contact_id, tipo) do update set severidade = excluded.severidade;

  select count(*) into v_abertos from public.cs_sinais where organization_id = p_org and resolvido_em is null;
  return jsonb_build_object('abertos', v_abertos, 'resolvidos', v_resolvidos);
end;
$$;
revoke all on function public.fn_cs_recalcular_sinais(uuid) from public, anon, authenticated;
grant execute on function public.fn_cs_recalcular_sinais(uuid) to service_role;
