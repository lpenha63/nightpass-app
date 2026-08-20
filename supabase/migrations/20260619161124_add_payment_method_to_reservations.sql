ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS payment_method text;

COMMENT ON COLUMN public.reservations.payment_method IS 'Forma do ultimo recebimento da reserva (dinheiro/pix/cartao), registrado na portaria';
