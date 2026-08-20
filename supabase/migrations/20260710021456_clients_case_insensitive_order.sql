
ALTER TABLE clients ADD COLUMN IF NOT EXISTS full_name_ci text GENERATED ALWAYS AS (lower(full_name)) STORED;
CREATE INDEX IF NOT EXISTS clients_name_ci_idx ON clients(house_id, full_name_ci);
