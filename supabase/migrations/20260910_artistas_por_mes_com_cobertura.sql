-- Fechamento mes a mes: dizer de QUANTAS noites o numero fala.
--
-- A tabela mostrava "Agosto — 2 noites" e qualquer um le isso como "a casa teve 2
-- shows em agosto". Nao teve: teve 19 eventos, e apenas 2 com o line-up registrado
-- no campo `artists`. O numero estava certo; faltava dizer sobre o que ele fala.
--
-- Sem o denominador a tela nao tem como distinguir "mes fraco" de "mes nao
-- preenchido", e essas duas coisas pedem reacoes opostas do dono.
--
-- `eventos_mes` exclui dia de operacao: por definicao a casa abre sem atracao,
-- entao contar isso no denominador acusaria uma falta que nao existe.

-- O retorno ganha coluna, entao CREATE OR REPLACE nao serve: e preciso DROP antes.
-- Como o DROP leva junto os privilegios, eles sao refeitos no fim do arquivo.
DROP FUNCTION IF EXISTS public.artistas_por_mes(uuid, integer);

CREATE FUNCTION public.artistas_por_mes(p_house uuid, p_meses integer DEFAULT 12)
RETURNS TABLE(mes text, noites integer, eventos_mes integer,
              cache_cents bigint, consumacao_cents bigint, publico bigint,
              cache_por_pessoa_cents integer, portaria_por_pessoa_cents integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH base AS (
    SELECT to_char(e.event_date, 'YYYY-MM') AS m,
           (jsonb_array_length(COALESCE(e.artists, '[]'::jsonb)) > 0) AS tem_atracao,
           (SELECT COALESCE(sum(COALESCE((y->>'fee_cents')::int, 0)), 0)
              FROM jsonb_array_elements(COALESCE(e.artists, '[]'::jsonb)) y) AS cache,
           (SELECT COALESCE(sum(COALESCE((y->>'consumption_cents')::int, 0)), 0)
              FROM jsonb_array_elements(COALESCE(e.artists, '[]'::jsonb)) y) AS consumacao,
           (SELECT count(*) FROM checkins c WHERE c.event_id = e.id) AS publico,
           (SELECT COALESCE(sum(c.amount_cents), 0) FROM checkins c WHERE c.event_id = e.id) AS portaria
    FROM events e
    WHERE e.house_id = p_house
      AND e.status <> 'cancelado'
      AND NOT e.is_operation
      AND e.event_date >= (CURRENT_DATE - (p_meses || ' months')::interval)
      AND EXISTS (SELECT 1 FROM house_users hu
                  WHERE hu.house_id = p_house AND hu.user_id = auth.uid() AND hu.is_active)
  )
  SELECT m,
         count(*) FILTER (WHERE tem_atracao)::int                        AS noites,
         count(*)::int                                                   AS eventos_mes,
         COALESCE(sum(cache) FILTER (WHERE tem_atracao), 0)::bigint,
         COALESCE(sum(consumacao) FILTER (WHERE tem_atracao), 0)::bigint,
         COALESCE(sum(publico) FILTER (WHERE tem_atracao), 0)::bigint,
         CASE WHEN sum(publico) FILTER (WHERE tem_atracao) > 0
              THEN round(sum(cache) FILTER (WHERE tem_atracao)::numeric
                       / sum(publico) FILTER (WHERE tem_atracao))::int END,
         CASE WHEN sum(publico) FILTER (WHERE tem_atracao) > 0
              THEN round(sum(portaria) FILTER (WHERE tem_atracao)::numeric
                       / sum(publico) FILTER (WHERE tem_atracao))::int END
  FROM base
  GROUP BY m
  HAVING count(*) FILTER (WHERE tem_atracao) > 0
  ORDER BY m DESC;
$fn$;

-- Privilegios refeitos. Aproveitando o DROP, o EXECUTE sai de PUBLIC: a funcao e
-- SECURITY DEFINER e so a tela de gestao (autenticada) chama. O anonimo ja nao
-- tirava nada dela por causa da guarda de house_users, mas nao ha motivo para
-- deixar uma funcao que ignora RLS ao alcance de quem nao precisa.
REVOKE EXECUTE ON FUNCTION public.artistas_por_mes(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.artistas_por_mes(uuid, integer) TO authenticated, service_role;
