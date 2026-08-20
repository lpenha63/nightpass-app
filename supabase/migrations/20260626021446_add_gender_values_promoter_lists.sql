
ALTER TABLE promoter_lists
  ADD COLUMN IF NOT EXISTS entry_fee_male_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entry_fee_female_cents integer NOT NULL DEFAULT 0;
