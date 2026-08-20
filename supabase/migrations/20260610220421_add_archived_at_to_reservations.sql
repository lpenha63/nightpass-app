
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

-- Index para a query de filtro ser rápida
CREATE INDEX IF NOT EXISTS idx_reservations_archived_at
  ON reservations (archived_at)
  WHERE archived_at IS NULL;
