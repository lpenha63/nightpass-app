create table if not exists public.work_areas (
  id uuid primary key default gen_random_uuid(),
  house_id uuid references public.houses(id) on delete cascade,
  key text not null,
  label text not null,
  icon text default '📋',
  color text default '#60a5fa',
  sort_order integer default 0,
  active boolean default true,
  created_at timestamptz default now()
);
create index if not exists work_areas_house_idx on public.work_areas(house_id);
alter table public.work_areas enable row level security;
drop policy if exists "house members can manage work_areas" on public.work_areas;
create policy "house members can manage work_areas" on public.work_areas for all using (true) with check (true);

alter table public.freelancers add column if not exists staff_type text default 'freelancer';
