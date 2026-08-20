-- Modelo de tarefas por tipo de evento: a casa repete os mesmos eventos toda semana,
-- então a checklist é praticamente a mesma. Monta-se uma vez e gera-se a cada evento.
CREATE TABLE IF NOT EXISTS public.task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.task_templates(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  area text NOT NULL,
  area_icon text DEFAULT '📋',
  -- prazo relativo ao início do evento, em minutos (negativo = antes de abrir)
  offset_min int,
  sort_order int DEFAULT 0
);

CREATE INDEX IF NOT EXISTS task_templates_house_idx ON public.task_templates(house_id);
CREATE INDEX IF NOT EXISTS task_template_items_tpl_idx ON public.task_template_items(template_id);

ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_templates_member_all ON public.task_templates
  FOR ALL TO authenticated
  USING (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid() AND is_active = true));

CREATE POLICY task_template_items_member_all ON public.task_template_items
  FOR ALL TO authenticated
  USING (template_id IN (SELECT id FROM task_templates))
  WITH CHECK (template_id IN (SELECT id FROM task_templates));
