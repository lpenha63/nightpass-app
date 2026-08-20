-- Ingresso nominal: cada unidade sai no nome de uma pessoa.
-- Fica por LOTE (não por casa) porque a mesma casa pode ter pista livre e camarote nominal,
-- e outras casas usarão o app com política própria.
ALTER TABLE ticket_batches
  ADD COLUMN IF NOT EXISTS nominal boolean NOT NULL DEFAULT false;

-- Os nomes são coletados na compra, mas os ingressos só nascem quando o pagamento
-- confirma (no webhook). Precisam ficar guardados no pedido nesse meio-tempo.
ALTER TABLE ticket_orders
  ADD COLUMN IF NOT EXISTS holder_names jsonb;

COMMENT ON COLUMN ticket_batches.nominal IS 'Exige o nome de cada participante na compra';
COMMENT ON COLUMN ticket_orders.holder_names IS 'Nomes informados na compra, um por ingresso';
