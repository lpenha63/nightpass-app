-- Contador de equipe por evento para o card de Eventos.
-- Agrega no servidor (como event_list_guest_stats): buscar linha a linha estouraria
-- o teto de 1000 do PostgREST e os eventos além do corte viriam com menos gente.
-- Sem SECURITY DEFINER de propósito: o RLS do chamador continua valendo, então
-- uma casa não consegue ler a escala de outra passando outro p_house.
CREATE OR REPLACE FUNCTION public.event_team_stats(p_house uuid)
RETURNS TABLE(event_id uuid, escalados bigint, confirmados bigint, por_area jsonb)
LANGUAGE sql STABLE AS $function$
  WITH base AS (
    -- mesma regra do roleOf() da tela: área da escala, senão a 1ª área do cadastro
    SELECT ef.event_id AS eid,
           COALESCE(NULLIF(ef.role, ''), f.work_types[1], 'outros') AS area,
           COALESCE(ef.confirmed, false) AS confirmed
    FROM event_freelancers ef
    JOIN events e ON e.id = ef.event_id
    LEFT JOIN freelancers f ON f.id = ef.freelancer_id
    WHERE e.house_id = p_house
  ), por AS (
    SELECT eid, area, count(*) AS n FROM base GROUP BY eid, area
  )
  SELECT b.eid,
         count(*),
         count(*) FILTER (WHERE b.confirmed),
         (SELECT jsonb_object_agg(p.area, p.n) FROM por p WHERE p.eid = b.eid)
  FROM base b
  GROUP BY b.eid;
$function$;

GRANT EXECUTE ON FUNCTION public.event_team_stats(uuid) TO authenticated;
