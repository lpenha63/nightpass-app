
-- Freelancers table
create table if not exists public.freelancers (
  id uuid default gen_random_uuid() primary key,
  house_id uuid references public.houses(id) on delete cascade not null,
  full_name text not null,
  address text,
  phone text,
  pix_key text,
  daily_rate_cents integer,
  work_types text[] default '{}' not null,
  notes text,
  status text default 'ativo' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Event <-> Freelancer junction table
create table if not exists public.event_freelancers (
  id uuid default gen_random_uuid() primary key,
  event_id uuid references public.events(id) on delete cascade not null,
  freelancer_id uuid references public.freelancers(id) on delete cascade not null,
  confirmed boolean default false not null,
  created_at timestamptz default now() not null,
  unique(event_id, freelancer_id)
);

-- Add observations column to events (safe if already exists)
alter table public.events
  add column if not exists observations text;

-- Indexes for performance
create index if not exists idx_freelancers_house_id on public.freelancers(house_id);
create index if not exists idx_event_freelancers_event_id on public.event_freelancers(event_id);
create index if not exists idx_event_freelancers_freelancer_id on public.event_freelancers(freelancer_id);

-- RLS
alter table public.freelancers enable row level security;
alter table public.event_freelancers enable row level security;

-- RLS policies: house members can read/write their own data
create policy "house members can manage freelancers"
  on public.freelancers
  for all
  using (
    house_id in (
      select house_id from public.house_users
      where user_id = auth.uid() and is_active = true
    )
  );

create policy "house members can manage event_freelancers"
  on public.event_freelancers
  for all
  using (
    event_id in (
      select e.id from public.events e
      join public.house_users hu on hu.house_id = e.house_id
      where hu.user_id = auth.uid() and hu.is_active = true
    )
  );
