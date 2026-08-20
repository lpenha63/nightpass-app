-- ETAPA 2: impedir que um usuário altere dados de OUTRA casa.
-- Mantém SELECT público (páginas de lista/reserva/ingresso dependem) e o INSERT anônimo
-- de promoter_lists (o portal do promoter cria listas sem login).

-- houses
DROP POLICY IF EXISTS houses_open ON houses;
CREATE POLICY houses_public_read ON houses FOR SELECT TO public USING (true);
CREATE POLICY houses_member_write ON houses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = houses.id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = houses.id AND hu.user_id = auth.uid() AND hu.is_active));

-- promoters
DROP POLICY IF EXISTS promoters_open ON promoters;
CREATE POLICY promoters_public_read ON promoters FOR SELECT TO public USING (true);
CREATE POLICY promoters_member_write ON promoters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = promoters.house_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = promoters.house_id AND hu.user_id = auth.uid() AND hu.is_active));

-- events
DROP POLICY IF EXISTS events_open ON events;
CREATE POLICY events_public_read ON events FOR SELECT TO public USING (true);
CREATE POLICY events_member_write ON events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = events.house_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = events.house_id AND hu.user_id = auth.uid() AND hu.is_active));

-- promoter_lists: anon precisa ler e CRIAR (portal do promoter); alterar/apagar só membro
DROP POLICY IF EXISTS promoter_lists_open ON promoter_lists;
CREATE POLICY promoter_lists_public_read ON promoter_lists FOR SELECT TO public USING (true);
CREATE POLICY promoter_lists_public_insert ON promoter_lists FOR INSERT TO public WITH CHECK (true);
CREATE POLICY promoter_lists_member_update ON promoter_lists FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = promoter_lists.house_id AND hu.user_id = auth.uid() AND hu.is_active));
CREATE POLICY promoter_lists_member_delete ON promoter_lists FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = promoter_lists.house_id AND hu.user_id = auth.uid() AND hu.is_active));

-- promoter_tokens: leitura pública (login do portal por token); escrita só membro
DROP POLICY IF EXISTS token_service_write ON promoter_tokens;
CREATE POLICY promoter_tokens_member_write ON promoter_tokens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = promoter_tokens.house_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = promoter_tokens.house_id AND hu.user_id = auth.uid() AND hu.is_active));
