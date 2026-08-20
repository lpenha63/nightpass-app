-- Taxa de serviço (conveniência) por lote, somada ao preço na hora da compra.
ALTER TABLE ticket_batches
  ADD COLUMN IF NOT EXISTS service_fee_pct numeric(5,2) NOT NULL DEFAULT 0;

-- Guardada à parte no pedido: nos relatórios a taxa não é receita de ingresso.
ALTER TABLE ticket_orders
  ADD COLUMN IF NOT EXISTS service_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mp_preference_id text;

COMMENT ON COLUMN ticket_batches.service_fee_pct IS 'Taxa de serviço em % somada ao preço do ingresso';
COMMENT ON COLUMN ticket_orders.service_fee_cents IS 'Parte de amount_cents que é taxa de serviço';
COMMENT ON COLUMN ticket_orders.mp_preference_id IS 'Preference do Checkout Pro que originou a compra';
