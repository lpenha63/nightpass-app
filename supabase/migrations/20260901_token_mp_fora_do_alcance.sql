-- O token de producao do Mercado Pago morava em houses.mp_access_token, e houses tem
-- politica de leitura publica (as paginas de ingresso mostram nome e endereco da casa).
-- RLS e por LINHA, nao por coluna: quem lia a linha lia o token junto. Verificado com a
-- chave anonima antes da correcao — o token vinha inteiro numa chamada REST comum.

CREATE TABLE IF NOT EXISTS public.house_secrets (
  house_id uuid PRIMARY KEY REFERENCES public.houses(id) ON DELETE CASCADE,
  mp_access_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS ligada e NENHUMA policy: pelo PostgREST ninguem le nem escreve, em nenhum papel.
-- So o service_role (que ignora RLS) enxerga — e ele so existe no servidor.
ALTER TABLE public.house_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.house_secrets FROM anon, authenticated;

INSERT INTO public.house_secrets (house_id, mp_access_token)
SELECT id, mp_access_token FROM public.houses WHERE mp_access_token IS NOT NULL
ON CONFLICT (house_id) DO NOTHING;

-- Leitura: so o SIM/NAO, nunca o valor.
CREATE OR REPLACE FUNCTION public.house_payment_status(p_house uuid)
RETURNS TABLE(tem_mp boolean, tem_pix boolean)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(s.mp_access_token, '') <> '',
         COALESCE(h.pix_key, '') <> ''
  FROM houses h
  LEFT JOIN house_secrets s ON s.house_id = h.id
  WHERE h.id = p_house
    AND EXISTS (SELECT 1 FROM house_users hu
                WHERE hu.house_id = h.id AND hu.user_id = auth.uid() AND hu.is_active);
$$;

-- Gravacao: so admin da casa, e a funcao nunca devolve o token.
CREATE OR REPLACE FUNCTION public.set_mp_token(p_house uuid, p_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM house_users hu
                 WHERE hu.house_id = p_house AND hu.user_id = auth.uid()
                   AND hu.is_active AND hu.role IN ('super_admin','admin')) THEN
    RAISE EXCEPTION 'Sem permissao para alterar o pagamento desta casa';
  END IF;
  INSERT INTO house_secrets (house_id, mp_access_token, updated_at)
  VALUES (p_house, NULLIF(btrim(p_token), ''), now())
  ON CONFLICT (house_id) DO UPDATE
    SET mp_access_token = EXCLUDED.mp_access_token, updated_at = now();
END $$;

GRANT EXECUTE ON FUNCTION public.house_payment_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_mp_token(uuid, text)  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.house_payment_status(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_mp_token(uuid, text)  FROM anon;

-- Enquanto a coluna existir em `houses`, ela volta a vazar no dia em que alguem
-- adicionar um select('*'). Remover e o que torna o conserto permanente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM houses h
    LEFT JOIN house_secrets s ON s.house_id = h.id
    WHERE h.mp_access_token IS NOT NULL
      AND (s.mp_access_token IS DISTINCT FROM h.mp_access_token)
  ) THEN
    ALTER TABLE public.houses DROP COLUMN IF EXISTS mp_access_token;
  ELSE
    RAISE EXCEPTION 'Abortado: existe token em houses que nao foi copiado para house_secrets';
  END IF;
END $$;
