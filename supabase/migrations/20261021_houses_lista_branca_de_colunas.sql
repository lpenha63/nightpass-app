-- `houses` e publica de proposito (nome e logo aparecem em todo link que a casa
-- manda), mas estava entregando as 24 colunas ao anonimo: cnpj, e-mail, telefone,
-- pix_holder e pix_key junto.
--
-- Mesmo tratamento ja dado a `events`: REVOKE da tabela e GRANT das colunas. Nao
-- adianta REVOKE por coluna — com o SELECT de tabela concedido, ele nao faz nada.
-- E, como efeito desejado, coluna NOVA nasce privada.
--
-- As colunas liberadas sao as que as paginas publicas pedem; conferido no codigo
-- e coberto por smoke-paginas.js, que roda as 8 consultas publicas como anonimo.
REVOKE SELECT ON public.houses FROM anon;
GRANT SELECT (id, name, logo_url, address, city, state) ON public.houses TO anon;
