
-- Token de acesso QR para promoters
CREATE TABLE IF NOT EXISTS promoter_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID REFERENCES promoters(id) ON DELETE CASCADE,
  house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promoter_tokens_token ON promoter_tokens(token);
CREATE INDEX IF NOT EXISTS idx_promoter_tokens_promoter ON promoter_tokens(promoter_id);

-- Gerar token para promoters existentes
INSERT INTO promoter_tokens (promoter_id, house_id)
SELECT id, house_id FROM promoters WHERE status = 'ativo'
ON CONFLICT DO NOTHING;

-- Trigger para novos promoters
CREATE OR REPLACE FUNCTION create_promoter_token()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO promoter_tokens (promoter_id, house_id) VALUES (NEW.id, NEW.house_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_promoter_token ON promoters;
CREATE TRIGGER trg_promoter_token
  AFTER INSERT ON promoters FOR EACH ROW EXECUTE FUNCTION create_promoter_token();

-- RLS
ALTER TABLE promoter_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS token_public_read ON promoter_tokens;
DROP POLICY IF EXISTS token_service_write ON promoter_tokens;
CREATE POLICY token_public_read ON promoter_tokens FOR SELECT USING (true);
CREATE POLICY token_service_write ON promoter_tokens FOR ALL USING (true);

ALTER TABLE promoter_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promoter_lists_open ON promoter_lists;
CREATE POLICY promoter_lists_open ON promoter_lists FOR ALL USING (true);

ALTER TABLE promoter_list_guests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guests_open ON promoter_list_guests;
CREATE POLICY guests_open ON promoter_list_guests FOR ALL USING (true);

ALTER TABLE promoters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promoters_open ON promoters;
CREATE POLICY promoters_open ON promoters FOR ALL USING (true);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_open ON events;
CREATE POLICY events_open ON events FOR ALL USING (true);

ALTER TABLE houses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS houses_open ON houses;
CREATE POLICY houses_open ON houses FOR ALL USING (true);
