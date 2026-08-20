-- De onde veio o cliente (anúncio/campanha). Decidido agora, com 3 linhas na tabela:
-- sem isso você sabe quantos entraram, mas não qual campanha traz quem paga após o trial.
alter table public.saas_customers
  add column if not exists origin jsonb not null default '{}'::jsonb;

-- Consulta por campanha (ex.: origin->>'utm_source' = 'meta')
create index if not exists saas_customers_origin_idx on public.saas_customers using gin (origin);
