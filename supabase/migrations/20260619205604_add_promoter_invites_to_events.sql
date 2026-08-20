ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS promoter_invites jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.events.promoter_invites IS 'IDs de promoters convidados especificamente para o evento (alem do promoter_enabled global)';
