alter table public.event_tasks add column if not exists created_by_freelancer_id uuid;

create or replace function public.staff_team()
 returns table(id uuid, full_name text, phone text, staff_type text)
 language plpgsql security definer set search_path to 'public'
as $$
declare cf record;
begin
  select fr.id as fid, fr.house_id, fr.staff_type into cf
  from house_users hu join freelancers fr on fr.id = hu.freelancer_id
  where hu.user_id = auth.uid() and hu.is_active = true limit 1;
  if cf.fid is null or cf.staff_type <> 'funcionario' then return; end if;
  return query
    select fr.id, fr.full_name, fr.phone, fr.staff_type
    from freelancers fr
    where fr.house_id = cf.house_id and coalesce(fr.status,'') <> 'inativo'
    order by (case when fr.staff_type = 'funcionario' then 0 else 1 end), fr.full_name;
end; $$;
grant execute on function public.staff_team() to authenticated;

create or replace function public.staff_create_task(p_target uuid, p_title text, p_description text default null, p_deadline timestamptz default null, p_event uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare cf record; tgt record; newid uuid;
begin
  select fr.id as fid, fr.house_id, fr.staff_type into cf
  from house_users hu join freelancers fr on fr.id = hu.freelancer_id
  where hu.user_id = auth.uid() and hu.is_active = true limit 1;
  if cf.fid is null or cf.staff_type <> 'funcionario' then
    return jsonb_build_object('ok', false, 'error', 'Sem permissão');
  end if;
  if coalesce(btrim(p_title), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Título obrigatório');
  end if;
  select fr.id as fid, fr.full_name, fr.phone into tgt from freelancers fr where fr.id = p_target and fr.house_id = cf.house_id;
  if tgt.fid is null then return jsonb_build_object('ok', false, 'error', 'Colaborador inválido'); end if;
  insert into event_tasks(house_id, event_id, area, area_icon, title, description, deadline,
    freelancer_id, assignee_name, assignee_phone, status, sort_order, created_by_freelancer_id)
  values (cf.house_id, p_event, 'Geral', '📋', btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_deadline,
    tgt.fid, tgt.full_name, tgt.phone, 'pending', 0, cf.fid)
  returning id into newid;
  return jsonb_build_object('ok', true, 'id', newid, 'assignee', tgt.full_name);
end; $$;
grant execute on function public.staff_create_task(uuid, text, text, timestamptz, uuid) to authenticated;

create or replace function public.staff_sent_tasks()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare cf record;
begin
  select fr.id as fid, fr.staff_type into cf
  from house_users hu join freelancers fr on fr.id = hu.freelancer_id
  where hu.user_id = auth.uid() and hu.is_active = true limit 1;
  if cf.fid is null or cf.staff_type <> 'funcionario' then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'status', t.status, 'deadline', t.deadline,
      'completed_at', t.completed_at, 'assignee_name', t.assignee_name,
      'event_name', e.name, 'event_date', e.event_date
    ) order by t.created_at desc)
    from event_tasks t left join events e on e.id = t.event_id
    where t.created_by_freelancer_id = cf.fid
  ), '[]'::jsonb);
end; $$;
grant execute on function public.staff_sent_tasks() to authenticated;
