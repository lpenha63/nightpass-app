
-- Tipos de reserva configuráveis por casa
CREATE TABLE IF NOT EXISTS reservation_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid REFERENCES houses(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text NOT NULL DEFAULT '🎉',
  color text NOT NULL DEFAULT '#3b82f6',
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reservation_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "house members manage reservation_types" ON reservation_types
  USING (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid()));

-- Itens/opcionais por reserva
CREATE TABLE IF NOT EXISTS reservation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE,
  house_id uuid REFERENCES houses(id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_cost_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reservation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "house members manage reservation_items" ON reservation_items
  USING (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid()));
-- Allow anon to insert reservation items (via public page)
CREATE POLICY "anon read reservation_items" ON reservation_items
  FOR SELECT USING (true);
