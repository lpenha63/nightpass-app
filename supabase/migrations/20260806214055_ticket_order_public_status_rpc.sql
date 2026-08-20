-- O comprador anônimo não enxerga ticket_orders (só tem policy de INSERT), então a tela de
-- pagamento nunca conseguia confirmar que o PIX caiu nem montar o resumo. RPC por id do pedido,
-- devolvendo só o que a própria pessoa já sabe da compra.
CREATE OR REPLACE FUNCTION public.get_order_public(p_order_id uuid)
RETURNS TABLE (
  order_id uuid, buyer_name text, quantity integer, amount_cents integer,
  payment_status text, batch_name text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.buyer_name, o.quantity, o.amount_cents, o.payment_status, b.name
  FROM ticket_orders o
  LEFT JOIN ticket_batches b ON b.id = o.batch_id
  WHERE o.id = p_order_id;
$$;

REVOKE ALL ON FUNCTION public.get_order_public(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_order_public(uuid) TO anon, authenticated;
