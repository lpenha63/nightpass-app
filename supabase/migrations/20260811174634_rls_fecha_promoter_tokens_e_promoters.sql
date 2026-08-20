-- promoter_tokens tinha SELECT aberto (public/true e anon/active=true): dava para
-- LISTAR todos os tokens de portal. Com um token qualquer, um estranho entra no portal
-- do promoter e vê/edita as listas dele — inclusive telefone dos convidados.
-- promoters tinha SELECT public/true: nome, telefone e CPF de todos os promoters.
--
-- Passa a ser acessível só por token exato, via RPC (mesmo padrão dos ingressos).

CREATE OR REPLACE FUNCTION public.get_promoter_by_token(p_token text)
RETURNS TABLE (
  promoter_id uuid, house_id uuid,
  full_name text, photo_url text, phone text, status text,
  house_name text, house_logo text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.house_id, p.full_name, p.photo_url, p.phone, p.status, h.name, h.logo_url
  FROM promoter_tokens t
  JOIN promoters p ON p.id = t.promoter_id
  JOIN houses    h ON h.id = t.house_id
  WHERE t.token = p_token
    AND t.active
    AND COALESCE(p.status, 'active') <> 'inactive';
$$;

REVOKE ALL ON FUNCTION public.get_promoter_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_promoter_by_token(text) TO anon, authenticated;

-- Fecha a enumeração
DROP POLICY IF EXISTS token_public_read        ON promoter_tokens;
DROP POLICY IF EXISTS public_read_promoter_tokens ON promoter_tokens;
DROP POLICY IF EXISTS promoters_public_read    ON promoters;
DROP POLICY IF EXISTS public_read_promoters    ON promoters;

-- Inserção de promoter estava aberta a qualquer um (INSERT public, sem WITH CHECK).
-- Restringe a membro ativo da casa.
DROP POLICY IF EXISTS promoters_insert ON promoters;
CREATE POLICY promoters_insert_membro ON promoters
  FOR INSERT TO authenticated
  WITH CHECK (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid() AND is_active));
