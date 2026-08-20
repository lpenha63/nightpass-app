-- ── Config da plataforma (linha única) ────────────────────────────────────────
-- Instância de WhatsApp DA PLATAFORMA (você falando com seus clientes).
-- Não confundir com whatsapp_config, que é por casa (o app falando com os clientes dela).
create table if not exists public.saas_platform_config (
  id                 int primary key default 1 check (id = 1),
  company_name       text,
  wa_api_url         text,
  wa_instance        text,
  wa_api_key         text,
  wa_active          boolean not null default false,
  billing_day_default int not null default 10 check (billing_day_default between 1 and 28),
  grace_days         int not null default 5 check (grace_days >= 0),
  -- Régua de cobrança: offset em dias relativo ao vencimento (negativo = antes)
  dunning            jsonb not null default '[
    {"offset": -5, "template": "invoice_due_soon"},
    {"offset":  0, "template": "invoice_due_today"},
    {"offset":  1, "template": "invoice_overdue"},
    {"offset":  3, "template": "invoice_overdue_final"}
  ]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

insert into public.saas_platform_config (id) values (1) on conflict (id) do nothing;

-- ── Modelos de mensagem ───────────────────────────────────────────────────────
create table if not exists public.saas_message_templates (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid references public.saas_products(id) on delete cascade,  -- null = vale para todos
  key        text not null,
  channel    text not null default 'whatsapp',
  body       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists saas_msg_tpl_global_uniq
  on public.saas_message_templates (key, channel) where product_id is null;
create unique index if not exists saas_msg_tpl_product_uniq
  on public.saas_message_templates (product_id, key, channel) where product_id is not null;

-- ── Outbox: fila + histórico de envios ────────────────────────────────────────
create table if not exists public.saas_messages (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.saas_customers(id) on delete cascade,
  subscription_id uuid references public.saas_subscriptions(id) on delete set null,
  invoice_id      uuid references public.saas_invoices(id) on delete set null,
  channel         text not null default 'whatsapp',
  to_addr         text not null,
  template_key    text,
  body            text not null,
  status          text not null default 'queued' check (status in ('queued','sent','failed','canceled')),
  error           text,
  attempts        int not null default 0,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists saas_messages_fila_idx    on public.saas_messages (status, created_at);
create index if not exists saas_messages_customer_idx on public.saas_messages (customer_id);
create index if not exists saas_messages_invoice_idx  on public.saas_messages (invoice_id);

-- Evita reenviar a mesma etapa da régua para a mesma fatura
create unique index if not exists saas_messages_invoice_template_uniq
  on public.saas_messages (invoice_id, template_key)
  where invoice_id is not null and template_key is not null and status <> 'failed';

drop trigger if exists saas_platform_config_touch on public.saas_platform_config;
create trigger saas_platform_config_touch before update on public.saas_platform_config
  for each row execute function public.saas_set_updated_at();

drop trigger if exists saas_msg_tpl_touch on public.saas_message_templates;
create trigger saas_msg_tpl_touch before update on public.saas_message_templates
  for each row execute function public.saas_set_updated_at();

-- ── RLS: só o dono da plataforma ──────────────────────────────────────────────
alter table public.saas_platform_config   enable row level security;
alter table public.saas_message_templates enable row level security;
alter table public.saas_messages          enable row level security;

drop policy if exists saas_platform_config_admin on public.saas_platform_config;
create policy saas_platform_config_admin on public.saas_platform_config for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin));

drop policy if exists saas_msg_tpl_admin on public.saas_message_templates;
create policy saas_msg_tpl_admin on public.saas_message_templates for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin));

drop policy if exists saas_messages_admin on public.saas_messages;
create policy saas_messages_admin on public.saas_messages for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin));
