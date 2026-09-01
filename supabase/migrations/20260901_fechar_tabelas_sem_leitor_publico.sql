-- Quatro tabelas com politica de SELECT liberada para qualquer um (qual = true) e
-- NENHUMA pagina publica que as leia. Conferido no codigo: os unicos leitores sao
-- telas administrativas (Eventos, Reservas, Relatorios, Dashboard), autenticadas.
--
-- A pior era reservation_items: expunha `unit_cost_cents`, o CUSTO da casa por item —
-- ou seja, a margem de cada consumacao ficava publica.

DROP POLICY IF EXISTS "anon read reservation_items" ON public.reservation_items;

-- A politica de membro existia com WITH CHECK nulo; recriada explicita para que
-- INSERT/UPDATE tambem exijam a casa, e nao so a leitura.
DROP POLICY IF EXISTS "house members manage reservation_items" ON public.reservation_items;
CREATE POLICY "membros da casa gerenciam itens" ON public.reservation_items
  FOR ALL TO authenticated
  USING      (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid()))
  WITH CHECK (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid()));

-- Nomes de camarote, capacidade e preco interno nao precisam ser publicos: a escolha
-- de espaco acontece na tela administrativa, ao montar a reserva.
DROP POLICY IF EXISTS "house_spaces_select" ON public.house_spaces;

-- Tabelas orfas: nenhuma referencia no codigo e nenhuma linha. Ficam fechadas para
-- que, no dia em que alguem voltar a usa-las, nao nascam publicas.
DROP POLICY IF EXISTS "system_users_select" ON public.system_users;
DROP POLICY IF EXISTS "establishments_select" ON public.establishments;
