-- 0274: carteira por faixa de faturamento.
--
-- A VendePay divide os clientes pelo faturamento dos últimos 30 dias (GMV em
-- BRL vindo do Gestão). Cada faixa tem um responsável e um tipo:
--   suporte  o cliente fica registrado no nome do responsável (o suporte), mas
--            não gera trabalho de CS: os sinais da Central não valem para ele;
--   csm      o responsável é a CSM (gerente de contas) e os sinais valem.
-- As faixas são configuradas pela tela (Carteira) e guardadas só com o INÍCIO de
-- cada uma (`inicio_centavos`): o fim é o início da próxima, então não há buraco
-- nem sobreposição. GMV abaixo da primeira faixa cai na primeira.
--
-- Regras (decisão de 16/10/2026):
--  - Entrada: cliente acompanhado sem faixa recebe a faixa do seu GMV (ou a
--    primeira, sem GMV) e, se não tiver responsável, o da faixa.
--  - Subida: GMV de uma faixa ACIMA da atual abre o sinal `mudanca_de_faixa` para
--    o responsável da faixa nova ("apresente-se"). Ele só se resolve quando
--    alguém assume o cliente (`fn_cs_assumir_cliente`): a troca é humana e fica
--    no histórico.
--  - Queda: NUNCA desce sozinho. Mudar para faixa menor é decisão manual.
--
-- Sinais v2 (`cs-sinais-v2`): os da 0273 deixam de valer para clientes em faixa
-- do tipo `suporte`; entra `mudanca_de_faixa` (alta).

alter table public.contacts add column if not exists gestao_gmv_30d_centavos bigint;
alter table public.contacts add column if not exists gestao_gmv_30d_em timestamptz;
comment on column public.contacts.gestao_gmv_30d_centavos is
  'Vendas dos últimos 30 dias em BRL (centavos), vindas do Gestão. Define a faixa da carteira.';

create table if not exists public.cs_carteira_faixas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  inicio_centavos bigint not null,
  tipo text not null,
  responsavel_user_id uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint cs_carteira_faixas_tipo_check check (tipo in ('suporte', 'csm')),
  constraint cs_carteira_faixas_inicio_check check (inicio_centavos >= 0),
  constraint cs_carteira_faixas_nome_check check (length(btrim(nome)) between 1 and 80),
  constraint cs_carteira_faixas_inicio_unico unique (organization_id, inicio_centavos)
);
comment on table public.cs_carteira_faixas is
  'Faixas de carteira por faturamento (GMV 30 dias, BRL). Fim de cada faixa = início da próxima.';

alter table public.contacts add column if not exists carteira_faixa_id uuid
  references public.cs_carteira_faixas(id) on delete set null;

alter table public.cs_carteira_faixas enable row level security;
revoke all on public.cs_carteira_faixas from anon, authenticated;
grant select, insert, update, delete on public.cs_carteira_faixas to authenticated;
grant all on public.cs_carteira_faixas to service_role;
drop policy if exists cs_carteira_faixas_select on public.cs_carteira_faixas;
create policy cs_carteira_faixas_select on public.cs_carteira_faixas for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists cs_carteira_faixas_gestor on public.cs_carteira_faixas;
create policy cs_carteira_faixas_gestor on public.cs_carteira_faixas for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));

drop trigger if exists trg_cs_carteira_faixas_atualizado on public.cs_carteira_faixas;
create or replace function public.fn_cs_carteira_faixas_atualizado() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin new.atualizado_em := now(); return new; end $$;
revoke all on function public.fn_cs_carteira_faixas_atualizado() from public, anon;
create trigger trg_cs_carteira_faixas_atualizado before update on public.cs_carteira_faixas
  for each row execute function public.fn_cs_carteira_faixas_atualizado();

-- Vocabulário dos sinais com `mudanca_de_faixa`.
alter table public.cs_sinais drop constraint if exists cs_sinais_tipo_check;
alter table public.cs_sinais add constraint cs_sinais_tipo_check check (tipo in (
  'sem_venda', 'detrator_sem_retorno', 'tarefa_vencida', 'sem_contato', 'onboarding_parado', 'sem_responsavel',
  'mudanca_de_faixa'
));

-- A faixa que o GMV atual indica (a de maior início que o GMV alcança; a primeira
-- quando não alcança nenhuma ou não há GMV).
create or replace function public.fn_cs_faixa_do_gmv(p_org uuid, p_gmv_centavos bigint)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select f.id from public.cs_carteira_faixas f
      where f.organization_id = p_org and p_gmv_centavos is not null and f.inicio_centavos <= p_gmv_centavos
      order by f.inicio_centavos desc limit 1),
    (select f.id from public.cs_carteira_faixas f
      where f.organization_id = p_org order by f.inicio_centavos asc limit 1)
  );
$$;
revoke all on function public.fn_cs_faixa_do_gmv(uuid, bigint) from public, anon, authenticated;
grant execute on function public.fn_cs_faixa_do_gmv(uuid, bigint) to service_role;

create or replace function public.fn_cs_sinais_candidatos(p_org uuid)
returns table (contact_id uuid, tipo text, severidade text, motivo text, evidencia jsonb, dono uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with clientes as (
  select c.id, c.created_at, c.cs_phase, c.cs_owner_user_id, c.gestao_ultima_venda_em,
         c.gestao_gmv_30d_centavos, c.carteira_faixa_id
    from public.contacts c
   where c.organization_id = p_org
     and not c.is_anonymized
     and c.is_merged_into is null
     and (c.cs_phase is not null or c.gestao_account_id is not null)
), clientes_cs as (
  -- Trabalho de CS só para quem não está numa faixa de suporte.
  select c.* from clientes c
    left join public.cs_carteira_faixas f on f.id = c.carteira_faixa_id
   where f.id is null or f.tipo = 'csm'
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
  from clientes_cs c
 where c.gestao_ultima_venda_em is not null
   and c.gestao_ultima_venda_em <= now() - interval '7 days'
union all
-- detrator_sem_retorno
select c.id, 'detrator_sem_retorno', 'critica',
       'NPS ' || s.score || ' sem atendimento depois da resposta',
       jsonb_build_object('nota', s.score, 'respondida_em', s.answered_at),
       c.cs_owner_user_id
  from clientes_cs c
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
  from clientes_cs c
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
  from clientes_cs c
  left join ultimo_contato u on u.contact_id = c.id
 where coalesce(u.em, c.created_at) < now() - interval '30 days'
union all
-- onboarding_parado (14 dias na mesma fase de entrada)
select c.id, 'onboarding_parado', 'media',
       'Em ' || case c.cs_phase when 'entrada' then 'Entrada' else 'Onboarding' end
         || ' há ' || floor(extract(epoch from now() - coalesce(f.em, c.created_at)) / 86400)::int || ' dias',
       jsonb_build_object('fase', c.cs_phase, 'desde', coalesce(f.em, c.created_at)),
       c.cs_owner_user_id
  from clientes_cs c
  left join ultima_fase f on f.contact_id = c.id
 where c.cs_phase in ('entrada', 'onboarding')
   and coalesce(f.em, c.created_at) < now() - interval '14 days'
union all
-- sem_responsavel
select c.id, 'sem_responsavel', 'media', 'Cliente na jornada sem CSM responsável',
       jsonb_build_object('fase', c.cs_phase), null::uuid
  from clientes_cs c
 where c.cs_phase is not null and c.cs_owner_user_id is null
union all
-- mudanca_de_faixa: o GMV alcançou uma faixa ACIMA da atual (nunca para baixo).
select c.id, 'mudanca_de_faixa', 'alta',
       'Vendeu R$ ' || translate(to_char(c.gestao_gmv_30d_centavos / 100.0, 'FM999,999,999,990.00'), ',.', '.,')
         || ' nos últimos 30 dias: entrou na faixa ' || nova.nome || '. Apresente-se como responsável.',
       jsonb_build_object('faixa_atual', atual.nome, 'faixa_nova', nova.nome, 'faixa_nova_id', nova.id,
                          'gmv_30d_centavos', c.gestao_gmv_30d_centavos),
       nova.responsavel_user_id
  from clientes c
  join public.cs_carteira_faixas atual on atual.id = c.carteira_faixa_id
  join public.cs_carteira_faixas nova
    on nova.id = public.fn_cs_faixa_do_gmv(p_org, c.gestao_gmv_30d_centavos)
 where c.gestao_gmv_30d_centavos is not null
   and nova.inicio_centavos > atual.inicio_centavos;
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
  v_atribuidos integer;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_org is null then raise check_violation; end if;

  -- Entrada na carteira: cliente acompanhado sem faixa recebe a do seu GMV (ou a
  -- primeira) e, sem responsável, o responsável da faixa.
  with sem_faixa as (
    select c.id, public.fn_cs_faixa_do_gmv(p_org, c.gestao_gmv_30d_centavos) as faixa_id
      from public.contacts c
     where c.organization_id = p_org and c.carteira_faixa_id is null
       and not c.is_anonymized and c.is_merged_into is null
       and (c.cs_phase is not null or c.gestao_account_id is not null)
  )
  update public.contacts c
     set carteira_faixa_id = s.faixa_id,
         cs_owner_user_id = coalesce(c.cs_owner_user_id, f.responsavel_user_id)
    from sem_faixa s
    join public.cs_carteira_faixas f on f.id = s.faixa_id
   where c.id = s.id;
  get diagnostics v_atribuidos = row_count;

  insert into public.cs_sinais as s
    (organization_id, contact_id, tipo, severidade, motivo, evidencia, regra_versao, dono_user_id, prazo)
  select p_org, k.contact_id, k.tipo, k.severidade, k.motivo, k.evidencia, 'cs-sinais-v2', k.dono,
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

  update public.cs_sinais s
     set resolvido_em = now(), atualizado_em = now()
   where s.organization_id = p_org
     and s.resolvido_em is null
     and not exists (select 1 from public.fn_cs_sinais_candidatos(p_org) k
                      where k.contact_id = s.contact_id and k.tipo = s.tipo);
  get diagnostics v_resolvidos = row_count;

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
  return jsonb_build_object('abertos', v_abertos, 'resolvidos', v_resolvidos, 'atribuidos', v_atribuidos);
end;
$$;
revoke all on function public.fn_cs_recalcular_sinais(uuid) from public, anon, authenticated;
grant execute on function public.fn_cs_recalcular_sinais(uuid) to service_role;

-- Assumir um cliente que subiu de faixa: a CSM da faixa nova (ou um gestor) vira
-- a responsável e o cliente passa para a faixa que o GMV indica. Fica no
-- histórico do cliente. O sinal `mudanca_de_faixa` se resolve no próximo recálculo.
create or replace function public.fn_cs_assumir_cliente(p_org uuid, p_contact uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_papel text := public.fn_user_role_in_org(p_org);
  c public.contacts%rowtype;
  v_atual public.cs_carteira_faixas%rowtype;
  v_nova public.cs_carteira_faixas%rowtype;
begin
  if auth.uid() is null or coalesce(v_papel, '') not in ('agent', 'manager', 'admin') then
    raise insufficient_privilege;
  end if;
  select * into c from public.contacts
   where id = p_contact and organization_id = p_org and not is_anonymized and is_merged_into is null
   for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select * into v_nova from public.cs_carteira_faixas
   where id = public.fn_cs_faixa_do_gmv(p_org, c.gestao_gmv_30d_centavos);
  if not found then return jsonb_build_object('status', 'sem_faixas'); end if;
  select * into v_atual from public.cs_carteira_faixas where id = c.carteira_faixa_id;
  if v_atual.id is not null and v_nova.inicio_centavos <= v_atual.inicio_centavos then
    return jsonb_build_object('status', 'sem_mudanca');
  end if;
  -- Quem assume é o responsável da faixa nova; um gestor pode assumir por ele.
  if v_papel = 'agent' and v_nova.responsavel_user_id is distinct from auth.uid() then
    raise insufficient_privilege;
  end if;
  update public.contacts
     set carteira_faixa_id = v_nova.id,
         cs_owner_user_id = coalesce(v_nova.responsavel_user_id, auth.uid()),
         cs_revision = cs_revision + 1
   where id = p_contact and organization_id = p_org;
  insert into public.crm_lead_activities
    (organization_id, contact_id, lead_id, source_module, type, performed_by_user_id, actor_kind, reason, payload)
  values (p_org, p_contact, null, 'crm', 'customer_portfolio_changed', auth.uid(), 'user',
          'Cliente assumido na carteira',
          jsonb_build_object('faixa_anterior', v_atual.nome, 'faixa_nova', v_nova.nome,
                             'responsavel_anterior_user_id', c.cs_owner_user_id,
                             'responsavel_user_id', coalesce(v_nova.responsavel_user_id, auth.uid()),
                             'gmv_30d_centavos', c.gestao_gmv_30d_centavos));
  return jsonb_build_object('status', 'saved', 'faixa', v_nova.nome);
end;
$$;
revoke all on function public.fn_cs_assumir_cliente(uuid, uuid) from public, anon;
grant execute on function public.fn_cs_assumir_cliente(uuid, uuid) to authenticated;
