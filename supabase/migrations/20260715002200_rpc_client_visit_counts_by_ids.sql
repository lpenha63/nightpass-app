
-- Visitas por cliente restrito a uma lista de ids (só os clientes visíveis na página),
-- evitando o limite de 1000 linhas quando a casa tem muitos clientes.
CREATE OR REPLACE FUNCTION client_visit_counts_for(p_house uuid, p_ids uuid[])
RETURNS TABLE(client_id uuid, visits bigint)
LANGUAGE sql STABLE AS $$
  SELECT client_id, count(*) AS visits
  FROM checkins
  WHERE house_id = p_house AND client_id = ANY(p_ids)
  GROUP BY client_id;
$$;
