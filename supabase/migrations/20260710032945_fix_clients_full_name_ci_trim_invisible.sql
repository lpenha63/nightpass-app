
DROP INDEX IF EXISTS idx_clients_full_name_ci;
ALTER TABLE clients DROP COLUMN full_name_ci;
ALTER TABLE clients ADD COLUMN full_name_ci text
  GENERATED ALWAYS AS (
    lower(trim(both from regexp_replace(full_name, '[​‌‍⁠﻿]', '', 'g')))
  ) STORED;
CREATE INDEX idx_clients_full_name_ci ON clients (house_id, full_name_ci);
