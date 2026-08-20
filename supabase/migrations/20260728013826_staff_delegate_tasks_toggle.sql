-- Permissão por membro para enviar/delegar tarefas à equipe (antes era "todo funcionário")
ALTER TABLE freelancers ADD COLUMN IF NOT EXISTS can_delegate_tasks boolean NOT NULL DEFAULT false;
-- Preserva o comportamento atual: funcionários existentes já podem delegar
UPDATE freelancers SET can_delegate_tasks = true WHERE staff_type = 'funcionario' AND can_delegate_tasks = false;

-- staff_team: lista de destinos — libera para quem tem o flag
CREATE OR REPLACE FUNCTION public.staff_team()
 RETURNS TABLE(id uuid, full_name text, phone text, staff_type text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record;
begin
  select fr.id as fid, fr.house_id, fr.can_delegate_tasks into cf
  from house_users hu join freelancers fr on fr.id = hu.freelancer_id
  where hu.user_id = auth.uid() and hu.is_active = true limit 1;
  if cf.fid is null or not coalesce(cf.can_delegate_tasks, false) then return; end if;
  return query
    select fr.id, fr.full_name, fr.phone, fr.staff_type
    from freelancers fr
    where fr.house_id = cf.house_id and coalesce(fr.status,'') <> 'inativo'
    order by (case when fr.staff_type = 'funcionario' then 0 else 1 end), fr.full_name;
end; $function$;

-- staff_create_task: cria/atribui tarefa — libera para quem tem o flag
CREATE OR REPLACE FUNCTION public.staff_create_task(p_target uuid, p_title text, p_description text DEFAULT NULL::text, p_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record; tgt record; newid uuid;
begin
  select fr.id as fid, fr.house_id, fr.can_delegate_tasks into cf
  from house_users hu join freelancers fr on fr.id = hu.freelancer_id
  where hu.user_id = auth.uid() and hu.is_active = true limit 1;
  if cf.fid is null or not coalesce(cf.can_delegate_tasks, false) then
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
end; $function$;
