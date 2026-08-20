-- Desacopla fatura e pagamento do gateway. Feito agora que as tabelas estão vazias:
-- trocar de/adicionar provedor (Stripe, Asaas, etc.) passa a não exigir reescrita.
alter table public.saas_invoices
  add column if not exists provider text not null default 'mercadopago';

alter table public.saas_payments
  add column if not exists provider text not null default 'mercadopago';

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='saas_invoices' and column_name='mp_payment_id') then
    alter table public.saas_invoices rename column mp_payment_id to external_payment_id;
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='saas_payments' and column_name='mp_payment_id') then
    alter table public.saas_payments rename column mp_payment_id to external_payment_id;
  end if;
end $$;

create index if not exists saas_payments_provider_idx on public.saas_payments (provider);
create index if not exists saas_invoices_provider_idx on public.saas_invoices (provider);
