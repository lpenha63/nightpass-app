-- 1) A agenda passa a devolver o horário de entrada combinado: o app precisa dele para
--    mostrar quando o ponto abre, em vez de deixar a pessoa tocar e tomar erro.
CREATE OR REPLACE FUNCTION public.agenda_for_freelancer(p_fid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare f record; result jsonb;
begin
  select id, full_name, phone, staff_type, house_id, can_delegate_tasks, can_see_all_events into f
    from freelancers where id = p_fid;
  if f.id is null then return null; end if;
  select jsonb_build_object(
    'freelancer', jsonb_build_object('name', f.full_name, 'staff_type', f.staff_type,
      'can_delegate', coalesce(f.can_delegate_tasks, false),
      'can_see_all', coalesce(f.can_see_all_events, false),
      'geo_on', (select h.lat is not null and h.lng is not null from houses h where h.id = f.house_id)),
    'events', coalesce((
      select jsonb_agg(ev order by (ev->>'event_date'))
      from (
        select jsonb_build_object(
          'id', e.id, 'name', e.name, 'event_date', e.event_date, 'start_time', e.start_time,
          'confirmed', coalesce(ef.confirmed, false), 'responded_at', ef.responded_at,
          'scaled', (ef.id is not null),
          'checkin_at', ef.checkin_at, 'checkout_at', ef.checkout_at, 'role', ef.role,
          'entry_time', ef.entry_time,
          'tasks', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', t.id, 'title', t.title, 'area', t.area, 'area_icon', t.area_icon,
              'description', t.description, 'deadline', t.deadline, 'status', t.status,
              'completed_at', t.completed_at, 'block_reason', t.block_reason, 'blocked_at', t.blocked_at
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
    'upcoming', case when coalesce(f.can_see_all_events, false) then coalesce((
      select jsonb_agg(u order by (u->>'event_date'))
      from (
        select jsonb_build_object(
          'id', e.id, 'name', e.name, 'event_date', e.event_date, 'start_time', e.start_time,
          'reservas', (select count(*) from reservations r
                        where r.house_id = f.house_id and coalesce(r.status,'') <> 'cancelled'
                          and (r.event_id = e.id or (r.event_id is null and r.reservation_date = e.event_date))),
          'convidados', (
            (select coalesce(sum(r.people_count), 0) from reservations r
              where r.house_id = f.house_id and coalesce(r.status,'') <> 'cancelled'
                and (r.event_id = e.id or (r.event_id is null and r.reservation_date = e.event_date)))
            + (select count(*) from promoter_list_guests g where g.event_id = e.id)
          )
        ) as u
        from events e
        where e.house_id = f.house_id and e.status not in ('cancelado','encerrado') and e.event_date >= current_date
        order by e.event_date limit 30
      ) subu
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end; $function$;

-- 2) Desligar os avisos: o toggle precisa do caminho de volta
CREATE OR REPLACE FUNCTION public.freelancer_push_unsubscribe(p_token uuid, p_endpoint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record;
begin
  select fr.id as fid into cf from freelancers fr
   where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null then return jsonb_build_object('ok', false, 'error', 'Link inválido'); end if;
  delete from push_subscriptions
   where endpoint = p_endpoint and freelancer_id = cf.fid;
  return jsonb_build_object('ok', true);
end; $function$;

GRANT EXECUTE ON FUNCTION public.freelancer_push_unsubscribe(uuid, text) TO anon, authenticated;
