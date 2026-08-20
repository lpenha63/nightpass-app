-- ── Geração mensal ────────────────────────────────────────────────────────────
-- Cria a fatura da competência para cada assinatura cobrável. Idempotente.
-- Não fatura trial/cortesia/pendente/suspensa nem plano gratuito.
create or replace function public.saas_generate_invoices(p_competence date default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comp  date := date_trunc('month', coalesce(p_competence, current_date))::date;
  v_count int := 0;
  r record;
  v_day int;
begin
  for r in
    select s.id, s.customer_id, s.product_id,
           s.billing_day as sub_day, c.billing_day as cust_day,
           pl.price_cents
      from saas_subscriptions s
      join saas_customers c on c.id = s.customer_id
      join saas_plans     pl on pl.id = s.plan_id
     where s.status in ('active', 'past_due')
       and c.status = 'active'
       and pl.price_cents > 0
  loop
    v_day := coalesce(r.sub_day, r.cust_day, 10);

    insert into saas_invoices
      (customer_id, subscription_id, product_id, competence, amount_cents, due_date, status)
    values
      (r.customer_id, r.id, r.product_id, v_comp, r.price_cents, v_comp + (v_day - 1), 'open')
    on conflict (subscription_id, competence) where subscription_id is not null
    do nothing;

    if found then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end $$;

-- ── Marca vencidas ────────────────────────────────────────────────────────────
create or replace function public.saas_mark_overdue()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v int;
begin
  update saas_invoices
     set status = 'overdue'
   where status = 'open' and due_date < current_date;
  get diagnostics v = row_count;
  return v;
end $$;

-- ── Baixa manual (PIX/transferência/dinheiro) ─────────────────────────────────
-- Atômico: registra o pagamento, quita a fatura, estende a assinatura e audita.
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
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_saas_admin) then
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

  -- Estende o período. greatest(...) evita encurtar quem paga adiantado.
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

revoke execute on function public.saas_generate_invoices(date)                 from anon;
revoke execute on function public.saas_mark_overdue()                          from anon;
revoke execute on function public.saas_pay_invoice_manual(uuid, int, text, text) from anon;
