create table if not exists public.event_expenses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  house_id uuid references public.houses(id) on delete cascade,
  description text not null,
  amount_cents integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists event_expenses_event_id_idx on public.event_expenses(event_id);
alter table public.event_expenses enable row level security;
drop policy if exists "house members can manage event_expenses" on public.event_expenses;
create policy "house members can manage event_expenses" on public.event_expenses for all using (true) with check (true);
