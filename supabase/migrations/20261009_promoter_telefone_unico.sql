-- Promoter: o mesmo telefone nao pode ser cadastrado duas vezes na mesma casa.
--
-- Por que gatilho e nao UNIQUE INDEX: a Vila Beats ja tem OITO promoters dividindo
-- o numero 77998027818 — Luizinho (11 listas, 464 convidados), Laços da Batucada,
-- Santo Batuk, Nilzinha e outros. Um indice unico nao poderia nem ser criado sem
-- antes apagar ou fundir esse historico, e isso nao e decisao de migration.
--
-- O gatilho resolve o que foi pedido sem destruir nada: trava o cadastro NOVO e
-- deixa o passado em paz. Dentro daqueles oito ha um duplicado de verdade
-- ("Nilzinha" e "Nilzinha ") — esse e caso de fusao manual, nao de constraint.
--
-- Fica no banco, e nao so na tela, porque a tela e um dos caminhos: importacao,
-- outro painel ou um script entrariam por baixo de qualquer checagem em React.

CREATE OR REPLACE FUNCTION public.promoter_telefone_unico()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  tel text;
  conflito text;
BEGIN
  -- So os digitos: "(11) 99999-9999" e "11999999999" sao o mesmo telefone.
  tel := regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g');

  -- Sem telefone nao ha o que comparar. A "Lista da Casa" nasce assim, de proposito.
  IF tel = '' THEN RETURN NEW; END IF;

  -- So checa quando o telefone ENTRA ou MUDA. Sem isto, editar o nome ou a comissao
  -- de um dos oito cadastros antigos passaria pela checagem e seria recusado — o
  -- usuario ficaria preso num registro que ele nem estava tentando duplicar.
  IF TG_OP = 'UPDATE'
     AND tel = regexp_replace(COALESCE(OLD.phone, ''), '\D', '', 'g') THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name INTO conflito
    FROM promoters p
   WHERE p.house_id = NEW.house_id
     AND p.id <> NEW.id
     AND regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') = tel
   ORDER BY p.created_at
   LIMIT 1;

  IF conflito IS NOT NULL THEN
    -- 23505 = unique_violation: o PostgREST devolve 409 e a tela reconhece o caso.
    RAISE EXCEPTION 'Este telefone já está cadastrado para o promoter "%".', conflito
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_promoter_telefone_unico ON public.promoters;
CREATE TRIGGER trg_promoter_telefone_unico
  BEFORE INSERT OR UPDATE OF phone ON public.promoters
  FOR EACH ROW EXECUTE FUNCTION public.promoter_telefone_unico();

COMMENT ON FUNCTION public.promoter_telefone_unico() IS
  'Impede dois promoters com o mesmo telefone na mesma casa. So vale para cadastro novo ou troca de telefone — duplicatas anteriores a 09/10/2026 seguem intactas.';
