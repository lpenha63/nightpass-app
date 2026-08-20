-- Quitação de fatura em UM lugar só: usada pela baixa manual (painel) e pelo
-- webhook do gateway. Evita que a regra de extensão do período divirja entre os dois.
create or replace function public.saas_settle_invoice(
  p_invoice      uuid,
  p_payment      uuid,
  p_amount_cents int,
  p_method       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare inv record;
begin
  if not saas_is_platform_admin() then
    raise exception 'acesso restrito a administradores da plataforma';
  end if;

  select * into inv from saas_invoices where id = p_invoice for update;
  if not found then raise exception 'fatura não encontrada'; end if;
  if inv.status = 'paid' then return; end if;   -- idempotente

  update saas_invoices
     set status = 'paid', paid_at = now(), paid_amount_cents = p_amount_cents,
         payment_id = coalesce(p_payment, payment_id), method = coalesce(p_method, method)
   where id = p_invoice;

  if inv.subscription_id is not null then
    update saas_subscriptions
       set status = 'active',
           current_period_start = now(),
           current_period_end = greatest(coalesce(current_period_end, now()), now()) + interval '30 days',
           grace_until = null
     where id = inv.subscription_id and status <> 'canceled';
  end if;
end $$;

-- Baixa manual passa a delegar a quitação (mesma regra do gateway)
create or replace function public.saas_pay_invoice_manual(
  p_invoice uuid, p_amount_cents int default null,
  p_method text default 'manual', p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv record; v_payment uuid; v_amount int;
begin
  if not saas_is_platform_admin() then
    raise exception 'apenas administradores da plataforma podem dar baixa em faturas';
  end if;

  select * into inv from saas_invoices where id = p_invoice for update;
  if not found then raise exception 'fatura não encontrada'; end if;
  if inv.status = 'paid' then raise exception 'esta fatura já está paga'; end if;
  if inv.status in ('canceled','void') then raise exception 'fatura cancelada não pode ser paga'; end if;

  v_amount := coalesce(p_amount_cents, inv.amount_cents - inv.discount_cents);

  insert into saas_payments
    (subscription_id, customer_id, invoice_id, amount_cents, status, method, provider, paid_at)
  values
    (inv.subscription_id, inv.customer_id, inv.id, v_amount, 'approved', p_method, 'manual', now())
  returning id into v_payment;

  perform saas_settle_invoice(inv.id, v_payment, v_amount, p_method);

  if p_notes is not null then
    update saas_invoices set notes = p_notes where id = inv.id;
  end if;

  insert into saas_audit_log (actor_user_id, customer_id, action, details)
  values (auth.uid(), inv.customer_id, 'invoice_paid_manual',
          jsonb_build_object('invoice_id', inv.id, 'amount_cents', v_amount, 'method', p_method));

  return v_payment;
end $$;

revoke execute on function public.saas_settle_invoice(uuid, uuid, int, text) from public, anon, authenticated;
grant  execute on function public.saas_settle_invoice(uuid, uuid, int, text) to service_role;

-- As edge functions (service_role) precisam destas explicitamente,
-- já que o privilégio de PUBLIC foi revogado.
grant execute on function public.saas_pay_invoice_manual(uuid, int, text, text) to service_role;
grant execute on function public.saas_is_platform_admin()                       to service_role;
grant execute on function public.saas_enqueue_message(uuid, text, jsonb, uuid, uuid, uuid) to service_role;
grant execute on function public.saas_billing_run()                             to service_role;
