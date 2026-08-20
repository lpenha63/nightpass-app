
alter table public.events add column if not exists consumption_cents integer default 0;
alter table public.events add column if not exists production_cost_cents integer default 0;
