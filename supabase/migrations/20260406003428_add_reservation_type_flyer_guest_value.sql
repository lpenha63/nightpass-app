
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS reservation_type text,
  ADD COLUMN IF NOT EXISTS flyer_url text;

ALTER TABLE reservation_guests
  ADD COLUMN IF NOT EXISTS value_type text;
