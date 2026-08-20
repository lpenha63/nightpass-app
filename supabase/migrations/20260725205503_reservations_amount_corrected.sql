alter table public.reservations add column if not exists amount_corrected boolean not null default false;
