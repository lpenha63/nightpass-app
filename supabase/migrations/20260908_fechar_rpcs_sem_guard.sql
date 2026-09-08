-- Duas funcoes SECURITY DEFINER estavam executaveis por anonimo sem validacao.

-- 1. increment_batch_sold: fazia UPDATE ticket_batches SET sold = sold + p_qty para
--    qualquer id. E o id do lote e PUBLICO — a pagina de compra le ticket_batches com
--    select('*'). Qualquer um marcava um lote como esgotado e derrubava a venda.
--    Comprovado em producao: o `sold` saltou de 5 para 20003 numa chamada anonima.
--
-- 2. agenda_for_freelancer: recebe o ID do funcionario, sem token e sem checagem, e
--    devolve nome, telefone, casa, eventos e tarefas. A unica protecao era nao se
--    saber o UUID. Nenhum codigo do app chama — o app da equipe usa
--    freelancer_agenda(p_token), que valida.
--
-- ATENCAO ao revogar: no Postgres, EXECUTE em funcao e concedido a PUBLIC por padrao.
-- `REVOKE ... FROM anon` NAO remove a concessao que o anon herda de PUBLIC — a
-- primeira tentativa nao surtiu efeito nenhum. E preciso revogar de PUBLIC.
-- Mesmo erro que ja tinha acontecido com o SELECT da tabela events.

CREATE OR REPLACE FUNCTION public.increment_batch_sold(p_batch_id uuid, p_qty integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- auth.uid() nulo = chamada do servidor (service_role), que confirma pagamento.
  -- Com usuario logado, exige ser membro da casa dona do lote.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM ticket_batches b
       JOIN events e ON e.id = b.event_id
       JOIN house_users hu ON hu.house_id = e.house_id
       WHERE b.id = p_batch_id AND hu.user_id = auth.uid() AND hu.is_active
     ) THEN
    RAISE EXCEPTION 'Sem permissao para alterar este lote';
  END IF;

  UPDATE ticket_batches SET sold = GREATEST(0, sold + p_qty) WHERE id = p_batch_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_batch_sold(uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.increment_batch_sold(uuid, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.agenda_for_freelancer(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.agenda_for_freelancer(uuid) TO service_role;
