
-- "Visita" = noite distinta que o cliente frequentou:
--   check-in com evento  → conta 1 por evento (clique duplo no mesmo evento não infla)
--   check-in sem evento  → conta 1 por data (noite no bar/entrada livre)
CREATE OR REPLACE FUNCTION client_visit_counts_for(p_house uuid, p_ids uuid[])
RETURNS TABLE(client_id uuid, visits bigint)
LANGUAGE sql STABLE AS $$
  SELECT client_id,
         count(DISTINCT COALESCE(event_id::text,
               'd:' || ((created_at AT TIME ZONE 'America/Sao_Paulo')::date)::text)) AS visits
  FROM checkins
  WHERE house_id = p_house AND client_id = ANY(p_ids)
  GROUP BY client_id;
$$;

-- versão global (usada em outras telas) com a mesma regra
CREATE OR REPLACE FUNCTION client_visit_counts(p_house uuid)
RETURNS TABLE(client_id uuid, visits bigint)
LANGUAGE sql STABLE AS $$
  SELECT client_id,
         count(DISTINCT COALESCE(event_id::text,
               'd:' || ((created_at AT TIME ZONE 'America/Sao_Paulo')::date)::text)) AS visits
  FROM checkins
  WHERE house_id = p_house AND client_id IS NOT NULL
  GROUP BY client_id;
$$;
