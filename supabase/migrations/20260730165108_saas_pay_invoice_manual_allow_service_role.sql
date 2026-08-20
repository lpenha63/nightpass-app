-- Autoriza também os papéis internos (service_role/postgres) — as edge functions
-- de cobrança precisam quitar fatura sem um JWT de usuário. Via API REST os papéis
-- são anon/authenticated, então a checagem de is_saas_admin continua valendo.
create or replace function public.saas_pay_invoice_manual(
  p_invoice        uuid,
  p_amount_cents   int  default null,
  p_method         text default 'manual',
  p_notes          text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare inv record; v_payment uuid; v_amount int;
begin
  if not (
        current_user in ('postgres', 'service_role', 'supabase_admin')
     or exists (select 1 from profiles p where p.id = auth.uid() and p.is_saas_admin)
  ) then
    raise exception 'apenas administradores da plataforma podem dar baixa em faturas';
  end if;

  select * into inv from saas_invoices where id = p_invoice for update;
  if not found then raise exception 'fatura não encontrada'; end if;
  if inv.status = 'paid' then raise exception 'esta fatura já está paga'; end if;
  if inv.status in ('canceled', 'void') then raise exception 'fatura cancelada não pode ser paga'; end if;

  v_amount := coalesce(p_amount_cents, inv.amount_cents - inv.discount_cents);

  insert into saas_payments
    (subscription_id, customer_id, invoice_id, amount_cents, status, method, paid_at)
  values
    (inv.subscription_id, inv.customer_id, inv.id, v_amount, 'approved', p_method, now())
  returning id into v_payment;

  update saas_invoices
     set status = 'paid', paid_at = now(), paid_amount_cents = v_amount,
         payment_id = v_payment, method = p_method,
         notes = coalesce(p_notes, notes)
   where id = inv.id;

  if inv.subscription_id is not null then
    update saas_subscriptions
       set status = 'active',
           current_period_start = now(),
           current_period_end = greatest(coalesce(current_period_end, now()), now()) + interval '30 days',
           grace_until = null
     where id = inv.subscription_id and status <> 'canceled';
  end if;

  insert into saas_audit_log (actor_user_id, customer_id, action, details)
  values (auth.uid(), inv.customer_id, 'invoice_paid_manual',
          jsonb_build_object('invoice_id', inv.id, 'amount_cents', v_amount, 'method', p_method));

  return v_payment;
end $$;

revoke execute on function public.saas_pay_invoice_manual(uuid, int, text, text) from anon;
