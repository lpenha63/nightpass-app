-- CORREÇÃO DE SEGURANÇA
-- 1) current_user dentro de SECURITY DEFINER é o DONO da função, não o chamador —
--    a guarda antiga aprovava qualquer um. O correto é session_user, que permanece
--    'authenticator' em chamadas via PostgREST e 'postgres' em conexão direta.
-- 2) revoke de anon não bastava: o privilégio vinha de PUBLIC.

create or replace function public.saas_is_platform_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- conexão direta (psql/admin/migrations)
  if session_user in ('postgres', 'supabase_admin') then return true; end if;
  -- edge functions com service_role
  if coalesce(auth.role(), '') = 'service_role' then return true; end if;
  -- usuário logado marcado como dono da plataforma
  return exists (select 1 from profiles p where p.id = auth.uid() and p.is_saas_admin);
end $$;

-- ── Reaplica as guardas usando o helper ───────────────────────────────────────
create or replace function public.saas_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mes_ini date := date_trunc('month', current_date)::date;
  v_mrr bigint; v_ativos int; v_trial int; v_comp int; v_inadimp int;
  v_novos int; v_cancel int; v_faturado bigint; v_recebido bigint;
  v_aberto bigint; v_vencido bigint; v_conv_num int; v_conv_den int;
begin
  if not saas_is_platform_admin() then
    raise exception 'acesso restrito a administradores da plataforma';
  end if;

  select coalesce(sum(mrr_cents),0), coalesce(sum(ativos),0), coalesce(sum(em_teste),0),
         coalesce(sum(cortesia),0), coalesce(sum(inadimplentes),0)
    into v_mrr, v_ativos, v_trial, v_comp, v_inadimp from v_saas_mrr;
  select count(*) into v_novos  from saas_subscriptions where created_at  >= v_mes_ini;
  select count(*) into v_cancel from saas_subscriptions where canceled_at >= v_mes_ini;
  select coalesce(sum(amount_cents - discount_cents),0) into v_faturado
    from saas_invoices where competence = v_mes_ini and status <> 'canceled';
  select coalesce(sum(coalesce(paid_amount_cents, amount_cents)),0) into v_recebido
    from saas_invoices where status = 'paid' and paid_at >= v_mes_ini;
  select coalesce(sum(amount_cents - discount_cents),0) into v_aberto
    from saas_invoices where status = 'open';
  select coalesce(sum(amount_cents - discount_cents),0) into v_vencido
    from saas_invoices where status = 'overdue';
  select count(*) filter (where status='active'), count(*)
    into v_conv_num, v_conv_den from saas_subscriptions where trial_ends_at is not null;

  return jsonb_build_object(
    'mrr_cents', v_mrr, 'arr_cents', v_mrr * 12,
    'ativos', v_ativos, 'em_teste', v_trial, 'cortesia', v_comp, 'inadimplentes', v_inadimp,
    'novos_mes', v_novos, 'cancelados_mes', v_cancel,
    'churn_pct', case when (v_ativos + v_cancel) > 0
                      then round(v_cancel::numeric * 100 / (v_ativos + v_cancel), 1) else 0 end,
    'conversao_trial_pct', case when v_conv_den > 0
                      then round(v_conv_num::numeric * 100 / v_conv_den, 1) else 0 end,
    'faturado_mes', v_faturado, 'recebido_mes', v_recebido,
    'em_aberto_cents', v_aberto, 'vencido_cents', v_vencido,
    'por_produto', coalesce((select jsonb_agg(to_jsonb(m) order by m.mrr_cents desc) from v_saas_mrr m), '[]'::jsonb),
    'aging',       coalesce((select jsonb_agg(to_jsonb(a)) from v_saas_invoice_aging a), '[]'::jsonb),
    'receita_12m', coalesce((select jsonb_agg(x order by x.mes) from (
                      select to_char(date_trunc('month', paid_at), 'YYYY-MM') as mes,
                             sum(amount_cents)::bigint as total_cents
                        from saas_payments
                       where status='approved'
                         and paid_at >= date_trunc('month', current_date) - interval '11 months'
                       group by 1) x), '[]'::jsonb)
  );
end $$;

-- Guardas nas funções que faltavam (saas_generate_invoices e saas_mark_overdue não tinham nenhuma)
create or replace function public.saas_generate_invoices(p_competence date default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_comp date := date_trunc('month', coalesce(p_competence, current_date))::date;
        v_count int := 0; r record; v_day int; v_due date;
begin
  if not saas_is_platform_admin() then
    raise exception 'acesso restrito a administradores da plataforma';
  end if;
  for r in
    select s.id, s.customer_id, s.product_id, s.billing_day as sub_day,
           c.billing_day as cust_day, pl.price_cents
      from saas_subscriptions s
      join saas_customers c on c.id = s.customer_id
      join saas_plans pl on pl.id = s.plan_id
     where s.status in ('active','past_due') and c.status = 'active' and pl.price_cents > 0
  loop
    v_day := coalesce(r.sub_day, r.cust_day, 10);
    v_due := greatest(v_comp + (v_day - 1), current_date);
    insert into saas_invoices (customer_id, subscription_id, product_id, competence, amount_cents, due_date, status)
    values (r.customer_id, r.id, r.product_id, v_comp, r.price_cents, v_due, 'open')
    on conflict (subscription_id, competence) where subscription_id is not null do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

create or replace function public.saas_mark_overdue()
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not saas_is_platform_admin() then
    raise exception 'acesso restrito a administradores da plataforma';
  end if;
  update saas_invoices set status='overdue' where status='open' and due_date < current_date;
  get diagnostics v = row_count;
  return v;
end $$;

-- ── Privilégios: tirar de PUBLIC (a causa real da exposição) ──────────────────
revoke execute on function public.saas_dashboard()                               from public, anon;
revoke execute on function public.saas_billing_run()                             from public, anon;
revoke execute on function public.saas_generate_invoices(date)                   from public, anon;
revoke execute on function public.saas_mark_overdue()                            from public, anon;
revoke execute on function public.saas_pay_invoice_manual(uuid, int, text, text) from public, anon;
revoke execute on function public.saas_enqueue_message(uuid, text, jsonb, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.saas_is_platform_admin()                       from public, anon;

-- O painel chama estas com JWT de usuário; a guarda interna faz o resto
grant execute on function public.saas_dashboard()                               to authenticated;
grant execute on function public.saas_billing_run()                             to authenticated;
grant execute on function public.saas_generate_invoices(date)                   to authenticated;
grant execute on function public.saas_mark_overdue()                            to authenticated;
grant execute on function public.saas_pay_invoice_manual(uuid, int, text, text) to authenticated;

-- Views agregadas não devem ser legíveis por anon
revoke select on public.v_saas_mrr, public.v_saas_invoice_aging from anon;
