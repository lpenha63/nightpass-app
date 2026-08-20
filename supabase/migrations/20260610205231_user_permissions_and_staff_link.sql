
ALTER TABLE house_users
  ADD COLUMN IF NOT EXISTS freelancer_id UUID REFERENCES freelancers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS allowed_pages TEXT[];

CREATE INDEX IF NOT EXISTS idx_house_users_freelancer ON house_users(freelancer_id);
