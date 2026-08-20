-- Cliente da plataforma: quem paga, independente de qual SaaS assina.
-- Desacopla a cobrança do tenant de um produto específico (antes: houses do NightPass).
create table if not exists public.saas_customers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  trade_name   text,
  doc          text,
  doc_type     text check (doc_type in ('cnpj','cpf')),
  email        text,
  phone        text,
  address      text,
  city         text,
  state        text,
  zip          text,
  billing_day  int  not null default 10 check (billing_day between 1 and 28),
  status       text not null default 'active' check (status in ('active','inactive')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists saas_customers_status_idx on public.saas_customers (status);
create index if not exists saas_customers_doc_idx    on public.saas_customers (doc);
create index if not exists saas_customers_name_idx   on public.saas_customers (lower(name));

create or replace function public.saas_set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists saas_customers_touch on public.saas_customers;
create trigger saas_customers_touch before update on public.saas_customers
  for each row execute function public.saas_set_updated_at();

alter table public.saas_customers enable row level security;

drop policy if exists saas_customers_admin_all on public.saas_customers;
create policy saas_customers_admin_all on public.saas_customers
  for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin));
