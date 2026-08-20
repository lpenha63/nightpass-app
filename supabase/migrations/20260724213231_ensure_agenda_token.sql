create or replace function public.ensure_agenda_token(p_freelancer uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare tok uuid; ph text; nm text; hid uuid;
begin
  select access_token, phone, full_name, house_id into tok, ph, nm, hid
  from freelancers where id = p_freelancer;
  if nm is null then return null; end if;
  -- só um membro ativo da mesma casa pode obter o token
  if not exists (select 1 from house_users hu where hu.user_id = auth.uid() and hu.house_id = hid and hu.is_active = true) then
    return null;
  end if;
  if tok is null then
    tok := gen_random_uuid();
    update freelancers set access_token = tok where id = p_freelancer;
  end if;
  return jsonb_build_object('token', tok, 'phone', ph, 'name', nm);
end; $$;
grant execute on function public.ensure_agenda_token(uuid) to authenticated;
