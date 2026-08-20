
-- Token por lista (por evento+promoter)
ALTER TABLE promoter_lists ADD COLUMN IF NOT EXISTS token text UNIQUE;

-- Gera token para listas existentes
UPDATE promoter_lists SET token = gen_random_uuid()::text WHERE token IS NULL;

-- Garante que novas listas sempre terão token
ALTER TABLE promoter_lists ALTER COLUMN token SET DEFAULT gen_random_uuid()::text;

-- RLS: público pode ler lista pelo token e inserir convidados
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_select_promoter_lists_by_token' AND tablename = 'promoter_lists') THEN
    CREATE POLICY public_select_promoter_lists_by_token ON promoter_lists
      FOR SELECT TO anon USING (token IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_insert_promoter_list_guests' AND tablename = 'promoter_list_guests') THEN
    CREATE POLICY public_insert_promoter_list_guests ON promoter_list_guests
      FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_select_promoter_list_guests' AND tablename = 'promoter_list_guests') THEN
    CREATE POLICY public_select_promoter_list_guests ON promoter_list_guests
      FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- client_id na lista de convidados (para linkar após check-in)
ALTER TABLE promoter_list_guests ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;
