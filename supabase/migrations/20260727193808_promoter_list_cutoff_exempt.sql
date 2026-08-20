-- Lista VIP "sem horário": sempre grátis, ignora a virada de preço do evento
ALTER TABLE promoter_lists ADD COLUMN IF NOT EXISTS cutoff_exempt boolean NOT NULL DEFAULT false;
