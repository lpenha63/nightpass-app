
CREATE OR REPLACE FUNCTION event_checkin_stats(p_house uuid)
RETURNS TABLE(event_id uuid, total bigint, pagantes bigint, cortesias bigint)
LANGUAGE sql STABLE AS $$
  WITH ev_por_data AS (
    SELECT event_date, (array_agg(id ORDER BY id))[1] AS single_event_id, count(*) AS n
    FROM events
    WHERE house_id = p_house AND status <> 'cancelado'
    GROUP BY event_date
  ),
  ci AS (
    SELECT
      COALESCE(
        c.event_id,
        CASE WHEN epd.n = 1 THEN epd.single_event_id END
      ) AS eff_event_id,
      (c.payment_method = 'cortesia' OR COALESCE(c.amount_cents,0) = 0) AS is_cortesia
    FROM checkins c
    LEFT JOIN ev_por_data epd
      ON c.event_id IS NULL
     AND epd.event_date = (
       ( (c.created_at AT TIME ZONE 'America/Sao_Paulo')
         - CASE WHEN EXTRACT(hour FROM (c.created_at AT TIME ZONE 'America/Sao_Paulo')) < 8
                THEN interval '1 day' ELSE interval '0' END
       )::date
     )
    WHERE c.house_id = p_house
  )
  SELECT eff_event_id AS event_id,
         count(*) AS total,
         count(*) FILTER (WHERE NOT is_cortesia) AS pagantes,
         count(*) FILTER (WHERE is_cortesia) AS cortesias
  FROM ci
  WHERE eff_event_id IS NOT NULL
  GROUP BY eff_event_id;
$$;
