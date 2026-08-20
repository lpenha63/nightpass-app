
CREATE POLICY clients_delete ON clients FOR DELETE TO public
USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = clients.house_id AND hu.user_id = auth.uid() AND hu.is_active = true));

ALTER TABLE whatsapp_logs DROP CONSTRAINT whatsapp_logs_related_client_id_fkey,
  ADD CONSTRAINT whatsapp_logs_related_client_id_fkey FOREIGN KEY (related_client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE birthday_lists DROP CONSTRAINT birthday_lists_birthday_person_id_fkey,
  ADD CONSTRAINT birthday_lists_birthday_person_id_fkey FOREIGN KEY (birthday_person_id) REFERENCES clients(id) ON DELETE SET NULL;
