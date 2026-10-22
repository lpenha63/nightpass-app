-- As funcoes de artistas sao de GESTAO: so a aba Eventos, logada, as chama.
-- Estavam executaveis pelo anonimo porque nasceram com o EXECUTE para PUBLIC,
-- que e o padrao do Postgres.
--
-- Nao havia vazamento: as tres exigem vinculo em house_users com auth.uid(),
-- entao o anonimo recebia zeros. Testado antes de mexer. Mas funcao SECURITY
-- DEFINER ao alcance de quem nao precisa e superficie a toa.
REVOKE EXECUTE ON FUNCTION public.artistas_resumo(uuid, date, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.artistas_resumo(uuid, date, date) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.artistas_no_periodo(uuid, date, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.artistas_no_periodo(uuid, date, date) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.artista_historico(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.artista_historico(uuid, text) TO authenticated, service_role;
