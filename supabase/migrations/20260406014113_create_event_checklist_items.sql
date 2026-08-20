
CREATE TABLE IF NOT EXISTS event_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  house_id uuid REFERENCES houses(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'Geral',
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE event_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "house members manage checklist" ON event_checklist_items
  USING (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid()));
