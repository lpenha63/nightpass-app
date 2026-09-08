-- O card "evento de hoje" mostrava 33 previstas enquanto o card do evento mostrava 59,
-- para o mesmo evento. A diferenca: esta funcao somava people_count — o que a reserva
-- DECLAROU — e o resto do sistema usa o MAIOR entre o declarado e quem ja foi
-- cadastrado nela (utils/reservas.ts: esperadoDaReserva).
--
-- No evento de 08/09: 1 reserva declarou 20 e ja tinha 46 convidados cadastrados.
-- 20 + 13 de lista = 33 (o que aparecia); 46 + 13 = 59 (o correto).
--
-- Corrigir aqui basta porque o Dashboard PREFERE este numero ao proprio calculo, para
-- o % de comparecimento bater com o grafico comparativo — que tambem se alimenta
-- daqui. Uma correcao, dois lugares, e eles seguem consistentes.

CREATE OR REPLACE FUNCTION public.invites_daily(p_house uuid, p_days integer DEFAULT 42)
RETURNS TABLE(day text, invited integer)
LANGUAGE sql STABLE AS $function$
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
    -- Vale o MAIOR entre o declarado e o que ja foi cadastrado: quem reservou para 20
    -- e ja cadastrou 46 leva 46. Planejar a porta pelo declarado fura.
    SELECT to_char(r.reservation_date, 'YYYY-MM-DD') AS day,
           COALESCE(sum(GREATEST(
             COALESCE(r.people_count, 0),
             (SELECT count(*) FROM reservation_guests g WHERE g.reservation_id = r.id)::int
           )), 0)::int AS c
    FROM reservations r
    WHERE r.house_id = p_house AND r.reservation_date >= (SELECT from_date FROM win)
      AND COALESCE(r.status, '') <> 'cancelled'
    GROUP BY 1
  )
  SELECT u.day, sum(u.c)::int AS invited
  FROM (SELECT day, c FROM lg UNION ALL SELECT day, c FROM rp) u
  GROUP BY u.day;
$function$;
