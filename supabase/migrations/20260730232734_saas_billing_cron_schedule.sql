create extension if not exists pg_cron;

-- Rotina diária de cobrança às 12:00 UTC = 09:00 em Brasília.
-- Gera faturas, marca vencidas, aplica a régua e suspende quem estourou a carência.
-- Só SQL: não depende de secret nem de serviço externo.
select cron.unschedule('saas-billing-daily')
 where exists (select 1 from cron.job where jobname = 'saas-billing-daily');

select cron.schedule('saas-billing-daily', '0 12 * * *', $$select public.saas_billing_run()$$);
