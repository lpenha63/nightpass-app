-- Quem trouxe essa pessoa? Atribuicao de entrada ao promoter.
--
-- `checkins.promoter_id` existe, com chave estrangeira, e estava NULA em 100% dos
-- registros: ninguem nunca a preencheu. Resultado: a casa paga 9 promoters por
-- comissao e taxa de entrada sem ter como medir quanto publico cada um levou.
--
-- Nao basta preencher no caminho da lista. Em 29/09 havia 92 convidados em listas,
-- a portaria fez 65 entradas e apenas 10 sairam pelo caminho da lista — as outras
-- 55 entraram pela busca de clientes. Corrigir so aquele ponto do codigo deixaria
-- de fora justamente a maioria.
--
-- Por isso a atribuicao e um GATILHO: vale para qualquer caminho de entrada, hoje
-- e nos que vierem. Casa por cliente e, se nao achar, por telefone (so os digitos)
-- — o convidado se cadastra na lista com telefone antes de existir como cliente.
--
-- De quebra marca o convidado como presente. Era isso que fazia a lista da portaria
-- mostrar 14 de 65 presentes numa noite de 70 entradas.

-- Sem indice por evento a busca do gatilho varre a tabela a cada check-in.
CREATE INDEX IF NOT EXISTS plg_evento_cliente_idx
  ON public.promoter_list_guests (event_id, client_id);
CREATE INDEX IF NOT EXISTS plg_evento_idx
  ON public.promoter_list_guests (event_id);
CREATE INDEX IF NOT EXISTS checkins_evento_promoter_idx
  ON public.checkins (event_id, promoter_id);

CREATE OR REPLACE FUNCTION public.checkin_atribui_promoter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  tel text;
  g   record;
BEGIN
  -- Ja atribuido (ou entrada de bar, sem evento): nada a fazer.
  IF NEW.promoter_id IS NOT NULL OR NEW.event_id IS NULL THEN RETURN NEW; END IF;

  SELECT regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')
    INTO tel
    FROM clients c WHERE c.id = NEW.client_id;

  SELECT pg.id, pg.promoter_id, pg.checked_in
    INTO g
    FROM promoter_list_guests pg
   WHERE pg.event_id = NEW.event_id
     AND pg.promoter_id IS NOT NULL
     AND (
          (NEW.client_id IS NOT NULL AND pg.client_id = NEW.client_id)
       OR (COALESCE(tel, '') <> '' AND regexp_replace(COALESCE(pg.phone, ''), '\D', '', 'g') = tel)
     )
   -- Casar pelo cliente e mais forte que pelo telefone (telefone se repete em casal,
   -- em grupo e em quem cadastra o convidado pelo proprio numero).
   ORDER BY (pg.client_id IS NOT DISTINCT FROM NEW.client_id) DESC, pg.id
   LIMIT 1;

  IF g.id IS NULL THEN RETURN NEW; END IF;

  NEW.promoter_id := g.promoter_id;

  IF NOT COALESCE(g.checked_in, false) THEN
    UPDATE promoter_list_guests
       SET checked_in    = true,
           checked_in_at = COALESCE(checked_in_at, now()),
           client_id     = COALESCE(client_id, NEW.client_id)
     WHERE id = g.id;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_checkin_atribui_promoter ON public.checkins;
CREATE TRIGGER trg_checkin_atribui_promoter
  BEFORE INSERT ON public.checkins
  FOR EACH ROW EXECUTE FUNCTION public.checkin_atribui_promoter();

COMMENT ON FUNCTION public.checkin_atribui_promoter() IS
  'Liga o check-in ao promoter que trouxe a pessoa (por cliente, senao por telefone) e marca o convidado como presente. Vale para qualquer caminho de entrada.';
