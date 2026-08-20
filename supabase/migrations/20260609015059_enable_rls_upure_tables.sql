
-- Habilita RLS em todas as tabelas Upure
ALTER TABLE public.upure_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upure_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upure_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upure_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upure_pedido_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upure_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upure_kpis_diarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upure_carrinhos_abandonados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upure_conteudo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upure_reviews ENABLE ROW LEVEL SECURITY;

-- Política de acesso: service_role tem acesso total (bypass RLS por padrão)
-- anon e authenticated precisam de políticas explícitas para acessar

-- Política pública de leitura apenas para produtos (catálogo público)
CREATE POLICY "produtos_leitura_publica" ON public.upure_produtos
  FOR SELECT USING (true);

-- Todas as outras tabelas: sem acesso público (apenas service_role via Make.com);
