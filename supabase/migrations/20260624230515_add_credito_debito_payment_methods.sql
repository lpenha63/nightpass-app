
ALTER TABLE checkins DROP CONSTRAINT IF EXISTS checkins_payment_method_check;
ALTER TABLE checkins ADD CONSTRAINT checkins_payment_method_check 
  CHECK (payment_method = ANY (ARRAY['dinheiro','pix','cartao','credito','debito','cortesia','lista']));
