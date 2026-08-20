-- Cada produto declara suas próprias réguas de plano. Antes as dimensões estavam
-- cravadas no código do painel (max_events_month, tickets...), o que só fazia sentido
-- para o NightPass — cadastrar um app novo exigiria editar código.
create table if not exists public.saas_product_dimensions (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.saas_products(id) on delete cascade,
  kind        text not null check (kind in ('limit', 'feature')),
  key         text not null,          -- slug lido pelo código do app (plan.limits[key])
  label       text not null,          -- rótulo na vitrine e no painel
  unit        text,                   -- "eventos/mês", "usuários" (só para limit)
  description text,
  -- O app REALMENTE aplica esta régua? Enquanto false, o plano é decorativo —
  -- serve para o painel avisar em vez de você descobrir vendendo.
  enforced    boolean not null default false,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (product_id, key)
);

create index if not exists saas_prod_dim_product_idx on public.saas_product_dimensions (product_id, kind, sort_order);

alter table public.saas_product_dimensions enable row level security;

-- Leitura pública das ativas: a vitrine de planos do app precisa montar a lista
drop policy if exists saas_prod_dim_read on public.saas_product_dimensions;
create policy saas_prod_dim_read on public.saas_product_dimensions
  for select
  using (active or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin));

drop policy if exists saas_prod_dim_admin_write on public.saas_product_dimensions;
create policy saas_prod_dim_admin_write on public.saas_product_dimensions
  for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin));

-- Migra as dimensões que estavam cravadas no código, para nada quebrar.
-- enforced=false é a verdade hoje: nenhuma delas é aplicada pelo app.
insert into public.saas_product_dimensions (product_id, kind, key, label, unit, sort_order)
select p.id, d.kind, d.key, d.label, d.unit, d.ord
from public.saas_products p
cross join (values
  ('limit',   'max_users',          'Usuários',             'usuários',      1),
  ('limit',   'max_events_month',   'Eventos por mês',      'eventos/mês',   2),
  ('limit',   'max_clients',        'Clientes na base',     'clientes',      3),
  ('limit',   'max_whatsapp_month', 'Mensagens WhatsApp',   'mensagens/mês', 4),
  ('feature', 'whatsapp',           'WhatsApp integrado',    null,           5),
  ('feature', 'tickets',            'Venda de ingressos',    null,           6),
  ('feature', 'campaigns',          'Campanhas',             null,           7),
  ('feature', 'reports_advanced',   'Relatórios avançados',  null,           8),
  ('feature', 'api_access',         'Acesso à API',          null,           9)
) as d(kind, key, label, unit, ord)
where p.key = 'nightpass'
on conflict (product_id, key) do nothing;
