-- Conferência na portaria: o ingresso passa a mostrar o titular. CPF vai MASCARADO
-- (***.456.789-**) porque o link é público — quem tiver a URL veria o documento inteiro.
-- Os 6 dígitos do meio já bastam para bater com o documento apresentado.
DROP FUNCTION IF EXISTS public.get_ticket_by_token(text);

CREATE FUNCTION public.get_ticket_by_token(p_token text)
RETURNS TABLE (
  ticket_id uuid, token text, holder_name text, checked_in boolean, checked_in_at timestamptz,
  event_name text, event_date date, start_time time, flyer_url text,
  house_name text, batch_name text, buyer_name text, quantity integer,
  ordem integer, payment_status text,
  batch_gender text, buyer_cpf_mask text, order_code text, end_time time
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
         COALESCE(n.n, 1), o.payment_status,
         b.gender,
         CASE
           WHEN o.buyer_cpf IS NULL OR length(regexp_replace(o.buyer_cpf,'\D','','g')) < 11 THEN NULL
           ELSE '***.' || substr(regexp_replace(o.buyer_cpf,'\D','','g'), 4, 3)
                || '.' || substr(regexp_replace(o.buyer_cpf,'\D','','g'), 7, 3) || '-**'
         END,
         upper(substr(o.id::text, 1, 8)),
         e.end_time
  FROM tickets t
  JOIN events e ON e.id = t.event_id
  JOIN houses h ON h.id = t.house_id
  LEFT JOIN ticket_orders o ON o.id = t.order_id
  LEFT JOIN ticket_batches b ON b.id = o.batch_id
  LEFT JOIN numerados n ON n.id = t.id
  WHERE t.token = p_token;
$$;

REVOKE ALL ON FUNCTION public.get_ticket_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ticket_by_token(text) TO anon, authenticated;
