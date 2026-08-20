-- Ao gerar do modelo, criar também os passos do item. Uma checklist como
-- "LIMPEZA COZINHA" se repete toda semana — redigitar os passos anularia o modelo.
CREATE OR REPLACE FUNCTION public.apply_task_template(p_event uuid, p_template uuid)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
  v_house uuid; v_base timestamptz; v_tpl_house uuid;
  v_criadas int := 0; v_puladas int := 0; v_sem text[] := '{}';
  it record; m record; n_escalados int; v_new uuid; i int;
BEGIN
  SELECT e.house_id,
         ((e.event_date + COALESCE(e.start_time, '22:00'::time)) AT TIME ZONE 'America/Sao_Paulo')
    INTO v_house, v_base
  FROM events e WHERE e.id = p_event;
  IF v_house IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Evento não encontrado');
  END IF;

  SELECT house_id INTO v_tpl_house FROM task_templates WHERE id = p_template;
  IF v_tpl_house IS NULL OR v_tpl_house <> v_house THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Modelo não pertence a esta casa');
  END IF;

  FOR it IN SELECT * FROM task_template_items WHERE template_id = p_template ORDER BY sort_order, title LOOP
    n_escalados := 0;
    FOR m IN
      SELECT ef.freelancer_id AS fid, f.full_name, f.phone
      FROM event_freelancers ef
      JOIN freelancers f ON f.id = ef.freelancer_id
      WHERE ef.event_id = p_event
        AND COALESCE(NULLIF(ef.role, ''), f.work_types[1], 'outros') = it.area
    LOOP
      n_escalados := n_escalados + 1;
      IF EXISTS (SELECT 1 FROM event_tasks t
                  WHERE t.event_id = p_event AND t.freelancer_id = m.fid
                    AND lower(t.title) = lower(it.title)) THEN
        v_puladas := v_puladas + 1;
      ELSE
        INSERT INTO event_tasks(event_id, house_id, area, area_icon, title, description,
                                deadline, freelancer_id, assignee_name, assignee_phone, status, sort_order)
        VALUES (p_event, v_house, it.area, COALESCE(it.area_icon, '📋'), it.title, it.description,
                CASE WHEN it.offset_min IS NULL THEN NULL
                     ELSE v_base + (it.offset_min || ' minutes')::interval END,
                m.fid, m.full_name, m.phone, 'pending', COALESCE(it.sort_order, 0))
        RETURNING id INTO v_new;

        IF it.steps IS NOT NULL THEN
          i := 0;
          INSERT INTO task_steps(task_id, title, sort_order)
          SELECT v_new, s, ord - 1
          FROM unnest(it.steps) WITH ORDINALITY AS u(s, ord)
          WHERE btrim(s) <> '';
        END IF;

        v_criadas := v_criadas + 1;
      END IF;
    END LOOP;
    IF n_escalados = 0 THEN v_sem := array_append(v_sem, it.area); END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'criadas', v_criadas, 'puladas', v_puladas,
    'areas_sem_equipe', to_jsonb(ARRAY(SELECT DISTINCT unnest(v_sem)))
  );
END; $function$;
