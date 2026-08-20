
-- Lotes de ingresso por evento
create table if not exists public.ticket_batches (
  id uuid default gen_random_uuid() primary key,
  event_id uuid references public.events(id) on delete cascade not null,
  house_id uuid references public.houses(id) on delete cascade not null,
  name text not null,                        -- "1º Lote", "Pista VIP", etc
  gender text default 'both' not null,       -- 'male', 'female', 'both'
  price_cents integer default 0 not null,
  quantity integer not null,                 -- capacidade total do lote
  sold integer default 0 not null,           -- vendidos (calculado)
  active boolean default true not null,
  expires_at timestamptz,                    -- prazo de venda
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Pedidos de compra
create table if not exists public.ticket_orders (
  id uuid default gen_random_uuid() primary key,
  house_id uuid references public.houses(id) on delete cascade not null,
  event_id uuid references public.events(id) on delete cascade not null,
  batch_id uuid references public.ticket_batches(id) not null,
  buyer_name text not null,
  buyer_cpf text,
  buyer_phone text,
  buyer_email text,
  quantity integer default 1 not null,
  amount_cents integer not null,
  payment_status text default 'pending' not null,  -- pending, paid, cancelled
  payment_method text,                              -- pix, card, cash
  payment_id text,                                  -- id externo do gateway
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Ingressos individuais (um por pessoa do pedido)
create table if not exists public.tickets (
  id uuid default gen_random_uuid() primary key,
  order_id uuid references public.ticket_orders(id) on delete cascade not null,
  event_id uuid references public.events(id) on delete cascade not null,
  house_id uuid references public.houses(id) on delete cascade not null,
  token text unique not null default encode(gen_random_bytes(16), 'hex'),
  holder_name text,
  checked_in boolean default false not null,
  checked_in_at timestamptz,
  checkin_id uuid references public.checkins(id),
  created_at timestamptz default now() not null
);

-- Índices
create index if not exists idx_ticket_batches_event_id on public.ticket_batches(event_id);
create index if not exists idx_ticket_orders_event_id on public.ticket_orders(event_id);
create index if not exists idx_ticket_orders_batch_id on public.ticket_orders(batch_id);
create index if not exists idx_ticket_orders_status on public.ticket_orders(payment_status);
create index if not exists idx_tickets_order_id on public.tickets(order_id);
create index if not exists idx_tickets_token on public.tickets(token);
create index if not exists idx_tickets_event_id on public.tickets(event_id);

-- RLS
alter table public.ticket_batches enable row level security;
alter table public.ticket_orders enable row level security;
alter table public.tickets enable row level security;

-- Lotes: membros da house gerenciam
create policy "house members manage batches"
  on public.ticket_batches for all
  using (house_id in (
    select house_id from public.house_users
    where user_id = auth.uid() and is_active = true
  ));

-- Lotes: público pode ler lotes ativos
create policy "public read active batches"
  on public.ticket_batches for select
  using (active = true);

-- Pedidos: membros da house podem ver todos
create policy "house members manage orders"
  on public.ticket_orders for all
  using (house_id in (
    select house_id from public.house_users
    where user_id = auth.uid() and is_active = true
  ));

-- Pedidos: qualquer pessoa pode criar (compra pública)
create policy "public can create orders"
  on public.ticket_orders for insert
  with check (true);

-- Ingressos: membros da house gerenciam
create policy "house members manage tickets"
  on public.tickets for all
  using (house_id in (
    select house_id from public.house_users
    where user_id = auth.uid() and is_active = true
  ));

-- Ingressos: público pode ler pelo token (para validação)
create policy "public read ticket by token"
  on public.tickets for select
  using (true);
