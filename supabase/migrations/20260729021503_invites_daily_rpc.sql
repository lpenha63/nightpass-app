-- Convites por dia = convidados de listas de promoter (por evento) + pessoas em reservas
CREATE OR REPLACE FUNCTION public.invites_daily(p_house uuid, p_days integer DEFAULT 42)
 RETURNS TABLE(day text, invited integer)
 LANGUAGE sql STABLE
AS $function$
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
    SELECT to_char(reservation_date, 'YYYY-MM-DD') AS day, coalesce(sum(people_count), 0)::int AS c
    FROM reservations
    WHERE house_id = p_house AND reservation_date >= (SELECT from_date FROM win)
      AND coalesce(status, '') <> 'cancelled'
    GROUP BY 1
  )
  SELECT u.day, sum(u.c)::int AS invited
  FROM (SELECT day, c FROM lg UNION ALL SELECT day, c FROM rp) u
  GROUP BY u.day;
$function$;
