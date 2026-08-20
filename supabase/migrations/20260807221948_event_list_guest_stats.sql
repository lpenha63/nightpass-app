-- A contagem de convidados de lista por evento era feita buscando TODAS as linhas de
-- promoter_list_guests e somando no cliente. Com 1685 linhas o PostgREST cortava em 1000
-- e os eventos além do corte apareciam com menos convidados do que têm.
-- Mesma solução já usada em event_checkin_stats: agrega no servidor.
CREATE OR REPLACE FUNCTION public.event_list_guest_stats(p_house uuid)
RETURNS TABLE (event_id uuid, convidados bigint)
LANGUAGE sql STABLE
AS $function$
  SELECT g.event_id, count(*) AS convidados
  FROM promoter_list_guests g
  JOIN events e ON e.id = g.event_id
  WHERE e.house_id = p_house
  GROUP BY g.event_id;
$function$;
