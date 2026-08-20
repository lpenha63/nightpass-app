-- Desconto na folha do evento (vale, adiantamento, quebra, atraso...).
-- Fica no vínculo evento↔pessoa, não na pessoa: é específico daquele dia.
ALTER TABLE event_freelancers
  ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason text;
COMMENT ON COLUMN event_freelancers.discount_cents IS 'Desconto em centavos aplicado no pagamento deste evento';
COMMENT ON COLUMN event_freelancers.discount_reason IS 'Motivo do desconto, impresso na folha de pagamento';
