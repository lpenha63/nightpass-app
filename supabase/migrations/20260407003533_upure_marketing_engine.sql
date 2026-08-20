
-- =============================================
-- UPURE BRASIL — MOTOR DE IA — BANCO DE DADOS
-- =============================================

-- TABELA: Produtos
CREATE TABLE IF NOT EXISTS upure_produtos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  descricao TEXT,
  preco DECIMAL(10,2),
  estoque INTEGER DEFAULT 0,
  categoria TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABELA: Leads (capturados antes da compra)
CREATE TABLE IF NOT EXISTS upure_leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT,
  email TEXT UNIQUE NOT NULL,
  telefone TEXT,
  whatsapp TEXT,
  origem TEXT, -- instagram, tiktok, google, shopee, direto
  produto_interesse TEXT,
  status TEXT DEFAULT 'novo', -- novo, contatado, convertido, perdido
  utm_source TEXT,
  utm_campaign TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABELA: Clientes
CREATE TABLE IF NOT EXISTS upure_clientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  telefone TEXT,
  whatsapp TEXT,
  data_nascimento DATE,
  segmento TEXT DEFAULT 'novo', -- novo, recorrente, vip, inativo
  ltv DECIMAL(10,2) DEFAULT 0,
  total_pedidos INTEGER DEFAULT 0,
  ultimo_pedido TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABELA: Pedidos
CREATE TABLE IF NOT EXISTS upure_pedidos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES upure_clientes(id),
  canal TEXT NOT NULL, -- site, shopee, mercado_livre, instagram, whatsapp
  status TEXT DEFAULT 'pendente', -- pendente, confirmado, enviado, entregue, cancelado
  valor_total DECIMAL(10,2) NOT NULL,
  desconto DECIMAL(10,2) DEFAULT 0,
  codigo_rastreio TEXT,
  utm_source TEXT,
  utm_campaign TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABELA: Itens do Pedido
CREATE TABLE IF NOT EXISTS upure_pedido_itens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id UUID REFERENCES upure_pedidos(id),
  produto_id UUID REFERENCES upure_produtos(id),
  quantidade INTEGER NOT NULL,
  preco_unitario DECIMAL(10,2) NOT NULL
);

-- TABELA: Campanhas de Marketing
CREATE TABLE IF NOT EXISTS upure_campanhas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  canal TEXT NOT NULL, -- meta_ads, google_ads, tiktok, email, whatsapp, organico
  objetivo TEXT, -- awareness, leads, vendas, retencao
  status TEXT DEFAULT 'ativa',
  orcamento DECIMAL(10,2),
  gasto DECIMAL(10,2) DEFAULT 0,
  impressoes INTEGER DEFAULT 0,
  cliques INTEGER DEFAULT 0,
  conversoes INTEGER DEFAULT 0,
  receita_gerada DECIMAL(10,2) DEFAULT 0,
  roas DECIMAL(5,2),
  data_inicio DATE,
  data_fim DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABELA: KPIs Diários (consolidado)
CREATE TABLE IF NOT EXISTS upure_kpis_diarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  data DATE UNIQUE NOT NULL,
  receita_total DECIMAL(10,2) DEFAULT 0,
  pedidos_total INTEGER DEFAULT 0,
  novos_leads INTEGER DEFAULT 0,
  novos_clientes INTEGER DEFAULT 0,
  ticket_medio DECIMAL(10,2),
  cac DECIMAL(10,2), -- custo de aquisição de cliente
  roas_geral DECIMAL(5,2),
  gasto_anuncios DECIMAL(10,2) DEFAULT 0,
  seguidores_instagram INTEGER,
  seguidores_tiktok INTEGER,
  visitas_site INTEGER,
  taxa_conversao DECIMAL(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABELA: Carrinhos Abandonados
CREATE TABLE IF NOT EXISTS upure_carrinhos_abandonados (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES upure_clientes(id),
  email TEXT NOT NULL,
  produtos JSONB,
  valor_total DECIMAL(10,2),
  recuperado BOOLEAN DEFAULT false,
  tentativas_recuperacao INTEGER DEFAULT 0,
  ultima_tentativa TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABELA: Conteúdo Gerado por IA
CREATE TABLE IF NOT EXISTS upure_conteudo (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo TEXT NOT NULL, -- post_instagram, reel, tiktok, blog, email, whatsapp
  titulo TEXT,
  corpo TEXT,
  hashtags TEXT[],
  produto_id UUID REFERENCES upure_produtos(id),
  status TEXT DEFAULT 'rascunho', -- rascunho, aprovado, publicado
  publicado_em TIMESTAMPTZ,
  engajamento JSONB, -- likes, comentários, compartilhamentos
  gerado_por_ia BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TABELA: Reviews e Avaliações
CREATE TABLE IF NOT EXISTS upure_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES upure_clientes(id),
  produto_id UUID REFERENCES upure_produtos(id),
  canal TEXT, -- shopee, mercado_livre, google, site
  nota INTEGER CHECK (nota BETWEEN 1 AND 5),
  texto TEXT,
  sentimento TEXT, -- positivo, neutro, negativo
  respondido BOOLEAN DEFAULT false,
  usado_em_marketing BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INSERIR PRODUTOS UPURE
INSERT INTO upure_produtos (nome, slug, categoria, preco) VALUES
  ('Nightzen', 'nightzen', 'sono-relaxamento', 89.90),
  ('Bodyzen', 'bodyzen', 'bem-estar-corpo', 97.90),
  ('FemmeBoost', 'femme-boost', 'saude-feminina', 109.90),
  ('Bioglow', 'bioglow', 'beleza', 99.90),
  ('Neuromind', 'neuromind', 'foco-cognicao', 109.90),
  ('Curcumax', 'curcumax', 'anti-inflamatorio', 89.90),
  ('BurnSlim', 'burnslim', 'emagrecimento', 99.90),
  ('Vitacore', 'vitacore', 'energia-vitalidade', 79.90),
  ('Vitamax', 'vitamax', 'imunidade', 74.90)
ON CONFLICT (slug) DO NOTHING;
