-- Fatura = o que é DEVIDO (saas_payments registra só o que foi pago).
-- Uma fatura por assinatura/competência — nunca consolidada entre produtos,
-- para que MRR e inadimplência sejam rastreáveis por app.
create table if not exists public.saas_invoices (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.saas_customers(id) on delete restrict,
  subscription_id  uuid references public.saas_subscriptions(id) on delete set null,
  product_id       uuid references public.saas_products(id),
  competence       date not null,                       -- mês de referência (dia 1)
  amount_cents     int  not null check (amount_cents >= 0),
  discount_cents   int  not null default 0 check (discount_cents >= 0),
  due_date         date not null,
  status           text not null default 'open'
                     check (status in ('open','paid','overdue','canceled','void')),
  method           text check (method in ('card_recurring','pix','boleto','manual')),
  paid_at          timestamptz,
  paid_amount_cents int,
  payment_id       uuid references public.saas_payments(id) on delete set null,
  mp_payment_id    text,
  checkout_url     text,
  pix_qr           text,
  pix_copia_cola   text,
  boleto_url       text,
  boleto_barcode   text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Idempotência da geração mensal: nunca duas faturas do mesmo mês para a mesma assinatura
create unique index if not exists saas_invoices_sub_competence_uniq
  on public.saas_invoices (subscription_id, competence)
  where subscription_id is not null;

create index if not exists saas_invoices_customer_idx on public.saas_invoices (customer_id);
create index if not exists saas_invoices_status_due_idx on public.saas_invoices (status, due_date);
create index if not exists saas_invoices_competence_idx on public.saas_invoices (competence);
create index if not exists saas_invoices_product_idx on public.saas_invoices (product_id);

drop trigger if exists saas_invoices_touch on public.saas_invoices;
create trigger saas_invoices_touch before update on public.saas_invoices
  for each row execute function public.saas_set_updated_at();

-- Pagamento aponta para a fatura que quitou
alter table public.saas_payments
  add column if not exists invoice_id uuid references public.saas_invoices(id) on delete set null;
create index if not exists saas_payments_invoice_idx on public.saas_payments (invoice_id);

alter table public.saas_invoices enable row level security;

drop policy if exists saas_invoices_admin_all on public.saas_invoices;
create policy saas_invoices_admin_all on public.saas_invoices
  for all
  using      (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin));
