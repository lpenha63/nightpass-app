
-- Estabelecimentos (multi-tenant)
CREATE TABLE IF NOT EXISTS establishments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  phone TEXT,
  address TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Usuários do sistema por estabelecimento
CREATE TABLE IF NOT EXISTS system_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','porteiro','promoter','aniversariante')),
  password_hash TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_system_users_establishment ON system_users(establishment_id);
CREATE INDEX idx_system_users_email ON system_users(email);
