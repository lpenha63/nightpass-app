-- Marcar/desmarcar um passo pelo app da equipe (link por token).
-- Ao marcar o último passo a tarefa se conclui sozinha; ao desmarcar qualquer um, reabre.
CREATE OR REPLACE FUNCTION public.freelancer_step_toggle(p_token uuid, p_step_id uuid, p_done boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE f record; v_task uuid; v_falta int;
BEGIN
  SELECT id, full_name, phone INTO f FROM freelancers WHERE access_token = p_token AND status = 'ativo';
  IF f.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Link inválido'); END IF;

  SELECT s.task_id INTO v_task
  FROM task_steps s JOIN event_tasks t ON t.id = s.task_id
  WHERE s.id = p_step_id
    AND (t.freelancer_id = f.id OR (f.phone IS NOT NULL AND regexp_replace(COALESCE(t.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g')));
  IF v_task IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Passo não encontrado'); END IF;

  UPDATE task_steps SET done = p_done,
         done_at = CASE WHEN p_done THEN now() ELSE NULL END,
         done_by = CASE WHEN p_done THEN f.full_name ELSE NULL END
   WHERE id = p_step_id;

  SELECT count(*) INTO v_falta FROM task_steps WHERE task_id = v_task AND NOT done;

  IF v_falta = 0 THEN
    UPDATE event_tasks SET status='done', completed_at=now(), completed_by=f.full_name,
           block_reason=NULL, blocked_at=NULL, blocked_by=NULL
     WHERE id = v_task AND status <> 'done';
  ELSE
    UPDATE event_tasks SET status='pending', completed_at=NULL, completed_by=NULL
     WHERE id = v_task AND status = 'done';
  END IF;

  RETURN jsonb_build_object('ok', true, 'faltam', v_falta, 'tarefa_concluida', v_falta = 0);
END; $function$;

GRANT EXECUTE ON FUNCTION public.freelancer_step_toggle(uuid, uuid, boolean) TO anon, authenticated;

-- Concluir a tarefa inteira marca todos os passos; reabrir desmarca todos.
-- Sem isso a tarefa ficaria "feita" com passos em aberto (ou o contrário), e o
-- colaborador veria 2/3 numa tarefa concluída.
CREATE OR REPLACE FUNCTION public.freelancer_task_toggle(p_token uuid, p_task_id uuid, p_done boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE f record; ok boolean;
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
    completed_by = CASE WHEN p_done THEN f.full_name ELSE NULL END,
    block_reason = NULL, blocked_at = NULL, blocked_by = NULL
  WHERE id = p_task_id;

  UPDATE task_steps SET done = p_done,
         done_at = CASE WHEN p_done THEN now() ELSE NULL END,
         done_by = CASE WHEN p_done THEN f.full_name ELSE NULL END
   WHERE task_id = p_task_id;

  RETURN true;
END; $function$;

-- Mesmo par para quem usa o app logado
CREATE OR REPLACE FUNCTION public.my_step_toggle(p_step_id uuid, p_done boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE fid uuid; tok uuid;
BEGIN
  SELECT freelancer_id INTO fid FROM house_users
   WHERE user_id = auth.uid() AND is_active = true AND freelancer_id IS NOT NULL LIMIT 1;
  IF fid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Conta não vinculada'); END IF;
  SELECT access_token INTO tok FROM freelancers WHERE id = fid;
  RETURN freelancer_step_toggle(tok, p_step_id, p_done);
END; $function$;

GRANT EXECUTE ON FUNCTION public.my_step_toggle(uuid, boolean) TO authenticated;
