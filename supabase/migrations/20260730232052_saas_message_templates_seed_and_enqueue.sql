-- Modelos globais (product_id null). Variáveis: {{cliente}} {{app}} {{valor}}
-- {{vencimento}} {{dias}} {{plano}} {{link}}
insert into public.saas_message_templates (product_id, key, channel, body) values
(null, 'welcome', 'whatsapp',
 'Olá {{cliente}}! 🎉' || chr(10) || chr(10) ||
 'Sua conta do *{{app}}* está ativa. Qualquer dúvida, é só chamar por aqui.'),

(null, 'trial_ending', 'whatsapp',
 'Oi {{cliente}}! ⏳' || chr(10) || chr(10) ||
 'Seu teste do *{{app}}* termina em *{{dias}} dia(s)*.' || chr(10) ||
 'Para não perder o acesso, escolha um plano em Configurações → Assinatura.'),

(null, 'invoice_created', 'whatsapp',
 'Olá {{cliente}}! 🧾' || chr(10) || chr(10) ||
 'A mensalidade do *{{app}}* de *{{valor}}* já está disponível.' || chr(10) ||
 'Vencimento: *{{vencimento}}*.' || chr(10) || '{{link}}'),

(null, 'invoice_due_soon', 'whatsapp',
 'Oi {{cliente}}! 📅' || chr(10) || chr(10) ||
 'Sua mensalidade do *{{app}}* de *{{valor}}* vence em *{{dias}} dia(s)* ({{vencimento}}).' || chr(10) ||
 '{{link}}'),

(null, 'invoice_due_today', 'whatsapp',
 'Oi {{cliente}}! ⌛' || chr(10) || chr(10) ||
 'Sua mensalidade do *{{app}}* de *{{valor}}* vence *hoje*.' || chr(10) || '{{link}}'),

(null, 'invoice_overdue', 'whatsapp',
 'Olá {{cliente}},' || chr(10) || chr(10) ||
 'Identificamos que a mensalidade do *{{app}}* de *{{valor}}*, vencida em *{{vencimento}}*, ainda está em aberto.' || chr(10) ||
 'Se já pagou, pode desconsiderar. 🙂' || chr(10) || '{{link}}'),

(null, 'invoice_overdue_final', 'whatsapp',
 '⚠️ {{cliente}}, aviso importante.' || chr(10) || chr(10) ||
 'A mensalidade do *{{app}}* de *{{valor}}* segue em aberto desde {{vencimento}}.' || chr(10) ||
 'Para evitar a suspensão do acesso, regularize o quanto antes.' || chr(10) || '{{link}}'),

(null, 'subscription_suspended', 'whatsapp',
 '🔒 {{cliente}}, o acesso ao *{{app}}* foi suspenso por falta de pagamento.' || chr(10) || chr(10) ||
 'Seus dados estão preservados e voltam assim que a mensalidade for quitada.' || chr(10) || '{{link}}'),

(null, 'payment_received', 'whatsapp',
 'Recebemos seu pagamento, {{cliente}}! ✅' || chr(10) || chr(10) ||
 '*{{valor}}* referente ao *{{app}}*. Obrigado!')
on conflict do nothing;


-- Enfileira uma mensagem renderizando o modelo (produto tem prioridade sobre o global).
-- Retorna null quando não há telefone ou modelo ativo — silencioso de propósito,
-- para a régua de cobrança nunca abortar por causa de um cliente sem WhatsApp.
create or replace function public.saas_enqueue_message(
  p_customer     uuid,
  p_template_key text,
  p_vars         jsonb default '{}'::jsonb,
  p_invoice      uuid default null,
  p_subscription uuid default null,
  p_product      uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text; v_phone text; v_name text; v_id uuid; k text; v text;
begin
  select phone, name into v_phone, v_name from saas_customers where id = p_customer;
  if v_phone is null or length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then
    return null;
  end if;

  select body into v_body
    from saas_message_templates
   where key = p_template_key and channel = 'whatsapp' and active
     and (product_id = p_product or product_id is null)
   order by (product_id is not null) desc   -- específico do produto primeiro
   limit 1;
  if v_body is null then return null; end if;

  v_body := replace(v_body, '{{cliente}}', coalesce(v_name, ''));
  for k, v in select key, value from jsonb_each_text(p_vars) loop
    v_body := replace(v_body, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  -- remove variáveis não fornecidas e espaços sobrando
  v_body := regexp_replace(v_body, '\{\{[a-z_]+\}\}', '', 'g');
  v_body := regexp_replace(v_body, '[ \t]+(\n|$)', '\1', 'g');

  insert into saas_messages (customer_id, subscription_id, invoice_id, to_addr, template_key, body)
  values (p_customer, p_subscription, p_invoice, regexp_replace(v_phone, '\D', '', 'g'), p_template_key, v_body)
  on conflict do nothing
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.saas_enqueue_message(uuid, text, jsonb, uuid, uuid, uuid) from anon;
