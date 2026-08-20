
CREATE TABLE IF NOT EXISTS checkin_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  default_price_cents INTEGER DEFAULT 0,
  color TEXT DEFAULT '#3b82f6',
  icon TEXT DEFAULT '🎟️',
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE checkins ADD COLUMN IF NOT EXISTS checkin_type_id UUID REFERENCES checkin_types(id);

ALTER TABLE checkin_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "house_users_checkin_types" ON checkin_types
  FOR ALL USING (
    house_id IN (
      SELECT house_id FROM house_users WHERE user_id = auth.uid()
    )
  );
