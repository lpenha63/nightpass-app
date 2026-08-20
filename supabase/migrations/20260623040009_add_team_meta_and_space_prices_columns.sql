ALTER TABLE public.team_ratings ADD COLUMN IF NOT EXISTS criteria jsonb;
ALTER TABLE public.freelancers ADD COLUMN IF NOT EXISTS work_meta jsonb;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS space_prices jsonb;
