
ALTER TABLE reservation_guests ADD COLUMN IF NOT EXISTS confirmed boolean DEFAULT false;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS invite_message text;
