-- Delegação de tarefas pelo portal POR TOKEN (agenda.html), gated por can_delegate_tasks

-- Lista de destinos (equipe da casa) para o portador do token que pode delegar
CREATE OR REPLACE FUNCTION public.freelancer_team(p_token uuid)
 RETURNS TABLE(id uuid, full_name text, phone text, staff_type text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record;
begin
  select fr.id as fid, fr.house_id, fr.can_delegate_tasks into cf
  from freelancers fr where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null or not coalesce(cf.can_delegate_tasks, false) then return; end if;
  return query
    select fr.id, fr.full_name, fr.phone, fr.staff_type
    from freelancers fr
    where fr.house_id = cf.house_id and coalesce(fr.status,'') <> 'inativo'
    order by (case when fr.staff_type = 'funcionario' then 0 else 1 end), fr.full_name;
end; $function$;

-- Cria/atribui tarefa a partir do portal por token
CREATE OR REPLACE FUNCTION public.freelancer_create_task(p_token uuid, p_target uuid, p_title text, p_deadline timestamptz DEFAULT NULL, p_event uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record; tgt record; newid uuid;
begin
  select fr.id as fid, fr.house_id, fr.can_delegate_tasks into cf
  from freelancers fr where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null or not coalesce(cf.can_delegate_tasks, false) then
    return jsonb_build_object('ok', false, 'error', 'Sem permissão');
  end if;
  if coalesce(btrim(p_title), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Título obrigatório');
  end if;
  select fr.id as fid, fr.full_name, fr.phone into tgt from freelancers fr where fr.id = p_target and fr.house_id = cf.house_id;
  if tgt.fid is null then return jsonb_build_object('ok', false, 'error', 'Colaborador inválido'); end if;
  insert into event_tasks(house_id, event_id, area, area_icon, title, deadline,
    freelancer_id, assignee_name, assignee_phone, status, sort_order, created_by_freelancer_id)
  values (cf.house_id, p_event, 'Geral', '📋', btrim(p_title), p_deadline,
    tgt.fid, tgt.full_name, tgt.phone, 'pending', 0, cf.fid)
  returning id into newid;
  return jsonb_build_object('ok', true, 'id', newid, 'assignee', tgt.full_name);
end; $function$;
