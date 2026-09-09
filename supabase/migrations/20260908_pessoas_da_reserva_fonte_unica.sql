-- Pessoas de uma reserva: uma conta so, no banco.
--
-- Pela QUARTA vez o mesmo erro apareceu numa tela diferente: somar people_count
-- (o tamanho declarado quando a reserva foi feita) ignorando quem o titular ja
-- cadastrou depois. Quem reservou para 20 e cadastrou 46 nomes leva 46 pessoas
-- na porta, nao 20. Nos ultimos 60 dias TODO evento com reserva divergiu — em
-- 25/07 foram 323 declarados contra 518 reais, 195 pessoas a menos no
-- planejamento da noite.
--
-- O lado TypeScript ja tinha a resposta em esperadoDaReserva() (src/utils/reservas.ts),
-- mas nenhuma funcao do banco a conhecia — cada uma reescrevia a soma do seu jeito.
-- Esta migration cria o equivalente em SQL e faz as quatro funcoes chamarem ele,
-- para a proxima tela nascer certa em vez de repetir o erro.

-- ── a conta, num lugar so ──
-- Sem SECURITY DEFINER de proposito: roda com os direitos de quem chama, entao a
-- RLS de reservation_guests continua valendo. Chamada de dentro de uma funcao
-- DEFINER (agenda da equipe), enxerga o que aquela funcao ja enxerga; chamada por
-- anon, enxerga o que anon ja podia ver — nao abre nada novo.
CREATE OR REPLACE FUNCTION public.pessoas_da_reserva(p_reserva uuid, p_declarado int)
RETURNS int
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT GREATEST(
    COALESCE(p_declarado, 0),
    (SELECT count(*) FROM reservation_guests g WHERE g.reservation_id = p_reserva)::int
  );
$fn$;

COMMENT ON FUNCTION public.pessoas_da_reserva(uuid, int) IS
  'Pessoas esperadas numa reserva: o maior entre o declarado e os nomes ja cadastrados. Espelha esperadoDaReserva() de src/utils/reservas.ts.';

REVOKE EXECUTE ON FUNCTION public.pessoas_da_reserva(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pessoas_da_reserva(uuid, int) TO anon, authenticated, service_role;


-- ── 1. grafico e card do dia (Dashboard) ──
CREATE OR REPLACE FUNCTION public.invites_daily(p_house uuid, p_days integer DEFAULT 42)
RETURNS TABLE(day text, invited integer)
LANGUAGE sql
STABLE
AS $fn$
  WITH win AS (
    SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date - p_days) AS from_date
  ),
  lg AS (
    SELECT to_char(e.event_date, 'YYYY-MM-DD') AS day, count(g.id)::int AS c
    FROM promoter_list_guests g
    JOIN events e ON e.id = g.event_id
    WHERE e.house_id = p_house AND e.event_date >= (SELECT from_date FROM win)
    GROUP BY 1
  ),
  rp AS (
    SELECT to_char(r.reservation_date, 'YYYY-MM-DD') AS day,
           COALESCE(sum(pessoas_da_reserva(r.id, r.people_count)), 0)::int AS c
    FROM reservations r
    WHERE r.house_id = p_house AND r.reservation_date >= (SELECT from_date FROM win)
      AND COALESCE(r.status, '') <> 'cancelled'
    GROUP BY 1
  )
  SELECT u.day, sum(u.c)::int AS invited
  FROM (SELECT day, c FROM lg UNION ALL SELECT day, c FROM rp) u
  GROUP BY u.day;
$fn$;


-- ── 2. painel de varias casas ──
CREATE OR REPLACE FUNCTION public.dashboard_multi_casas()
RETURNS TABLE(house_id uuid, house_name text, logo_url text, eventos_futuros bigint,
              proximo_id uuid, proximo_nome text, proximo_data date,
              proximo_hora time without time zone, proximo_reservas bigint,
              proximo_pessoas bigint, proximo_lista bigint, checkins_hoje bigint,
              faturamento_hoje_cents bigint)
LANGUAGE sql
STABLE
AS $fn$
WITH minhas AS (
  SELECT h.id, h.name, h.logo_url,
         -- cada casa tem a sua virada: 6h na balada, 0h no comércio diurno
         CASE WHEN extract(hour FROM (now() AT TIME ZONE 'America/Sao_Paulo')) < COALESCE(h.day_start_hour, 6)
              THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1
              ELSE (now() AT TIME ZONE 'America/Sao_Paulo')::date END AS dia
  FROM houses h
  WHERE h.id IN (SELECT hu.house_id FROM house_users hu
                  WHERE hu.user_id = auth.uid() AND hu.is_active = true)
),
prox AS (
  SELECT DISTINCT ON (e.house_id)
         e.house_id, e.id, e.name, e.event_date, e.start_time
  FROM events e JOIN minhas m ON m.id = e.house_id
  WHERE e.status NOT IN ('cancelado','encerrado')
    AND e.event_date >= m.dia
  ORDER BY e.house_id, e.event_date, e.start_time NULLS LAST
)
SELECT m.id, m.name, m.logo_url,
  (SELECT count(*) FROM events e
    WHERE e.house_id = m.id AND e.status NOT IN ('cancelado','encerrado') AND e.event_date >= m.dia),
  p.id, p.name, p.event_date, p.start_time,
  COALESCE((SELECT count(*) FROM reservations r
             WHERE r.house_id = m.id AND COALESCE(r.status,'') <> 'cancelled'
               AND (r.event_id = p.id OR (r.event_id IS NULL AND r.reservation_date = p.event_date))), 0),
  COALESCE((SELECT sum(pessoas_da_reserva(r.id, r.people_count)) FROM reservations r
             WHERE r.house_id = m.id AND COALESCE(r.status,'') <> 'cancelled'
               AND (r.event_id = p.id OR (r.event_id IS NULL AND r.reservation_date = p.event_date))), 0),
  COALESCE((SELECT count(*) FROM promoter_list_guests g WHERE g.event_id = p.id), 0),
  COALESCE((SELECT count(*) FROM checkins c
             WHERE c.house_id = m.id
               AND (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN m.dia AND m.dia + 1), 0),
  COALESCE((SELECT sum(c.amount_cents) FROM checkins c
             WHERE c.house_id = m.id
               AND (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN m.dia AND m.dia + 1), 0)
  + COALESCE((SELECT sum(o.amount_cents) FROM ticket_orders o
               WHERE o.house_id = m.id AND o.payment_status = 'paid'
                 AND (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN m.dia AND m.dia + 1), 0)
FROM minhas m
LEFT JOIN prox p ON p.house_id = m.id
ORDER BY m.name;
$fn$;


-- ── 3. agenda da equipe: "convidados" dos proximos eventos ──
CREATE OR REPLACE FUNCTION public.agenda_for_freelancer(p_fid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
declare f record; result jsonb;
begin
  select id, full_name, phone, staff_type, house_id, can_delegate_tasks, can_see_all_events into f
    from freelancers where id = p_fid;
  if f.id is null then return null; end if;
  select jsonb_build_object(
    'freelancer', jsonb_build_object('name', f.full_name, 'staff_type', f.staff_type,
      'can_delegate', coalesce(f.can_delegate_tasks, false),
      'can_see_all', coalesce(f.can_see_all_events, false),
      'geo_on', (select h.lat is not null and h.lng is not null from houses h where h.id = f.house_id)),
    'house', (select jsonb_build_object('name', h.name, 'logo_url', h.logo_url,
                                        'day_start_hour', coalesce(h.day_start_hour, 6))
                from houses h where h.id = f.house_id),
    'events', coalesce((
      select jsonb_agg(ev order by (ev->>'event_date'))
      from (
        select jsonb_build_object(
          'id', e.id, 'name', e.name, 'event_date', e.event_date, 'start_time', e.start_time,
          'confirmed', coalesce(ef.confirmed, false), 'responded_at', ef.responded_at,
          'scaled', (ef.id is not null),
          'checkin_at', ef.checkin_at, 'checkout_at', ef.checkout_at, 'role', ef.role,
          'entry_time', ef.entry_time,
          'house_name', he.name, 'house_logo', he.logo_url,
          'tasks', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', t.id, 'title', t.title, 'area', t.area, 'area_icon', t.area_icon,
              'description', t.description, 'deadline', t.deadline, 'status', t.status,
              'completed_at', t.completed_at, 'block_reason', t.block_reason, 'blocked_at', t.blocked_at,
              'steps', task_steps_json(t.id)
            ) order by t.deadline nulls last, t.sort_order)
            from event_tasks t where t.event_id = e.id
              and (t.freelancer_id = f.id or (f.phone is not null and regexp_replace(coalesce(t.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g')))
          ), '[]'::jsonb)
        ) as ev
        from events e
        join houses he on he.id = e.house_id
        left join event_freelancers ef on ef.event_id = e.id and ef.freelancer_id = f.id
        where e.house_id = f.house_id and e.status <> 'cancelado' and e.event_date >= (current_date - 1)
          and ( ef.id is not null or exists (select 1 from event_tasks t2 where t2.event_id = e.id
                and (t2.freelancer_id = f.id or (f.phone is not null and regexp_replace(coalesce(t2.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g')))) )
      ) sub
    ), '[]'::jsonb),
    'avulsas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'area', t.area, 'area_icon', t.area_icon,
        'description', t.description, 'deadline', t.deadline, 'status', t.status,
        'completed_at', t.completed_at, 'block_reason', t.block_reason, 'blocked_at', t.blocked_at,
        'steps', task_steps_json(t.id)
      ) order by t.deadline nulls last, t.sort_order)
      from event_tasks t
      where t.event_id is null and t.house_id = f.house_id
        and (t.freelancer_id = f.id or (f.phone is not null and regexp_replace(coalesce(t.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g')))
        and (t.status <> 'done' or t.completed_at >= now() - interval '30 days')
    ), '[]'::jsonb),
    'upcoming', case when coalesce(f.can_see_all_events, false) then coalesce((
      select jsonb_agg(u order by (u->>'event_date'))
      from (
        select jsonb_build_object(
          'id', e.id, 'name', e.name, 'event_date', e.event_date, 'start_time', e.start_time,
          'reservas', (select count(*) from reservations r
                        where r.house_id = f.house_id and coalesce(r.status,'') <> 'cancelled'
                          and (r.event_id = e.id or (r.event_id is null and r.reservation_date = e.event_date))),
          'convidados', (
            -- o maior entre declarado e cadastrado: e por este numero que a equipe
            -- dimensiona mesa, bar e portaria
            (select coalesce(sum(pessoas_da_reserva(r.id, r.people_count)), 0) from reservations r
              where r.house_id = f.house_id and coalesce(r.status,'') <> 'cancelled'
                and (r.event_id = e.id or (r.event_id is null and r.reservation_date = e.event_date)))
            + (select count(*) from promoter_list_guests g where g.event_id = e.id)
          )
        ) as u
        from events e
        where e.house_id = f.house_id and e.status not in ('cancelado','encerrado') and e.event_date >= current_date
        order by e.event_date limit 30
      ) subu
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end;
$fn$;


-- ── 4. reservas do evento na agenda da equipe (a tela de montar as mesas) ──
-- agenda.html soma este 'people' num total de pax; com o declarado, a equipe
-- montava a casa para menos gente do que ja estava cadastrada.
CREATE OR REPLACE FUNCTION public.freelancer_event_reservations(p_token uuid, p_event uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
declare cf record; ev record;
begin
  select fr.id as fid, fr.house_id, fr.can_see_all_events into cf
    from freelancers fr where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null then return '[]'::jsonb; end if;
  select id, house_id, event_date into ev from events where id = p_event and house_id = cf.house_id;
  if ev.id is null then return '[]'::jsonb; end if;
  -- precisa ver todos os eventos OU estar escalado neste
  if not coalesce(cf.can_see_all_events,false)
     and not exists (select 1 from event_freelancers x where x.event_id = p_event and x.freelancer_id = cf.fid)
  then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'people', pessoas_da_reserva(r.id, r.people_count),
      'declarado', r.people_count, 'location', r.location,
      'arrival', r.expected_arrival, 'status', r.status, 'obs', r.observations
    ) order by r.location nulls last, r.expected_arrival nulls last, r.name)
    from reservations r
    where r.house_id = cf.house_id and coalesce(r.status,'') <> 'cancelled'
      and (r.event_id = p_event or (r.event_id is null and r.reservation_date = ev.event_date))
  ), '[]'::jsonb);
end;
$fn$;
