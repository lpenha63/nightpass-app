create or replace function public.agenda_for_freelancer(p_fid uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare f record; result jsonb;
begin
  select id, full_name, phone, staff_type, house_id into f from freelancers where id = p_fid;
  if f.id is null then return null; end if;
  select jsonb_build_object(
    'freelancer', jsonb_build_object('name', f.full_name, 'staff_type', f.staff_type),
    'events', coalesce((
      select jsonb_agg(ev order by (ev->>'event_date'))
      from (
        select jsonb_build_object(
          'id', e.id, 'name', e.name, 'event_date', e.event_date, 'start_time', e.start_time,
          'confirmed', coalesce(ef.confirmed, false), 'checkin_at', ef.checkin_at, 'checkout_at', ef.checkout_at, 'role', ef.role,
          'tasks', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', t.id, 'title', t.title, 'area', t.area, 'area_icon', t.area_icon,
              'description', t.description, 'deadline', t.deadline, 'status', t.status, 'completed_at', t.completed_at
            ) order by t.deadline nulls last, t.sort_order)
            from event_tasks t where t.event_id = e.id
              and (t.freelancer_id = f.id or (f.phone is not null and regexp_replace(coalesce(t.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g')))
          ), '[]'::jsonb)
        ) as ev
        from events e
        left join event_freelancers ef on ef.event_id = e.id and ef.freelancer_id = f.id
        where e.house_id = f.house_id and e.status <> 'cancelado' and e.event_date >= (current_date - 1)
          and ( ef.id is not null or exists (select 1 from event_tasks t2 where t2.event_id = e.id
                and (t2.freelancer_id = f.id or (f.phone is not null and regexp_replace(coalesce(t2.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g')))) )
      ) sub
    ), '[]'::jsonb),
    -- Próximos eventos da casa + nº de reservas: SÓ para funcionários (gate no servidor)
    'upcoming', case when f.staff_type = 'funcionario' then coalesce((
      select jsonb_agg(u order by (u->>'event_date'))
      from (
        select jsonb_build_object(
          'id', e.id, 'name', e.name, 'event_date', e.event_date, 'start_time', e.start_time,
          'reservas', (select count(*) from reservations r
                        where r.house_id = f.house_id and coalesce(r.status,'') <> 'cancelled'
                          and (r.event_id = e.id or (r.event_id is null and r.reservation_date = e.event_date)))
        ) as u
        from events e
        where e.house_id = f.house_id and e.status not in ('cancelado','encerrado') and e.event_date >= current_date
        order by e.event_date
        limit 30
      ) subu
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end; $function$;

-- Unifica: a versão por token só resolve o id (com status ativo) e reusa a função acima
create or replace function public.freelancer_agenda(p_token uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare fid uuid;
begin
  select id into fid from freelancers where access_token = p_token and status = 'ativo';
  if fid is null then return null; end if;
  return agenda_for_freelancer(fid);
end; $function$;
