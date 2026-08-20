-- Passa a aceitar devolução de cota (p_qty negativo) quando um pedido pago é cancelado.
-- GREATEST(0, ...) evita `sold` negativo se a mesma devolução for aplicada duas vezes.
CREATE OR REPLACE FUNCTION public.increment_batch_sold(p_batch_id uuid, p_qty integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  UPDATE ticket_batches
     SET sold = GREATEST(0, sold + p_qty)
   WHERE id = p_batch_id;
END;
$function$;
