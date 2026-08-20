-- A policy antiga era `FOR SELECT USING (true)` para `public`: qualquer um com a chave anon
-- listava TODOS os ingressos e seus tokens, e com o token dá para montar um QR válido.
-- Passa a ser acessível só por token exato, via RPC.
DROP POLICY IF EXISTS "public read ticket by token" ON tickets;

-- Recuperação do ingresso pelo comprador: /ingresso/:token
CREATE OR REPLACE FUNCTION public.get_ticket_by_token(p_token text)
RETURNS TABLE (
  ticket_id uuid, token text, holder_name text, checked_in boolean, checked_in_at timestamptz,
  event_name text, event_date date, start_time time, flyer_url text,
  house_name text, batch_name text, buyer_name text, quantity integer,
  ordem integer, payment_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.token, t.holder_name, t.checked_in, t.checked_in_at,
         e.name, e.event_date, e.start_time, e.flyer_url,
         h.name, b.name, o.buyer_name, o.quantity,
         (SELECT count(*)::int FROM tickets t2
           WHERE t2.order_id = t.order_id AND t2.created_at <= t.created_at),
         o.payment_status
  FROM tickets t
  JOIN events e ON e.id = t.event_id
  JOIN houses h ON h.id = t.house_id
  LEFT JOIN ticket_orders o ON o.id = t.order_id
  LEFT JOIN ticket_batches b ON b.id = o.batch_id
  WHERE t.token = p_token;
$$;

-- Todos os ingressos de um pedido, para o link mandado por WhatsApp abrir a compra inteira
CREATE OR REPLACE FUNCTION public.get_tickets_by_order(p_order_id uuid)
RETURNS TABLE (ticket_id uuid, token text, holder_name text, checked_in boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.token, t.holder_name, t.checked_in
  FROM tickets t WHERE t.order_id = p_order_id ORDER BY t.created_at;
$$;

-- Plano B da portaria: achar o ingresso pelos 8 primeiros caracteres, restrito à casa do operador
CREATE OR REPLACE FUNCTION public.find_ticket_by_code(p_house_id uuid, p_code text)
RETURNS TABLE (token text, holder_name text, checked_in boolean, event_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT t.token, t.holder_name, t.checked_in, e.name
  FROM tickets t JOIN events e ON e.id = t.event_id
  WHERE t.house_id = p_house_id
    AND EXISTS (SELECT 1 FROM house_users hu
                 WHERE hu.house_id = p_house_id AND hu.user_id = auth.uid() AND hu.is_active)
    AND left(replace(t.token, '-', ''), 8) = lower(regexp_replace(p_code, '[^a-zA-Z0-9]', '', 'g'))
  LIMIT 5;
$$;

REVOKE ALL ON FUNCTION public.get_ticket_by_token(text) FROM public;
REVOKE ALL ON FUNCTION public.get_tickets_by_order(uuid) FROM public;
REVOKE ALL ON FUNCTION public.find_ticket_by_code(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ticket_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tickets_by_order(uuid) TO anon, authenticated;
-- busca por código é só para operador logado
GRANT EXECUTE ON FUNCTION public.find_ticket_by_code(uuid, text) TO authenticated;
