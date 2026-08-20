
-- ═══════════════════════ MODELO SAAS — NIGHTPASS ═══════════════════════
-- Assinaturas por casa (tenant = houses). Gateway: Mercado Pago (preapproval).
-- Status efetivo é derivado em runtime (sem dependência de cron para bloqueio).

-- ── 1. Catálogo de planos ──
CREATE TABLE IF NOT EXISTS saas_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,                -- 'basico' | 'profissional' | 'premium' | 'interno'
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL DEFAULT 0,
  billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','yearly')),
  trial_days integer NOT NULL DEFAULT 0,
  -- Limites numéricos (null = ilimitado)
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { max_users, max_events_month, max_clients, max_whatsapp_month }
  -- Módulos liberados (booleans)
  features jsonb NOT NULL DEFAULT '{}'::jsonb, -- { whatsapp, tickets, reports_advanced, campaigns, api_access }
  mp_plan_id text,                          -- preapproval_plan_id do Mercado Pago (opcional)
  active boolean NOT NULL DEFAULT true,     -- aparece na vitrine
  highlight boolean NOT NULL DEFAULT false, -- "mais popular"
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Assinaturas (uma viva por casa; histórico preservado) ──
CREATE TABLE IF NOT EXISTS saas_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES saas_plans(id),
  status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing','pending','active','past_due','suspended','canceled','comp')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,                  -- carência após falha de pagamento
  mp_preapproval_id text,                   -- id da assinatura no Mercado Pago
  payer_email text,
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Apenas UMA assinatura não-cancelada por casa
CREATE UNIQUE INDEX IF NOT EXISTS saas_subscriptions_house_live
  ON saas_subscriptions(house_id) WHERE status <> 'canceled';
CREATE INDEX IF NOT EXISTS saas_subscriptions_mp ON saas_subscriptions(mp_preapproval_id);

-- ── 3. Pagamentos ──
CREATE TABLE IF NOT EXISTS saas_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES saas_subscriptions(id) ON DELETE SET NULL,
  house_id uuid REFERENCES houses(id) ON DELETE SET NULL,
  mp_payment_id text UNIQUE,                -- idempotência de webhook
  amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','refunded','chargeback')),
  method text,                              -- pix | credit_card | boleto
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  raw jsonb,                                -- payload bruto do gateway
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_payments_house ON saas_payments(house_id, created_at DESC);

-- ── 4. Eventos de webhook (idempotência + auditoria) ──
CREATE TABLE IF NOT EXISTS saas_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'mercadopago',
  topic text,                               -- payment | preapproval | authorized_payment
  external_id text,                         -- id do recurso no gateway
  payload jsonb,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_webhook_ext ON saas_webhook_events(provider, topic, external_id);

-- ── 5. Auditoria de ações administrativas ──
CREATE TABLE IF NOT EXISTS saas_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  house_id uuid,
  action text NOT NULL,                     -- plan_change | suspend | reactivate | comp | note
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 6. Flag de dono do SaaS ──
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_saas_admin boolean NOT NULL DEFAULT false;

-- ── 7. updated_at automático ──
CREATE OR REPLACE FUNCTION saas_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_saas_sub_touch ON saas_subscriptions;
CREATE TRIGGER trg_saas_sub_touch BEFORE UPDATE ON saas_subscriptions
  FOR EACH ROW EXECUTE FUNCTION saas_touch_updated_at();

-- ── 8. Status efetivo derivado (fonte única da regra de bloqueio) ──
-- trialing vencido → 'suspended'; past_due com carência vencida → 'suspended'
CREATE OR REPLACE FUNCTION saas_effective_status(p_status text, p_trial_ends timestamptz, p_grace timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_status = 'trialing' AND p_trial_ends IS NOT NULL AND p_trial_ends < now() THEN 'suspended'
    WHEN p_status = 'past_due' AND p_grace IS NOT NULL AND p_grace < now() THEN 'suspended'
    ELSE p_status
  END
$$;

-- ── 9. RLS ──
ALTER TABLE saas_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_audit_log ENABLE ROW LEVEL SECURITY;

-- Planos ativos são públicos (vitrine); admin vê todos
DROP POLICY IF EXISTS saas_plans_public_read ON saas_plans;
CREATE POLICY saas_plans_public_read ON saas_plans FOR SELECT USING (
  active OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
);

-- Assinatura: membros da casa leem a própria; saas_admin lê/edita tudo
DROP POLICY IF EXISTS saas_sub_member_read ON saas_subscriptions;
CREATE POLICY saas_sub_member_read ON saas_subscriptions FOR SELECT USING (
  EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = saas_subscriptions.house_id AND hu.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
);
DROP POLICY IF EXISTS saas_sub_admin_write ON saas_subscriptions;
CREATE POLICY saas_sub_admin_write ON saas_subscriptions FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
);

-- Pagamentos: mesma regra de leitura; escrita só service_role/admin
DROP POLICY IF EXISTS saas_pay_member_read ON saas_payments;
CREATE POLICY saas_pay_member_read ON saas_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = saas_payments.house_id AND hu.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
);
DROP POLICY IF EXISTS saas_pay_admin_write ON saas_payments;
CREATE POLICY saas_pay_admin_write ON saas_payments FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
);

-- Webhook events / audit: só saas_admin lê; escrita via service_role (edge functions)
DROP POLICY IF EXISTS saas_wh_admin_read ON saas_webhook_events;
CREATE POLICY saas_wh_admin_read ON saas_webhook_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
);
DROP POLICY IF EXISTS saas_audit_admin_all ON saas_audit_log;
CREATE POLICY saas_audit_admin_all ON saas_audit_log FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
);

-- ── 10. Seed dos planos ──
INSERT INTO saas_plans (key, name, description, price_cents, trial_days, limits, features, active, highlight, sort_order) VALUES
('basico', 'Básico', 'Para casas começando a organizar a operação', 9700, 14,
 '{"max_users": 3, "max_events_month": 8, "max_clients": 1000, "max_whatsapp_month": 0}',
 '{"whatsapp": false, "tickets": false, "reports_advanced": false, "campaigns": false}',
 true, false, 1),
('profissional', 'Profissional', 'Operação completa com WhatsApp e ingressos', 19700, 14,
 '{"max_users": 10, "max_events_month": 30, "max_clients": 10000, "max_whatsapp_month": 3000}',
 '{"whatsapp": true, "tickets": true, "reports_advanced": true, "campaigns": true}',
 true, true, 2),
('premium', 'Premium', 'Sem limites + suporte prioritário', 29700, 14,
 '{"max_users": null, "max_events_month": null, "max_clients": null, "max_whatsapp_month": null}',
 '{"whatsapp": true, "tickets": true, "reports_advanced": true, "campaigns": true, "api_access": true}',
 true, false, 3),
('interno', 'Interno / Cortesia', 'Uso interno ou parceiro — sem cobrança', 0, 0,
 '{"max_users": null, "max_events_month": null, "max_clients": null, "max_whatsapp_month": null}',
 '{"whatsapp": true, "tickets": true, "reports_advanced": true, "campaigns": true, "api_access": true}',
 false, false, 99)
ON CONFLICT (key) DO NOTHING;
