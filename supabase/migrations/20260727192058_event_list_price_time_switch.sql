-- Virada de preço da lista por horário: até o horário cobra o valor "early" (0 = grátis/VIP),
-- depois cobra o preço de lista cheio já existente (price_*_list_cents).
ALTER TABLE events ADD COLUMN IF NOT EXISTS list_cutoff_time text;                 -- 'HH:MM' (nulo = sem virada)
ALTER TABLE events ADD COLUMN IF NOT EXISTS price_male_list_early_cents   integer NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS price_female_list_early_cents integer NOT NULL DEFAULT 0;
