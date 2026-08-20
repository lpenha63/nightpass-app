-- Etapa 4 (parte 1): tira a ESCRITA aberta nas tabelas de convidados.
--
-- Situação encontrada:
--   promoter_list_guests.guests_open        → ALL / public / true  = qualquer um lê, altera e APAGA
--   reservation_guests.auth_manage_...      → ALL / authenticated / true = usuário logado de
--                                             QUALQUER casa mexe nos convidados de todas as outras
--   promoter_lists.promoter_lists_public_*  → SELECT e INSERT abertos a todos
--
-- Essas tabelas não tinham política de membro da casa: o app logado se apoiava justamente
-- na política aberta. Por isso as corretas são criadas ANTES de remover as antigas.

-- 1) Acesso legítimo do app: membro ativo da casa
CREATE POLICY plg_membros_da_casa ON promoter_list_guests
  FOR ALL TO authenticated
  USING (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid() AND is_active))
  WITH CHECK (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid() AND is_active));

CREATE POLICY pl_membros_da_casa ON promoter_lists
  FOR ALL TO authenticated
  USING (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid() AND is_active))
  WITH CHECK (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid() AND is_active));

-- 2) Remove as aberturas de escrita
--    O portal do promoter (anônimo) continua funcionando: ler por token, inserir e
--    confirmar presença seguem cobertos por políticas próprias, já existentes.
DROP POLICY IF EXISTS guests_open ON promoter_list_guests;
DROP POLICY IF EXISTS auth_manage_reservation_guests ON reservation_guests;
DROP POLICY IF EXISTS promoter_lists_public_insert ON promoter_lists;
DROP POLICY IF EXISTS promoter_lists_public_read ON promoter_lists;
