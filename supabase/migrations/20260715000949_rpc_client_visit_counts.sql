
-- Contagem de visitas (check-ins) por cliente — agregada no servidor para não bater
-- no limite de 1000 linhas que truncava a contagem no cliente.
CREATE OR REPLACE FUNCTION client_visit_counts(p_house uuid)
RETURNS TABLE(client_id uuid, visits bigint)
LANGUAGE sql STABLE AS $$
  SELECT client_id, count(*) AS visits
  FROM checkins
  WHERE house_id = p_house AND client_id IS NOT NULL
  GROUP BY client_id;
$$;
