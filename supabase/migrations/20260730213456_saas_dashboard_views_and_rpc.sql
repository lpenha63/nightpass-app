-- security_invoker: as views respeitam a RLS de quem consulta (só saas_admin lê).
-- Reusa saas_effective_status() — a mesma regra de bloqueio do app, sem duplicar lógica.

create or replace view public.v_saas_mrr
with (security_invoker = true) as
select
  p.id   as product_id,
  p.key  as product_key,
  p.name as product_name,
  count(s.id) filter (where saas_effective_status(s.status, s.trial_ends_at, s.grace_until) = 'active')    as ativos,
  count(s.id) filter (where saas_effective_status(s.status, s.trial_ends_at, s.grace_until) = 'trialing')  as em_teste,
  count(s.id) filter (where saas_effective_status(s.status, s.trial_ends_at, s.grace_until) = 'comp')      as cortesia,
  count(s.id) filter (where saas_effective_status(s.status, s.trial_ends_at, s.grace_until) in ('suspended','past_due')) as inadimplentes,
  coalesce(sum(pl.price_cents) filter (where saas_effective_status(s.status, s.trial_ends_at, s.grace_until) = 'active'), 0)::bigint as mrr_cents
from public.saas_products p
left join public.saas_subscriptions s on s.product_id = p.id and s.status <> 'canceled'
left join public.saas_plans pl on pl.id = s.plan_id
group by p.id, p.key, p.name;

create or replace view public.v_saas_invoice_aging
with (security_invoker = true) as
select
  case
    when i.due_date >= current_date            then 'a_vencer'
    when current_date - i.due_date <= 30        then 'd1_30'
    when current_date - i.due_date <= 60        then 'd31_60'
    else                                             'd60_mais'
  end as faixa,
  count(*)::int as qtd,
  coalesce(sum(i.amount_cents - i.discount_cents), 0)::bigint as total_cents
from public.saas_invoices i
where i.status in ('open', 'overdue')
group by 1;

-- RPC única com todos os KPIs (uma ida ao banco em vez de agregar no cliente)
create or replace function public.saas_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mes_ini    date := date_trunc('month', current_date)::date;
  v_mrr        bigint;
  v_ativos     int;
  v_trial      int;
  v_comp       int;
  v_inadimp    int;
  v_novos      int;
  v_cancel     int;
  v_faturado   bigint;
  v_recebido   bigint;
  v_aberto     bigint;
  v_vencido    bigint;
  v_conv_num   int;
  v_conv_den   int;
begin
  if not (
        current_user in ('postgres', 'service_role', 'supabase_admin')
     or exists (select 1 from profiles p where p.id = auth.uid() and p.is_saas_admin)
  ) then
    raise exception 'acesso restrito a administradores da plataforma';
  end if;

  select coalesce(sum(mrr_cents), 0), coalesce(sum(ativos), 0), coalesce(sum(em_teste), 0),
         coalesce(sum(cortesia), 0), coalesce(sum(inadimplentes), 0)
    into v_mrr, v_ativos, v_trial, v_comp, v_inadimp
    from v_saas_mrr;

  select count(*) into v_novos
    from saas_subscriptions where created_at >= v_mes_ini;

  select count(*) into v_cancel
    from saas_subscriptions where canceled_at >= v_mes_ini;

  select coalesce(sum(amount_cents - discount_cents), 0) into v_faturado
    from saas_invoices where competence = v_mes_ini and status <> 'canceled';

  select coalesce(sum(coalesce(paid_amount_cents, amount_cents)), 0) into v_recebido
    from saas_invoices where status = 'paid' and paid_at >= v_mes_ini;

  select coalesce(sum(amount_cents - discount_cents), 0) into v_aberto
    from saas_invoices where status = 'open';

  select coalesce(sum(amount_cents - discount_cents), 0) into v_vencido
    from saas_invoices where status = 'overdue';

  -- Conversão trial→pago (aproximação: quem passou por trial e hoje está ativo)
  select count(*) filter (where status = 'active'), count(*)
    into v_conv_num, v_conv_den
    from saas_subscriptions where trial_ends_at is not null;

  return jsonb_build_object(
    'mrr_cents',        v_mrr,
    'arr_cents',        v_mrr * 12,
    'ativos',           v_ativos,
    'em_teste',         v_trial,
    'cortesia',         v_comp,
    'inadimplentes',    v_inadimp,
    'novos_mes',        v_novos,
    'cancelados_mes',   v_cancel,
    'churn_pct',        case when (v_ativos + v_cancel) > 0
                             then round(v_cancel::numeric * 100 / (v_ativos + v_cancel), 1) else 0 end,
    'conversao_trial_pct', case when v_conv_den > 0
                             then round(v_conv_num::numeric * 100 / v_conv_den, 1) else 0 end,
    'faturado_mes',     v_faturado,
    'recebido_mes',     v_recebido,
    'em_aberto_cents',  v_aberto,
    'vencido_cents',    v_vencido,
    'por_produto',      coalesce((select jsonb_agg(to_jsonb(m) order by m.mrr_cents desc) from v_saas_mrr m), '[]'::jsonb),
    'aging',            coalesce((select jsonb_agg(to_jsonb(a)) from v_saas_invoice_aging a), '[]'::jsonb),
    'receita_12m',      coalesce((
                          select jsonb_agg(x order by x.mes)
                          from (
                            select to_char(date_trunc('month', paid_at), 'YYYY-MM') as mes,
                                   sum(amount_cents)::bigint as total_cents
                            from saas_payments
                            where status = 'approved'
                              and paid_at >= date_trunc('month', current_date) - interval '11 months'
                            group by 1
                          ) x), '[]'::jsonb)
  );
end $$;

revoke execute on function public.saas_dashboard() from anon;
