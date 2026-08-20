
-- Agrega check-ins por dia (fuso São Paulo) no servidor — evita o limite de 1000 linhas.
CREATE OR REPLACE FUNCTION checkins_daily(p_house uuid, p_days int DEFAULT 30)
RETURNS TABLE(day text, n integer, rev integer)
LANGUAGE sql STABLE AS $$
  SELECT to_char((created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS day,
         count(*)::int AS n,
         coalesce(sum(CASE WHEN payment_method = 'cortesia' THEN 0 ELSE coalesce(amount_cents, 0) END), 0)::int AS rev
  FROM checkins
  WHERE house_id = p_house
    AND created_at >= (now() - make_interval(days => p_days))
  GROUP BY 1;
$$;
GRANT EXECUTE ON FUNCTION checkins_daily(uuid, int) TO authenticated, anon;
