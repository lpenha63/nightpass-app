
-- Promoter tokens: anon pode ler para autenticar o portal
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_promoter_tokens' AND tablename = 'promoter_tokens') THEN
    CREATE POLICY public_read_promoter_tokens ON promoter_tokens FOR SELECT TO anon USING (active = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_promoters' AND tablename = 'promoters') THEN
    CREATE POLICY public_read_promoters ON promoters FOR SELECT TO anon USING (status = 'ativo');
  END IF;
  -- Birthday lists: anon pode ler pelo token
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_birthday_lists' AND tablename = 'birthday_lists') THEN
    CREATE POLICY public_read_birthday_lists ON birthday_lists FOR SELECT TO anon USING (token IS NOT NULL);
  END IF;
  -- Birthday list guests: anon pode inserir e ler
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_insert_birthday_list_guests' AND tablename = 'birthday_list_guests') THEN
    CREATE POLICY public_insert_birthday_list_guests ON birthday_list_guests FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_select_birthday_list_guests' AND tablename = 'birthday_list_guests') THEN
    CREATE POLICY public_select_birthday_list_guests ON birthday_list_guests FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- event_id na tabela birthday_list_guests (para check-in)
ALTER TABLE birthday_list_guests ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE birthday_list_guests ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;
