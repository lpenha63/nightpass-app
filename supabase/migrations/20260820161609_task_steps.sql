-- Subtarefas (passos) de uma tarefa: "LIMPEZA COZINHA" → limpar chapa, coifa, retirar óleo.
-- Tabela própria, e NÃO uma tarefa-filha em event_tasks, de propósito: todo contador do
-- sistema (A fazer, badge do app, % do evento, relatórios do gestor) soma linhas de
-- event_tasks. Pai+filhos ali dentro inflariam esses números sem ninguém perceber.
CREATE TABLE IF NOT EXISTS public.task_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.event_tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_steps_task_idx ON public.task_steps(task_id, sort_order);

ALTER TABLE public.task_steps ENABLE ROW LEVEL SECURITY;

-- Mesma regra da tarefa dona: quem enxerga a tarefa, enxerga os passos dela.
CREATE POLICY task_steps_member_all ON public.task_steps
  FOR ALL TO authenticated
  USING (task_id IN (SELECT id FROM event_tasks))
  WITH CHECK (task_id IN (SELECT id FROM event_tasks));

-- Link público de uma tarefa (tarefa.html) enxerga os passos da própria tarefa
CREATE POLICY task_steps_token_read ON public.task_steps
  FOR SELECT TO anon
  USING (task_id IN (SELECT id FROM event_tasks
                      WHERE token::text = current_setting('request.headers', true)::json ->> 'x-np-token'));

-- Modelos de tarefa também carregam os passos, senão a checklist recorrente
-- teria de ser redigitada a cada evento.
ALTER TABLE public.task_template_items ADD COLUMN IF NOT EXISTS steps text[];
