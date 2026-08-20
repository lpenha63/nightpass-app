-- Acompanhamento das tarefas que ESTE colaborador delegou (portal por token).
-- Espelha staff_sent_tasks(), mas autentica pelo access_token e checa can_delegate_tasks.
CREATE OR REPLACE FUNCTION public.freelancer_sent_tasks(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record;
begin
  select fr.id as fid, fr.can_delegate_tasks into cf
  from freelancers fr where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null or not coalesce(cf.can_delegate_tasks, false) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'status', t.status, 'deadline', t.deadline,
      'completed_at', t.completed_at, 'completed_by', t.completed_by,
      'assignee_name', t.assignee_name, 'created_at', t.created_at,
      'event_name', e.name, 'event_date', e.event_date
    ) order by t.created_at desc)
    from event_tasks t left join events e on e.id = t.event_id
    where t.created_by_freelancer_id = cf.fid
  ), '[]'::jsonb);
end; $function$;
