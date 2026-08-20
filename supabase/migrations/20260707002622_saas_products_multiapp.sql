
-- Vários apps vendidos pela mesma central: cada plano/assinatura pertence a um produto.
CREATE TABLE IF NOT EXISTS saas_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,          -- 'nightpass', futuros apps...
  name text NOT NULL,
  description text,
  app_url text,                      -- URL do app do produto
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE saas_plans ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES saas_products(id);
ALTER TABLE saas_subscriptions ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES saas_products(id);

INSERT INTO saas_products (key, name, description, app_url) VALUES
('nightpass', 'NightPass', 'Gestão completa para casas de show e eventos', 'https://nightpass-app.vercel.app')
ON CONFLICT (key) DO NOTHING;

-- Vincula planos e assinaturas existentes ao NightPass
UPDATE saas_plans SET product_id = (SELECT id FROM saas_products WHERE key='nightpass') WHERE product_id IS NULL;
UPDATE saas_subscriptions SET product_id = (SELECT id FROM saas_products WHERE key='nightpass') WHERE product_id IS NULL;

-- RLS: produtos ativos são públicos (vitrines dos apps); admin vê tudo
ALTER TABLE saas_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saas_products_read ON saas_products;
CREATE POLICY saas_products_read ON saas_products FOR SELECT USING (
  active OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
);
DROP POLICY IF EXISTS saas_products_admin_write ON saas_products;
CREATE POLICY saas_products_admin_write ON saas_products FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
) WITH CHECK (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_saas_admin)
);

-- Uma assinatura viva por casa POR PRODUTO (substitui o índice antigo por casa)
DROP INDEX IF EXISTS saas_subscriptions_house_live;
CREATE UNIQUE INDEX IF NOT EXISTS saas_subscriptions_house_product_live
  ON saas_subscriptions(house_id, product_id) WHERE status <> 'canceled';
