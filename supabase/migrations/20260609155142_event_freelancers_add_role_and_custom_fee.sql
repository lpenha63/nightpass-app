ALTER TABLE public.event_freelancers
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS custom_fee_cents integer;
