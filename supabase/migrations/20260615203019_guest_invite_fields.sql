
ALTER TABLE promoter_list_guests
  ADD COLUMN IF NOT EXISTS invite_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS list_value_cents integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_plus_ones integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES promoter_list_guests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS plg_invite_token_idx ON promoter_list_guests(invite_token);
CREATE INDEX IF NOT EXISTS plg_invited_by_idx ON promoter_list_guests(invited_by);
