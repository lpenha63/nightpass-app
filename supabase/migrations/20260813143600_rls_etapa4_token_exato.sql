-- Ainda restavam políticas com "token IS NOT NULL": isso libera TODAS as linhas cujo
-- pai tem token — ou seja, praticamente tudo. Como as políticas são somadas (OR),
-- elas anulavam o fechamento feito antes. Passam a exigir o token exato do link.

-- reservas
DROP POLICY IF EXISTS "public can read reservations by token" ON reservations;
DROP POLICY IF EXISTS public_select_reservations_by_token     ON reservations;
CREATE POLICY reservas_leitura_por_token ON reservations
  FOR SELECT TO anon
  USING (np_token() IS NOT NULL AND token = np_token());

-- convidados da reserva: o titular gerencia pelo link, mas só os da reserva dele
DROP POLICY IF EXISTS "public can manage guests via token" ON reservation_guests;
CREATE POLICY rg_gestao_por_token ON reservation_guests
  FOR ALL TO anon
  USING (
    np_token() IS NOT NULL
    AND reservation_id IN (SELECT id FROM reservations WHERE token = np_token())
  )
  WITH CHECK (
    np_token() IS NOT NULL
    AND reservation_id IN (SELECT id FROM reservations WHERE token = np_token())
  );

-- aniversário: lista e convidados
DROP POLICY IF EXISTS "public can read birthday_lists by token" ON birthday_lists;
DROP POLICY IF EXISTS public_read_birthday_lists               ON birthday_lists;
CREATE POLICY bl_leitura_por_token ON birthday_lists
  FOR SELECT TO anon
  USING (np_token() IS NOT NULL AND token = np_token());

DROP POLICY IF EXISTS "public can manage birthday guests via token" ON birthday_guests;
CREATE POLICY bg_gestao_por_token ON birthday_guests
  FOR ALL TO anon
  USING (
    np_token() IS NOT NULL
    AND birthday_list_id IN (SELECT id FROM birthday_lists WHERE token = np_token())
  )
  WITH CHECK (
    np_token() IS NOT NULL
    AND birthday_list_id IN (SELECT id FROM birthday_lists WHERE token = np_token())
  );

-- listas de promoter: o link /lista/:token e o portal do promoter
DROP POLICY IF EXISTS public_select_promoter_lists_by_token ON promoter_lists;
CREATE POLICY pl_leitura_por_token ON promoter_lists
  FOR SELECT TO anon
  USING (
    np_token() IS NOT NULL
    AND (
      token = np_token()
      OR EXISTS (SELECT 1 FROM promoter_tokens t
                  WHERE t.token = np_token() AND t.active
                    AND t.promoter_id = promoter_lists.promoter_id
                    AND t.house_id = promoter_lists.house_id)
    )
  );
