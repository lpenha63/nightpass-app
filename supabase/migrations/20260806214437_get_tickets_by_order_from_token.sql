-- Quem comprou 4 ingressos recebe UM link e precisa folhear os 4. O comprador só conhece
-- o token de um deles, então a busca parte do token (não do id do pedido, que ele não tem).
CREATE OR REPLACE FUNCTION public.get_tickets_by_order_from_token(p_token text)
RETURNS TABLE (token text, holder_name text, checked_in boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.token, t.holder_name, t.checked_in
  FROM tickets t
  WHERE t.order_id = (SELECT order_id FROM tickets WHERE token = p_token)
    AND EXISTS (SELECT 1 FROM tickets WHERE token = p_token)
  ORDER BY t.created_at, t.id;
$$;

REVOKE ALL ON FUNCTION public.get_tickets_by_order_from_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_tickets_by_order_from_token(text) TO anon, authenticated;
