-- `ordem` usava count(created_at <= ...) e empatava quando os ingressos do pedido
-- eram inseridos no mesmo instante (todos viravam "2/2"). row_number desempata pelo id.
CREATE OR REPLACE FUNCTION public.get_ticket_by_token(p_token text)
RETURNS TABLE (
  ticket_id uuid, token text, holder_name text, checked_in boolean, checked_in_at timestamptz,
  event_name text, event_date date, start_time time, flyer_url text,
  house_name text, batch_name text, buyer_name text, quantity integer,
  ordem integer, payment_status text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH numerados AS (
    SELECT t.id, row_number() OVER (PARTITION BY t.order_id ORDER BY t.created_at, t.id)::int AS n
    FROM tickets t
    WHERE t.order_id = (SELECT order_id FROM tickets WHERE token = p_token)
  )
  SELECT t.id, t.token, t.holder_name, t.checked_in, t.checked_in_at,
         e.name, e.event_date, e.start_time, e.flyer_url,
         h.name, b.name, o.buyer_name, o.quantity,
         COALESCE(n.n, 1), o.payment_status
  FROM tickets t
  JOIN events e ON e.id = t.event_id
  JOIN houses h ON h.id = t.house_id
  LEFT JOIN ticket_orders o ON o.id = t.order_id
  LEFT JOIN ticket_batches b ON b.id = o.batch_id
  LEFT JOIN numerados n ON n.id = t.id
  WHERE t.token = p_token;
$$;

-- Busca por código é ferramenta de portaria: nega já no grant, não só na trava interna
REVOKE EXECUTE ON FUNCTION public.find_ticket_by_code(uuid, text) FROM anon;
