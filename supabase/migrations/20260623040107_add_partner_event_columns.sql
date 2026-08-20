ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_partner_event boolean DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS partner_model text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS partner_fixed_cents integer DEFAULT 0;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS partner_terms text;
