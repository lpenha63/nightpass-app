-- Tarefa "não feita": exige justificativa e vira ocorrência para o gestor.
ALTER TABLE event_tasks ADD COLUMN IF NOT EXISTS block_reason text;
ALTER TABLE event_tasks ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE event_tasks ADD COLUMN IF NOT EXISTS blocked_by text;
-- vínculo da ocorrência com a tarefa que a originou
ALTER TABLE staff_reports ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES event_tasks(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.freelancer_task_block(p_token uuid, p_task_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare f record; t record;
begin
  select id, full_name, phone, house_id into f
    from freelancers where access_token = p_token and status = 'ativo';
  if f.id is null then return jsonb_build_object('ok', false, 'error', 'Link inválido'); end if;
  if coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Explique o que aconteceu');
  end if;

  -- só pode marcar tarefa que é dele
  select t2.* into t from event_tasks t2
   where t2.id = p_task_id
     and (t2.freelancer_id = f.id
          or (f.phone is not null and regexp_replace(coalesce(t2.assignee_phone,''),'\D','','g') = regexp_replace(f.phone,'\D','','g')));
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'Tarefa não encontrada'); end if;

  update event_tasks
     set status = 'blocked', block_reason = btrim(p_reason), blocked_at = now(), blocked_by = f.full_name,
         completed_at = null, completed_by = null
   where id = p_task_id;

  -- gera a ocorrência para o gestor (aparece no painel Agenda)
  insert into staff_reports(house_id, event_id, freelancer_id, author_name, target, category, message, task_id)
  values (f.house_id, t.event_id, f.id, f.full_name, 'adm', 'tarefa',
          '⚠️ ' || t.title || ' — ' || btrim(p_reason), p_task_id);

  return jsonb_build_object('ok', true);
end; $function$;

-- Reabrir/concluir volta a limpar o bloqueio
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
  RETURN true;
END; $function$;
