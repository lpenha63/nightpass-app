-- Etapa 4 (parte 2): fecha a LEITURA aberta dos dados de convidados.
--
-- Antes: SELECT anon com qual=true → dava para baixar 2.520 convidados de reserva e
-- 1.741 de lista, com nome e telefone, usando só a chave anon que está no site.
--
-- Agora: a página pública manda o token do próprio link no cabeçalho x-np-token, e o
-- RLS só devolve as linhas daquele link. Sem cabeçalho não vem nada — acaba a enumeração.
-- Escolhi cabeçalho em vez de RPC porque as páginas (inclusive a lista.html estática)
-- fazem consultas variadas; assim nenhuma consulta precisa ser reescrita.

CREATE OR REPLACE FUNCTION public.np_token() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(
    COALESCE(current_setting('request.headers', true), '{}')::json ->> 'x-np-token',
  '')
$$;

-- ── reservas: convidados visíveis só para quem tem o token da reserva ──
DROP POLICY IF EXISTS public_select_reservation_guests ON reservation_guests;
CREATE POLICY rg_leitura_por_token ON reservation_guests
  FOR SELECT TO anon
  USING (
    np_token() IS NOT NULL
    AND reservation_id IN (SELECT id FROM reservations WHERE token = np_token())
  );

-- ── aniversário ──
DROP POLICY IF EXISTS public_select_birthday_list_guests ON birthday_list_guests;
CREATE POLICY blg_leitura_por_token ON birthday_list_guests
  FOR SELECT TO anon
  USING (
    np_token() IS NOT NULL
    AND birthday_list_id IN (SELECT id FROM birthday_lists WHERE token = np_token())
  );

-- ── listas de promoter: dois caminhos legítimos ──
--    1) o convidado abrindo o próprio convite (/confirmar/:token)
--    2) o promoter no portal dele (/p/:token), vendo as listas que são suas
DROP POLICY IF EXISTS public_select_promoter_list_guests ON promoter_list_guests;
CREATE POLICY plg_leitura_por_token ON promoter_list_guests
  FOR SELECT TO anon
  USING (
    np_token() IS NOT NULL
    AND (
      invite_token = np_token()
      OR list_id IN (
        SELECT l.id FROM promoter_lists l
        JOIN promoter_tokens t ON t.promoter_id = l.promoter_id AND t.house_id = l.house_id
        WHERE t.token = np_token() AND t.active
      )
    )
  );
