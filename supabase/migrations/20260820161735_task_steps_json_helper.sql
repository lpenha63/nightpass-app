-- Passos de uma tarefa em JSON. Isolado numa função porque a agenda monta a mesma
-- estrutura em dois lugares (tarefas de evento e avulsas).
CREATE OR REPLACE FUNCTION public.task_steps_json(p_task uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'title', s.title, 'done', s.done, 'done_by', s.done_by
         ) ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
  FROM task_steps s WHERE s.task_id = p_task;
$function$;
