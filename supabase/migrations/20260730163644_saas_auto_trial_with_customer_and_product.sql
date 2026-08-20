-- Casa nova → cria o CLIENTE da plataforma e a assinatura de trial já amarrada
-- ao produto e ao tenant. Antes gravava só house_id (sem cliente e sem product_id,
-- o que geraria assinatura órfã assim que existisse um segundo SaaS).
create or replace function public.saas_auto_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare v_plan uuid; v_days int; v_product uuid; v_customer uuid;
begin
  select id into v_product from saas_products where key = 'nightpass' limit 1;

  select id, trial_days into v_plan, v_days
    from saas_plans
   where key = 'profissional'
     and (v_product is null or product_id = v_product)
   limit 1;

  -- sem plano configurado: não impede a criação da casa
  if v_plan is null then return new; end if;

  insert into saas_customers (name, email, phone, doc, doc_type, address, city, state)
  values (new.name,
          nullif(new.email, ''),
          nullif(new.phone, ''),
          nullif(new.cnpj, ''),
          case when nullif(new.cnpj, '') is not null then 'cnpj' end,
          nullif(new.address, ''),
          nullif(new.city, ''),
          nullif(new.state, ''))
  returning id into v_customer;

  insert into saas_subscriptions
    (customer_id, product_id, tenant_id, house_id, plan_id, status, trial_ends_at)
  values
    (v_customer, v_product, new.id::text, new.id, v_plan, 'trialing',
     now() + make_interval(days => coalesce(v_days, 14)));

  return new;
end;
$function$;

-- Agora que tudo está backfillado, o cliente passa a ser obrigatório.
alter table public.saas_subscriptions alter column customer_id set not null;

-- Uma assinatura viva por cliente+produto (permite N produtos para o mesmo cliente).
create unique index if not exists saas_subscriptions_customer_product_uniq
  on public.saas_subscriptions (customer_id, product_id)
  where status <> 'canceled';
