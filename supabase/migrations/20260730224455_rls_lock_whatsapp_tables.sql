-- ETAPA 1 (crítico): credenciais e logs do WhatsApp estavam abertos ao público (anon).
-- Nenhuma página pública usa essas tabelas; Edge Functions usam service_role (não passam por RLS).
DROP POLICY IF EXISTS wcfg_open ON whatsapp_config;
CREATE POLICY whatsapp_config_member ON whatsapp_config
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = whatsapp_config.house_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = whatsapp_config.house_id AND hu.user_id = auth.uid() AND hu.is_active));

DROP POLICY IF EXISTS wlog_open ON whatsapp_logs;
CREATE POLICY whatsapp_logs_member ON whatsapp_logs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = whatsapp_logs.house_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = whatsapp_logs.house_id AND hu.user_id = auth.uid() AND hu.is_active));

DROP POLICY IF EXISTS wtpl_open ON whatsapp_templates;
CREATE POLICY whatsapp_templates_member ON whatsapp_templates
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = whatsapp_templates.house_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = whatsapp_templates.house_id AND hu.user_id = auth.uid() AND hu.is_active));
