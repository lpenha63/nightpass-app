ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS list_locks jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.events.list_locks IS 'Suspensao de cadastro publico por tipo de lista: { casa: bool, promoters: bool, reservas: bool }';
