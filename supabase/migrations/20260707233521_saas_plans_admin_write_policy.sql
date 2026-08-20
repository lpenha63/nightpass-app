-- Permite que o dono da plataforma (is_saas_admin) crie/edite/exclua planos
-- pela central upure-admin. Espelha saas_products_admin_write.
create policy saas_plans_admin_write on public.saas_plans
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_saas_admin));
