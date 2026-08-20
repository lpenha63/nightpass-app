create table if not exists public.event_budget_overrides (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  house_id uuid,
  row_key text not null,
  label text,
  amount_cents integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, row_key)
);

alter table public.event_budget_overrides enable row level security;

create policy "house members can manage event_budget_overrides"
  on public.event_budget_overrides for all
  using (true) with check (true);

create index if not exists event_budget_overrides_event_idx
  on public.event_budget_overrides (event_id);
