-- 0275: playbooks de CS — o alerta vira trabalho.
--
-- Um playbook é a sequência de tarefas que um TIPO de sinal (0273/0274) dispara.
-- Enquanto o sinal está aberto, cada passo vira uma tarefa comum do CRM
-- (`crm_tasks`, aparece em Tarefas e na ficha) com prazo, prioridade e
-- responsável; quando o sinal se resolve, as tarefas ainda abertas dele são
-- canceladas — o motivo deixou de existir.
--
-- Regras:
--  - Um playbook por (organização, tipo de sinal), configurado pela tela por
--    manager+. `tarefa_vencida` não tem playbook: tarefa gerando tarefa.
--  - Passo = {chave, titulo, descricao, dias, prioridade, severidade_minima,
--    responsavel_user_id}. O passo só nasce quando o sinal ATINGE a severidade
--    mínima (sem vender 7 dias = média, 15 = alta, 30 = crítica): é a escada.
--  - `dias` conta a partir de quando o passo nasce. Responsável vazio = dono do
--    sinal; responsável que saiu da organização também cai no dono.
--  - Idempotente: (cs_sinal_id, cs_playbook_passo) é único; recalcular não
--    duplica. Passo novo num playbook vale também para sinais já abertos.
--  - O formato de `passos` é validado no TypeScript (`lib/cs/playbooks.ts`) na
--    única porta de escrita (PUT /api/v1/cs/playbooks/[tipo]); o banco garante
--    só que é um array.

create table if not exists public.cs_playbooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo_sinal text not null,
  ativo boolean not null default true,
  passos jsonb not null default '[]'::jsonb,
  atualizado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint cs_playbooks_tipo_check check (tipo_sinal in (
    'sem_venda', 'detrator_sem_retorno', 'sem_contato', 'onboarding_parado', 'sem_responsavel', 'mudanca_de_faixa'
  )),
  constraint cs_playbooks_passos_check check (jsonb_typeof(passos) = 'array' and jsonb_array_length(passos) <= 10),
  constraint cs_playbooks_tipo_unico unique (organization_id, tipo_sinal)
);
comment on table public.cs_playbooks is
  'Sequência de tarefas que cada tipo de sinal de CS dispara enquanto está aberto (0275).';

alter table public.cs_playbooks enable row level security;
revoke all on public.cs_playbooks from anon, authenticated;
grant select, insert, update, delete on public.cs_playbooks to authenticated;
grant all on public.cs_playbooks to service_role;
drop policy if exists cs_playbooks_select on public.cs_playbooks;
create policy cs_playbooks_select on public.cs_playbooks for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists cs_playbooks_gestor on public.cs_playbooks;
create policy cs_playbooks_gestor on public.cs_playbooks for all to authenticated
  using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));

drop trigger if exists trg_cs_playbooks_atualizado on public.cs_playbooks;
create trigger trg_cs_playbooks_atualizado
  before update on public.cs_playbooks
  for each row execute function public.fn_cs_carteira_faixas_atualizado();

-- A tarefa sabe de que sinal e de que passo nasceu.
alter table public.crm_tasks add column if not exists cs_sinal_id uuid
  references public.cs_sinais(id) on delete set null;
alter table public.crm_tasks add column if not exists cs_playbook_passo text;
comment on column public.crm_tasks.cs_sinal_id is
  'Sinal de CS cujo playbook criou a tarefa (0275). Resolvido o sinal, a tarefa aberta é cancelada.';
create unique index if not exists uniq_crm_tasks_passo_do_sinal
  on public.crm_tasks (cs_sinal_id, cs_playbook_passo) where cs_sinal_id is not null;

create or replace function public.fn_cs_aplicar_playbooks(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_criadas integer;
  v_encerradas integer;
  v_escala constant text[] := array['media', 'alta', 'critica'];
begin
  if p_org is null then raise check_violation; end if;

  insert into public.crm_tasks
    (organization_id, title, description, due_date, priority, status, contact_id, assigned_to,
     cs_sinal_id, cs_playbook_passo)
  select p_org,
         left(btrim(p ->> 'titulo'), 200),
         nullif(btrim(coalesce(p ->> 'descricao', '')), ''),
         now() + make_interval(days => greatest(0, least(90, coalesce((p ->> 'dias')::int, 0)))),
         case when p ->> 'prioridade' in ('low', 'medium', 'high', 'urgent') then p ->> 'prioridade' else 'medium' end,
         'pending',
         s.contact_id,
         coalesce(
           (select uo.user_id from public.user_organizations uo
             where uo.organization_id = p_org and uo.revoked_at is null
               and uo.user_id::text = p ->> 'responsavel_user_id'
             limit 1),
           s.dono_user_id),
         s.id,
         p ->> 'chave'
    from public.cs_sinais s
    join public.cs_playbooks pb
      on pb.organization_id = p_org and pb.tipo_sinal = s.tipo and pb.ativo
   cross join lateral jsonb_array_elements(pb.passos) p
   where s.organization_id = p_org
     and s.resolvido_em is null
     and coalesce(p ->> 'chave', '') <> ''
     and length(btrim(coalesce(p ->> 'titulo', ''))) > 0
     and array_position(v_escala, s.severidade)
         >= coalesce(array_position(v_escala, p ->> 'severidade_minima'), 1)
  on conflict (cs_sinal_id, cs_playbook_passo) where cs_sinal_id is not null do nothing;
  get diagnostics v_criadas = row_count;

  update public.crm_tasks t
     set status = 'cancelled'
    from public.cs_sinais s
   where t.organization_id = p_org
     and t.cs_sinal_id = s.id
     and s.resolvido_em is not null
     and t.status in ('pending', 'in_progress');
  get diagnostics v_encerradas = row_count;

  return jsonb_build_object('criadas', v_criadas, 'encerradas', v_encerradas);
end;
$$;
revoke all on function public.fn_cs_aplicar_playbooks(uuid) from public, anon, authenticated;
grant execute on function public.fn_cs_aplicar_playbooks(uuid) to service_role;

-- Recálculo: o mesmo da 0274, terminando nos playbooks.
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
  v_tarefas jsonb;
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

  -- Playbooks (0275): tarefas dos sinais abertos e encerramento das dos resolvidos.
  v_tarefas := public.fn_cs_aplicar_playbooks(p_org);

  select count(*) into v_abertos from public.cs_sinais where organization_id = p_org and resolvido_em is null;
  return jsonb_build_object('abertos', v_abertos, 'resolvidos', v_resolvidos, 'atribuidos', v_atribuidos,
                            'tarefas_criadas', v_tarefas -> 'criadas', 'tarefas_encerradas', v_tarefas -> 'encerradas');
end;
$$;
revoke all on function public.fn_cs_recalcular_sinais(uuid) from public, anon, authenticated;
grant execute on function public.fn_cs_recalcular_sinais(uuid) to service_role;
