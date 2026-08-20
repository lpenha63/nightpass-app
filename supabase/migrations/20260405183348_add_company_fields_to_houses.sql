
ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS cnpj         text,
  ADD COLUMN IF NOT EXISTS logo_url     text,
  ADD COLUMN IF NOT EXISTS phone        text,
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS website      text,
  ADD COLUMN IF NOT EXISTS address      text,
  ADD COLUMN IF NOT EXISTS city         text,
  ADD COLUMN IF NOT EXISTS state        text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('logos', 'logos', true, 2097152, ARRAY['image/jpeg','image/png','image/webp','image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth users can upload logos' AND tablename = 'objects') THEN
    CREATE POLICY "auth users can upload logos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'logos are public' AND tablename = 'objects') THEN
    CREATE POLICY "logos are public" ON storage.objects FOR SELECT TO public USING (bucket_id = 'logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth users can update logos' AND tablename = 'objects') THEN
    CREATE POLICY "auth users can update logos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth users can delete logos' AND tablename = 'objects') THEN
    CREATE POLICY "auth users can delete logos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'logos');
  END IF;
END $$;
