ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS promoter_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promoter_price_mode text NOT NULL DEFAULT 'list',
  ADD COLUMN IF NOT EXISTS promoter_price_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotions_list jsonb NOT NULL DEFAULT '[]'::jsonb;
