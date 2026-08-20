-- Virada de preço POR LISTA (ex.: "VIP até 20:30, depois R$ 20").
-- Antes só existia no evento (valia para todas as listas).
-- Até o horário cobra early_*; depois cobra entry_fee_* (que já existe).
ALTER TABLE promoter_lists ADD COLUMN IF NOT EXISTS cutoff_time text;                       -- 'HH:MM' (nulo = sem virada própria)
ALTER TABLE promoter_lists ADD COLUMN IF NOT EXISTS early_male_cents   integer NOT NULL DEFAULT 0;
ALTER TABLE promoter_lists ADD COLUMN IF NOT EXISTS early_female_cents integer NOT NULL DEFAULT 0;
