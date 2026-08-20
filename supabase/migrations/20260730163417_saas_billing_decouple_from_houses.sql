-- Assinatura passa a ser ancorada no CLIENTE + PRODUTO.
-- tenant_id = id da entidade dentro do app (NightPass = houses.id; produtos futuros = o id deles).
-- house_id é mantido preenchido durante a transição para não quebrar o NightPass.
alter table public.saas_subscriptions
  add column if not exists customer_id uuid references public.saas_customers(id) on delete restrict,
  add column if not exists tenant_id   text,
  add column if not exists billing_method text not null default 'card_recurring'
       check (billing_method in ('card_recurring','pix','boleto','manual')),
  add column if not exists billing_day int check (billing_day between 1 and 28);

alter table public.saas_subscriptions alter column house_id drop not null;

alter table public.saas_payments
  add column if not exists customer_id uuid references public.saas_customers(id);

alter table public.saas_audit_log
  add column if not exists customer_id uuid references public.saas_customers(id);

create index if not exists saas_subscriptions_customer_idx on public.saas_subscriptions (customer_id);
create index if not exists saas_subscriptions_tenant_idx   on public.saas_subscriptions (product_id, tenant_id);
create index if not exists saas_payments_customer_idx      on public.saas_payments (customer_id);
create index if not exists saas_audit_log_customer_idx     on public.saas_audit_log (customer_id);
