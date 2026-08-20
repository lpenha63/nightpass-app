
-- Casa nova → trial automático de 14 dias no plano Profissional
CREATE OR REPLACE FUNCTION saas_auto_trial() RETURNS trigger AS $$
DECLARE v_plan uuid; v_days int;
BEGIN
  SELECT id, trial_days INTO v_plan, v_days FROM saas_plans WHERE key = 'profissional' LIMIT 1;
  IF v_plan IS NOT NULL THEN
    INSERT INTO saas_subscriptions (house_id, plan_id, status, trial_ends_at)
    VALUES (NEW.id, v_plan, 'trialing', now() + make_interval(days => COALESCE(v_days, 14)));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS trg_saas_auto_trial ON houses;
CREATE TRIGGER trg_saas_auto_trial AFTER INSERT ON houses
  FOR EACH ROW EXECUTE FUNCTION saas_auto_trial();

-- Dono do SaaS
UPDATE profiles SET is_saas_admin = true WHERE email = 'lpenha63@gmail.com';

-- Casas existentes: assinatura 'comp' (cortesia) no plano interno para não bloquear ninguém hoje
INSERT INTO saas_subscriptions (house_id, plan_id, status)
SELECT h.id, (SELECT id FROM saas_plans WHERE key='interno'), 'comp'
FROM houses h
WHERE NOT EXISTS (SELECT 1 FROM saas_subscriptions s WHERE s.house_id = h.id AND s.status <> 'canceled');
