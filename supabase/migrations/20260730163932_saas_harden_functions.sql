-- search_path fixo (evita sequestro de resolução de nome em função de trigger)
create or replace function public.saas_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$ begin new.updated_at = now(); return new; end $$;

-- Funções de trigger não devem ser chamáveis via /rest/v1/rpc
revoke execute on function public.saas_auto_trial()      from anon, authenticated;
revoke execute on function public.saas_set_updated_at()  from anon, authenticated;
