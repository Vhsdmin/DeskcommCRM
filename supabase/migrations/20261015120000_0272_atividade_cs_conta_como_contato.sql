-- 0272: atendimento e reunião de CS contam como contato com o cliente.
--
-- O DEFEITO, medido no DEV: um cliente com 20 atividades (atendimento, QBR,
-- jornada, NPS) seguia com `contacts.last_activity_at` nulo, e a lista de
-- Clientes e a ficha mostravam "Última atividade —". A lista positiva de
-- `fn_update_last_activity_at` (0079, 0235) não conhecia os tipos manuais de CS
-- que a 0261 trouxe.
--
-- Entram os QUATRO registros manuais em que uma pessoa da equipe falou com o
-- cliente — os mesmos que o painel de Desempenho conta (0270). Ficam de fora,
-- pela regra da 0079 (constatar não é interagir): `customer_journey_updated`
-- (decisão interna), `customer_nps_requested`/`customer_nps_cancelled`
-- (convite não é conversa) e `appointment_scheduled` (marcar não é realizar).
--
-- Backfill idempotente: carimba o maior `performed_at` desses tipos, sem
-- regredir um valor mais novo que já exista.

create or replace function public.fn_update_last_activity_at()
  returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $function$
begin
  -- LISTA POSITIVA: só isto conta como "alguém tocou este negócio". Tipo que
  -- não está aqui NÃO quebra o silêncio — inclusive tipo que ainda não existe.
  -- Ver o cabeçalho da 0079 antes de acrescentar linha nesta lista.
  if new.type not in (
    'ai_turn',              -- a IA falou com o cliente
    'note',                 -- alguém registrou trabalho no negócio
    'lead_edited',          -- humano mexeu nos dados
    'stage_changed',        -- humano moveu o negócio
    'next_action_approved', -- humano decidiu agir
    -- (0235) ligação ATENDIDA é interação; `voice_call_missed` não entra.
    'voice_call',
    -- (0272) registros manuais de CS: alguém da equipe falou com o cliente.
    'customer_support',
    'customer_meeting',
    'customer_ebr',
    'customer_qbr'
  ) then
    return new;
  end if;

  update public.crm_leads
     set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'::timestamptz), new.performed_at)
   where id = new.lead_id;

  if new.contact_id is not null then
    update public.contacts
       set last_activity_at = greatest(coalesce(last_activity_at, '-infinity'::timestamptz), new.performed_at)
     where id = new.contact_id;
  end if;
  return new;
end$function$;

with ultimo as (
  select a.contact_id, max(a.performed_at) as em
    from public.crm_lead_activities a
   where a.contact_id is not null
     and a.deleted_at is null
     and a.type in ('customer_support', 'customer_meeting', 'customer_ebr', 'customer_qbr')
     and a.performed_at <= now()
   group by a.contact_id
)
update public.contacts c
   set last_activity_at = u.em
  from ultimo u
 where c.id = u.contact_id
   and (c.last_activity_at is null or c.last_activity_at < u.em);
