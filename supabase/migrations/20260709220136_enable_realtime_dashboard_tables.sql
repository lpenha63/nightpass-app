
-- Habilita realtime (postgres_changes) nas tabelas que o Dashboard observa.
-- Sem REPLICA IDENTITY FULL para não onerar a escrita; INSERT/UPDATE já bastam
-- (o filtro house_id casa contra a linha nova).
ALTER PUBLICATION supabase_realtime ADD TABLE checkins;
ALTER PUBLICATION supabase_realtime ADD TABLE reservations;
ALTER PUBLICATION supabase_realtime ADD TABLE ticket_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE events;
