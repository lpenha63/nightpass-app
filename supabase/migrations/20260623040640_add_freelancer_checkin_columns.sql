ALTER TABLE public.event_freelancers ADD COLUMN IF NOT EXISTS checkin_at timestamptz;
ALTER TABLE public.event_freelancers ADD COLUMN IF NOT EXISTS checkout_at timestamptz;
