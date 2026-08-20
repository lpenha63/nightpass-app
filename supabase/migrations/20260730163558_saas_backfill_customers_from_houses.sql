-- Cria 1 cliente por assinatura existente, espelhando os dados comerciais da casa,
-- e amarra a assinatura ao cliente + tenant_id. Idempotente (só toca customer_id nulo).
do $$
declare r record; v_customer uuid;
begin
  for r in
    select s.id as sub_id, s.house_id,
           h.name, h.email, h.phone, h.cnpj, h.address, h.city, h.state
      from public.saas_subscriptions s
      join public.houses h on h.id = s.house_id
     where s.customer_id is null
  loop
    insert into public.saas_customers (name, email, phone, doc, doc_type, address, city, state)
    values (r.name,
            nullif(r.email, ''),
            nullif(r.phone, ''),
            nullif(r.cnpj, ''),
            case when nullif(r.cnpj, '') is not null then 'cnpj' end,
            nullif(r.address, ''),
            nullif(r.city, ''),
            nullif(r.state, ''))
    returning id into v_customer;

    update public.saas_subscriptions
       set customer_id = v_customer,
           tenant_id   = coalesce(tenant_id, r.house_id::text)
     where id = r.sub_id;
  end loop;
end $$;

-- Pagamentos herdam o cliente da assinatura (hoje 0 linhas; idempotente)
update public.saas_payments p
   set customer_id = s.customer_id
  from public.saas_subscriptions s
 where s.id = p.subscription_id and p.customer_id is null;
