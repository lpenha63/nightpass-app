-- birthday_lists: exclusão pelo membro da casa (o app deleta em Birthdays.tsx, faltava política DELETE)
DROP POLICY IF EXISTS birthday_lists_delete ON birthday_lists;
CREATE POLICY birthday_lists_delete ON birthday_lists
  FOR DELETE
  USING (EXISTS (SELECT 1 FROM house_users hu
    WHERE hu.house_id = birthday_lists.house_id AND hu.user_id = auth.uid() AND hu.is_active = true));

-- birthday_list_guests: membro da casa remove convidado (admin)
DROP POLICY IF EXISTS birthday_list_guests_delete ON birthday_list_guests;
CREATE POLICY birthday_list_guests_delete ON birthday_list_guests
  FOR DELETE
  USING (EXISTS (SELECT 1 FROM house_users hu
    WHERE hu.house_id = birthday_list_guests.house_id AND hu.user_id = auth.uid() AND hu.is_active = true));

-- birthday_list_guests: o aniversariante (portal público via token) remove convidado que adicionou.
-- Escopado a listas com token (não é DELETE aberto a qualquer linha).
DROP POLICY IF EXISTS public_delete_birthday_list_guests ON birthday_list_guests;
CREATE POLICY public_delete_birthday_list_guests ON birthday_list_guests
  FOR DELETE
  USING (EXISTS (SELECT 1 FROM birthday_lists bl
    WHERE bl.id = birthday_list_guests.birthday_list_id AND bl.token IS NOT NULL));
