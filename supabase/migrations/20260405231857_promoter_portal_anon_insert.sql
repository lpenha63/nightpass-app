
-- Allow anon to insert into promoter_lists (self-association via portal)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='promoter_lists' AND policyname='anon_insert_promoter_lists'
  ) THEN
    CREATE POLICY "anon_insert_promoter_lists" ON promoter_lists
      FOR INSERT TO anon WITH CHECK (token IS NOT NULL);
  END IF;
END $$;

-- Allow anon to read events (for promoter portal event browser)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='events' AND policyname='anon_read_events_public'
  ) THEN
    CREATE POLICY "anon_read_events_public" ON events
      FOR SELECT TO anon USING (status != 'cancelado');
  END IF;
END $$;
