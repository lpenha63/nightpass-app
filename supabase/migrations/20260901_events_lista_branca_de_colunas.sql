-- `events` precisa continuar legivel por anonimo: as paginas de compra de ingresso,
-- de lista e de convite mostram nome, data, horario, flyer e precos. Mas a leitura
-- vinha da tabela INTEIRA — 45 colunas —, e ali dentro moram o cache de cada atracao,
-- as notas internas de producao, os termos de parceria e os custos do evento.
-- Verificado nos dados reais: cache de R$ 1.400 e R$ 4.530 estavam publicos.
--
-- RLS nao resolve: ela filtra LINHAS, e o problema e de COLUNA.
--
-- Primeira tentativa foi REVOKE SELECT (colunas) FROM anon, e NAO surtiu efeito: no
-- Postgres, concessao de SELECT no nivel da TABELA nao e cortada por revogacao de
-- coluna. O jeito correto e o inverso — tirar o SELECT da tabela e conceder apenas a
-- lista branca. Isso tem uma propriedade que a revogacao nao teria: COLUNA NOVA NASCE
-- PRIVADA. No desenho antigo, adicionar uma coluna sensivel a tornaria publica sem
-- ninguem perceber.
--
-- Depende do commit que fez as paginas publicas pedirem colunas explicitas e trocarem
-- `artists` por `artists_public`. Sem ele, isto quebra a venda de ingresso.

-- Somente os nomes das atracoes, para as paginas publicas.
CREATE OR REPLACE FUNCTION public.artistas_sem_valores(a jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    jsonb_agg(x - 'fee_cents' - 'consumption_cents' - 'fee_type' - 'fee_percent'),
    '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(a, '[]'::jsonb)) x
$$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS artists_public jsonb
  GENERATED ALWAYS AS (public.artistas_sem_valores(artists)) STORED;

COMMENT ON COLUMN public.events.artists_public IS
  'Somente os nomes das atracoes. E esta coluna que as paginas publicas leem — artists guarda cache e consumacao e fica restrita.';

REVOKE SELECT ON public.events FROM anon;

GRANT SELECT (
  id, created_at, updated_at, house_id, name, event_date,
  start_time, end_time, genre, status, is_operation,
  flyer_url, capacity, attractions, artists_public,
  promotions, promotions_list,
  price_male_cents, price_female_cents,
  price_male_list_cents, price_female_list_cents,
  price_male_list_early_cents, price_female_list_early_cents,
  list_cutoff_time,
  list_locks, house_list_enabled, birthday_list_enabled
) ON public.events TO anon;

COMMENT ON TABLE public.events IS
  'anon enxerga apenas a lista branca de colunas concedida. Cache de atracao, notas internas, termos de parceria e custos ficam fora. Coluna nova nasce privada: para expo-la ao publico e preciso conceder explicitamente.';
