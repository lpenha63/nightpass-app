
-- Token pessoal do colaborador (link da agenda, sem senha)
ALTER TABLE freelancers ADD COLUMN IF NOT EXISTS access_token uuid UNIQUE DEFAULT gen_random_uuid();
UPDATE freelancers SET access_token = gen_random_uuid() WHERE access_token IS NULL;

-- Agenda do colaborador: eventos onde está escalado + eventos com tarefas dele,
-- com as tarefas atribuídas (por freelancer_id ou telefone). SECURITY DEFINER: só devolve
-- os dados desse colaborador, sem afrouxar o RLS das tabelas.
CREATE OR REPLACE FUNCTION freelancer_agenda(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f record;
  result jsonb;
BEGIN
  SELECT id, full_name, phone, staff_type, house_id INTO f
  FROM freelancers WHERE access_token = p_token AND status = 'ativo';
  IF f.id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'freelancer', jsonb_build_object('name', f.full_name, 'staff_type', f.staff_type),
    'events', COALESCE((
      SELECT jsonb_agg(ev ORDER BY (ev->>'event_date'))
      FROM (
        SELECT jsonb_build_object(
          'id', e.id, 'name', e.name, 'event_date', e.event_date, 'start_time', e.start_time,
          'confirmed', COALESCE(ef.confirmed, false),
          'checkin_at', ef.checkin_at, 'checkout_at', ef.checkout_at,
          'role', ef.role,
          'tasks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', t.id, 'title', t.title, 'area', t.area, 'area_icon', t.area_icon,
              'description', t.description, 'deadline', t.deadline, 'status', t.status,
              'completed_at', t.completed_at
            ) ORDER BY t.deadline NULLS LAST, t.sort_order)
            FROM event_tasks t
            WHERE t.event_id = e.id
              AND (t.freelancer_id = f.id OR (f.phone IS NOT NULL AND regexp_replace(COALESCE(t.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g')))
          ), '[]'::jsonb)
        ) AS ev
        FROM events e
        LEFT JOIN event_freelancers ef ON ef.event_id = e.id AND ef.freelancer_id = f.id
        WHERE e.house_id = f.house_id
          AND e.status <> 'cancelado'
          AND e.event_date >= (current_date - 1)
          AND (
            ef.id IS NOT NULL
            OR EXISTS (SELECT 1 FROM event_tasks t2 WHERE t2.event_id = e.id
                       AND (t2.freelancer_id = f.id OR (f.phone IS NOT NULL AND regexp_replace(COALESCE(t2.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g'))))
          )
      ) sub
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

-- Marca/desmarca tarefa como concluída — só se a tarefa for do colaborador do token
CREATE OR REPLACE FUNCTION freelancer_task_toggle(p_token uuid, p_task_id uuid, p_done boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f record;
  ok boolean;
BEGIN
  SELECT id, full_name, phone INTO f FROM freelancers WHERE access_token = p_token AND status = 'ativo';
  IF f.id IS NULL THEN RETURN false; END IF;

  SELECT EXISTS (
    SELECT 1 FROM event_tasks t WHERE t.id = p_task_id
      AND (t.freelancer_id = f.id OR (f.phone IS NOT NULL AND regexp_replace(COALESCE(t.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g')))
  ) INTO ok;
  IF NOT ok THEN RETURN false; END IF;

  UPDATE event_tasks SET
    status = CASE WHEN p_done THEN 'done' ELSE 'pending' END,
    completed_at = CASE WHEN p_done THEN now() ELSE NULL END,
    completed_by = CASE WHEN p_done THEN f.full_name ELSE NULL END
  WHERE id = p_task_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION freelancer_agenda(uuid) TO anon;
GRANT EXECUTE ON FUNCTION freelancer_task_toggle(uuid, uuid, boolean) TO anon;
