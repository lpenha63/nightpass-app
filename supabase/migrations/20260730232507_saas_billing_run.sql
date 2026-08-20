-- Formata centavos em BRL sem depender de locale do servidor
create or replace function public.saas_brl(p_cents int)
returns text language sql immutable as $$
  select 'R$ ' || replace(replace(replace(
           to_char(p_cents / 100.0, 'FM999G999G990D00'), ',', 'X'), '.', ','), 'X', '.')
$$;

-- ── Rotina diária de cobrança ─────────────────────────────────────────────────
-- Gera faturas, marca vencidas, aplica a régua (enfileira mensagens) e suspende
-- quem passou da carência. Tudo em SQL: o único passo com HTTP é o envio, feito
-- pela edge function saas-notify.
create or replace function public.saas_billing_run()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_geradas  int := 0;
  v_vencidas int := 0;
  v_msgs     int := 0;
  v_susp     int := 0;
  v_grace    int;
  v_dunning  jsonb;
  r record; step jsonb;
begin
  if not (
        current_user in ('postgres', 'service_role', 'supabase_admin')
     or exists (select 1 from profiles p where p.id = auth.uid() and p.is_saas_admin)
  ) then
    raise exception 'acesso restrito a administradores da plataforma';
  end if;

  select grace_days, dunning into v_grace, v_dunning
    from saas_platform_config where id = 1;
  v_grace   := coalesce(v_grace, 5);
  v_dunning := coalesce(v_dunning, '[]'::jsonb);

  v_geradas  := saas_generate_invoices();
  v_vencidas := saas_mark_overdue();

  -- Régua: dispara a etapa cujo offset bate com hoje (relativo ao vencimento)
  for r in
    select i.id, i.customer_id, i.subscription_id, i.product_id, i.due_date,
           (i.amount_cents - i.discount_cents) as valor,
           pr.name as app_name
      from saas_invoices i
      left join saas_products pr on pr.id = i.product_id
     where i.status in ('open', 'overdue')
  loop
    for step in select * from jsonb_array_elements(v_dunning)
    loop
      if current_date = r.due_date + (step->>'offset')::int then
        if saas_enqueue_message(
             r.customer_id,
             step->>'template',
             jsonb_build_object(
               'app',        coalesce(r.app_name, ''),
               'valor',      saas_brl(r.valor),
               'vencimento', to_char(r.due_date, 'DD/MM/YYYY'),
               'dias',       abs((step->>'offset')::int)::text
             ),
             r.id, r.subscription_id, r.product_id
           ) is not null
        then
          v_msgs := v_msgs + 1;
        end if;
      end if;
    end loop;
  end loop;

  -- Suspende quem estourou a carência (e avisa)
  for r in
    select distinct s.id as sub_id, s.customer_id, i.product_id, pr.name as app_name
      from saas_invoices i
      join saas_subscriptions s on s.id = i.subscription_id
      left join saas_products pr on pr.id = i.product_id
     where i.status = 'overdue'
       and current_date > i.due_date + v_grace
       and s.status in ('active', 'past_due')
  loop
    update saas_subscriptions
       set status = 'suspended', grace_until = null
     where id = r.sub_id;
    v_susp := v_susp + 1;

    perform saas_enqueue_message(
      r.customer_id, 'subscription_suspended',
      jsonb_build_object('app', coalesce(r.app_name, '')),
      null, r.sub_id, r.product_id
    );

    insert into saas_audit_log (customer_id, action, details)
    values (r.customer_id, 'auto_suspend',
            jsonb_build_object('subscription_id', r.sub_id, 'grace_days', v_grace));
  end loop;

  return jsonb_build_object(
    'faturas_geradas',   v_geradas,
    'marcadas_vencidas', v_vencidas,
    'mensagens_na_fila', v_msgs,
    'suspensas',         v_susp,
    'executado_em',      now()
  );
end $$;

revoke execute on function public.saas_billing_run() from anon;
revoke execute on function public.saas_brl(int)      from anon;
