
CREATE TABLE IF NOT EXISTS promoters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  commission_pct NUMERIC(5,2) DEFAULT 10,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promoters_house_id_idx ON promoters(house_id);

ALTER TABLE promoters ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promoters' AND policyname='promoters_select') THEN
    CREATE POLICY promoters_select ON promoters FOR SELECT USING (
      house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promoters' AND policyname='promoters_insert') THEN
    CREATE POLICY promoters_insert ON promoters FOR INSERT WITH CHECK (
      house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promoters' AND policyname='promoters_update') THEN
    CREATE POLICY promoters_update ON promoters FOR UPDATE USING (
      house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promoters' AND policyname='promoters_delete') THEN
    CREATE POLICY promoters_delete ON promoters FOR DELETE USING (
      house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid())
    );
  END IF;
END $$;
