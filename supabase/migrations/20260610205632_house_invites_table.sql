
CREATE TABLE IF NOT EXISTS house_invites (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  house_id      UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operador',
  freelancer_id UUID REFERENCES freelancers(id) ON DELETE SET NULL,
  allowed_pages TEXT[],
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  used_at       TIMESTAMPTZ
);

ALTER TABLE house_invites ENABLE ROW LEVEL SECURITY;

-- Admins manage invites for their house
CREATE POLICY "admins manage invites" ON house_invites
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM house_users
      WHERE user_id = auth.uid()
        AND house_id = house_invites.house_id
        AND role IN ('super_admin','admin')
        AND is_active = true
    )
  );

-- Users can read invites sent to their email
CREATE POLICY "users read own invites" ON house_invites
  FOR SELECT USING (invited_email = lower(auth.email()));
