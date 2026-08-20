
-- Add missing columns to reservation_guests
ALTER TABLE reservation_guests
  ADD COLUMN IF NOT EXISTS phone      text,
  ADD COLUMN IF NOT EXISTS cpf        text,
  ADD COLUMN IF NOT EXISTS client_id  uuid REFERENCES clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checked_in boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS house_id   uuid REFERENCES houses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS event_id   uuid REFERENCES events(id) ON DELETE CASCADE;

-- RLS: public can insert guests via token (no auth needed for the public form)
ALTER TABLE reservation_guests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_insert_reservation_guests' AND tablename = 'reservation_guests') THEN
    CREATE POLICY public_insert_reservation_guests ON reservation_guests
      FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_select_reservation_guests' AND tablename = 'reservation_guests') THEN
    CREATE POLICY public_select_reservation_guests ON reservation_guests
      FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'auth_manage_reservation_guests' AND tablename = 'reservation_guests') THEN
    CREATE POLICY auth_manage_reservation_guests ON reservation_guests
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Also ensure reservations are readable by anon (for the public page)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_select_reservations_by_token' AND tablename = 'reservations') THEN
    CREATE POLICY public_select_reservations_by_token ON reservations
      FOR SELECT TO anon USING (token IS NOT NULL);
  END IF;
END $$;
