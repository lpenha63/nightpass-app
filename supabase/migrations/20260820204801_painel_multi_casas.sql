-- Painel consolidado: uma linha por casa que o usuário logado alcança.
-- Sem SECURITY DEFINER de propósito (o RLS do chamador continua valendo) e ainda
-- filtrando por house_users: ninguém enxerga unidade em que não tem acesso ativo.
CREATE OR REPLACE FUNCTION public.dashboard_multi_casas()
RETURNS TABLE(
  house_id uuid, house_name text, logo_url text,
  eventos_futuros bigint,
  proximo_id uuid, proximo_nome text, proximo_data date, proximo_hora time,
  proximo_reservas bigint, proximo_pessoas bigint, proximo_lista bigint,
  checkins_hoje bigint, faturamento_hoje_cents bigint
)
LANGUAGE sql STABLE AS $function$
WITH minhas AS (
  SELECT h.id, h.name, h.logo_url
  FROM houses h
  WHERE h.id IN (SELECT hu.house_id FROM house_users hu
                  WHERE hu.user_id = auth.uid() AND hu.is_active = true)
),
-- Dia operacional: antes das 6h ainda é "a noite de ontem"
ref AS (
  SELECT CASE WHEN extract(hour FROM (now() AT TIME ZONE 'America/Sao_Paulo')) < 6
              THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1
              ELSE (now() AT TIME ZONE 'America/Sao_Paulo')::date END AS dia
),
prox AS (
  SELECT DISTINCT ON (e.house_id)
         e.house_id, e.id, e.name, e.event_date, e.start_time
  FROM events e, ref
  WHERE e.house_id IN (SELECT id FROM minhas)
    AND e.status NOT IN ('cancelado','encerrado')
    AND e.event_date >= ref.dia
  ORDER BY e.house_id, e.event_date, e.start_time NULLS LAST
)
SELECT m.id, m.name, m.logo_url,
  (SELECT count(*) FROM events e, ref
    WHERE e.house_id = m.id AND e.status NOT IN ('cancelado','encerrado') AND e.event_date >= ref.dia),
  p.id, p.name, p.event_date, p.start_time,
  COALESCE((SELECT count(*) FROM reservations r
             WHERE r.house_id = m.id AND COALESCE(r.status,'') <> 'cancelled'
               AND (r.event_id = p.id OR (r.event_id IS NULL AND r.reservation_date = p.event_date))), 0),
  COALESCE((SELECT sum(r.people_count) FROM reservations r
             WHERE r.house_id = m.id AND COALESCE(r.status,'') <> 'cancelled'
               AND (r.event_id = p.id OR (r.event_id IS NULL AND r.reservation_date = p.event_date))), 0),
  COALESCE((SELECT count(*) FROM promoter_list_guests g WHERE g.event_id = p.id), 0),
  COALESCE((SELECT count(*) FROM checkins c, ref
             WHERE c.house_id = m.id
               AND (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date
                   BETWEEN ref.dia AND ref.dia + 1), 0),
  COALESCE((SELECT sum(c.amount_cents) FROM checkins c, ref
             WHERE c.house_id = m.id
               AND (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date
                   BETWEEN ref.dia AND ref.dia + 1), 0)
  + COALESCE((SELECT sum(o.amount_cents) FROM ticket_orders o, ref
               WHERE o.house_id = m.id AND o.payment_status = 'paid'
                 AND (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date
                     BETWEEN ref.dia AND ref.dia + 1), 0)
FROM minhas m
LEFT JOIN prox p ON p.house_id = m.id
ORDER BY m.name;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_multi_casas() TO authenticated;
