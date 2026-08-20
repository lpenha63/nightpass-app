-- Correção: uma fatura NUNCA pode nascer vencida.
-- Antes, um cliente ativado depois do billing_day recebia fatura já vencida e era
-- suspenso na primeira execução da régua, sem nunca ter tido chance de pagar.
-- Agora o vencimento é, no mínimo, hoje.
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
  v_due date;
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
    v_due := greatest(v_comp + (v_day - 1), current_date);

    insert into saas_invoices
      (customer_id, subscription_id, product_id, competence, amount_cents, due_date, status)
    values
      (r.customer_id, r.id, r.product_id, v_comp, r.price_cents, v_due, 'open')
    on conflict (subscription_id, competence) where subscription_id is not null
    do nothing;

    if found then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end $$;
