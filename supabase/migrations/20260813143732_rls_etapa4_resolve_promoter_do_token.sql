-- A política do portal do promoter consultava promoter_tokens dentro do USING.
-- Subconsulta em política roda com as permissões de quem chama, então ela também
-- passava pelo RLS de promoter_tokens — que acabamos de fechar — e voltava vazia:
-- o portal deixava de enxergar as próprias listas.
-- SECURITY DEFINER resolve o promoter do token sem expor a tabela.

CREATE OR REPLACE FUNCTION public.np_promoter() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.promoter_id FROM promoter_tokens t
  WHERE t.token = np_token() AND t.active
  LIMIT 1
$$;

DROP POLICY IF EXISTS pl_leitura_por_token ON promoter_lists;
CREATE POLICY pl_leitura_por_token ON promoter_lists
  FOR SELECT TO anon
  USING (
    np_token() IS NOT NULL
    AND (token = np_token() OR promoter_id = np_promoter())
  );

DROP POLICY IF EXISTS plg_leitura_por_token ON promoter_list_guests;
CREATE POLICY plg_leitura_por_token ON promoter_list_guests
  FOR SELECT TO anon
  USING (
    np_token() IS NOT NULL
    AND (
      invite_token = np_token()
      OR promoter_id = np_promoter()
      OR list_id IN (SELECT id FROM promoter_lists WHERE token = np_token())
    )
  );

-- O portal também cria listas: precisa poder inserir só para o promoter do token
DROP POLICY IF EXISTS anon_insert_promoter_lists ON promoter_lists;
CREATE POLICY pl_insert_pelo_portal ON promoter_lists
  FOR INSERT TO anon
  WITH CHECK (token IS NOT NULL AND promoter_id = np_promoter());
