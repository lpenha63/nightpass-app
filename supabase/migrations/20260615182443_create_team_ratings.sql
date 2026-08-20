
CREATE TABLE IF NOT EXISTS team_ratings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id      uuid NOT NULL,
  freelancer_id uuid NOT NULL REFERENCES freelancers(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       text,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (freelancer_id, event_id)
);

CREATE INDEX IF NOT EXISTS team_ratings_freelancer_idx ON team_ratings(freelancer_id);
CREATE INDEX IF NOT EXISTS team_ratings_event_idx ON team_ratings(event_id);
CREATE INDEX IF NOT EXISTS team_ratings_house_idx ON team_ratings(house_id);

ALTER TABLE team_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "house members can manage ratings"
  ON team_ratings FOR ALL
  USING (house_id IN (
    SELECT house_id FROM house_users WHERE user_id = auth.uid()
  ));
