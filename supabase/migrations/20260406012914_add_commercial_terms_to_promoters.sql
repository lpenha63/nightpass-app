
ALTER TABLE promoters
  ADD COLUMN IF NOT EXISTS fixed_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_entries integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entry_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consumacao_cents integer NOT NULL DEFAULT 0;
