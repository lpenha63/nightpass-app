-- event_tasks estava com policy ALL / qual=true para public: qualquer pessoa com a chave
-- anon (que vai no HTML) lia TODAS as tarefas de TODAS as casas -- inclusive nome e
-- telefone de quem executa -- e ainda conseguia inserir/alterar/apagar linhas.
DROP POLICY IF EXISTS "house members can manage event_tasks" ON public.event_tasks;

-- Quem tem login: só a(s) casa(s) de que a pessoa participa (mesmo padrão de events/freelancers)
CREATE POLICY event_tasks_member_all ON public.event_tasks
  FOR ALL TO authenticated
  USING (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid() AND is_active = true));

-- Link público de uma tarefa (tarefa.html): só a linha cujo token vem no cabeçalho.
CREATE POLICY event_tasks_token_read ON public.event_tasks
  FOR SELECT TO anon
  USING (token::text = current_setting('request.headers', true)::json ->> 'x-np-token');

CREATE POLICY event_tasks_token_update ON public.event_tasks
  FOR UPDATE TO anon
  USING (token::text = current_setting('request.headers', true)::json ->> 'x-np-token')
  WITH CHECK (token::text = current_setting('request.headers', true)::json ->> 'x-np-token');
