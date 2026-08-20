
-- Log de mensagens WhatsApp enviadas
CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN ('checkin_confirm','birthday_wish','event_invite','promoter_qr','custom')),
  message_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','queued')),
  error_msg TEXT,
  related_client_id UUID REFERENCES clients(id),
  related_event_id UUID REFERENCES events(id),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wlog_house ON whatsapp_logs(house_id);
CREATE INDEX IF NOT EXISTS idx_wlog_status ON whatsapp_logs(status);
CREATE INDEX IF NOT EXISTS idx_wlog_created ON whatsapp_logs(created_at DESC);

-- Templates de mensagens por estabelecimento
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('checkin_confirm','birthday_wish','event_invite','promoter_qr')),
  body TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(house_id, type)
);

-- Templates padrão serão inseridos via função
-- RLS
ALTER TABLE whatsapp_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wlog_open ON whatsapp_logs;
CREATE POLICY wlog_open ON whatsapp_logs FOR ALL USING (true);

ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wtpl_open ON whatsapp_templates;
CREATE POLICY wtpl_open ON whatsapp_templates FOR ALL USING (true);

ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wcfg_open ON whatsapp_config;
CREATE POLICY wcfg_open ON whatsapp_config FOR ALL USING (true);
