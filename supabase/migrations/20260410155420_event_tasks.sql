
CREATE TABLE IF NOT EXISTS event_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  house_id uuid NOT NULL,
  area text NOT NULL,
  area_icon text DEFAULT '📋',
  title text NOT NULL,
  description text,
  deadline timestamptz,
  assignee_name text,
  assignee_phone text,
  status text DEFAULT 'pending',
  notes text,
  token uuid DEFAULT gen_random_uuid(),
  freelancer_id uuid,
  estimated_cost_cents int,
  actual_cost_cents int,
  sort_order int DEFAULT 0,
  completed_at timestamptz,
  completed_by text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_tasks_event_id_idx ON event_tasks(event_id);
CREATE INDEX IF NOT EXISTS event_tasks_token_idx ON event_tasks(token);
ALTER TABLE event_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "house members can manage event_tasks" ON event_tasks;
CREATE POLICY "house members can manage event_tasks"
  ON event_tasks FOR ALL
  USING (true) WITH CHECK (true);
