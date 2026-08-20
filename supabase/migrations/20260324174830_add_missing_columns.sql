
-- Eventos: repetição, capacidade, tipo de lista aniversário
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS repeat_rule TEXT CHECK (repeat_rule IN ('none','weekly','biweekly','monthly')) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS capacity INTEGER,
  ADD COLUMN IF NOT EXISTS birthday_list_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Clientes: campo de notas e updated_at
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Promoter list guests: tipo (promoter ou aniversariante)
ALTER TABLE promoter_list_guests
  ADD COLUMN IF NOT EXISTS list_type TEXT CHECK (list_type IN ('promoter','birthday')) DEFAULT 'promoter',
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('M','F','outro'));

-- Checkins: campo de valor pago e método de entrada
ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK (payment_method IN ('dinheiro','pix','cartao','cortesia','lista')) DEFAULT 'dinheiro',
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS checkin_type TEXT CHECK (checkin_type IN ('portaria','lista_promoter','lista_aniversario','avulso')) DEFAULT 'portaria';

-- Tabela de listas de aniversário
CREATE TABLE IF NOT EXISTS birthday_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id UUID REFERENCES houses(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  birthday_person_id UUID REFERENCES clients(id),
  birthday_person_name TEXT NOT NULL,
  birthday_date DATE,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','recusado')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS birthday_list_guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  birthday_list_id UUID REFERENCES birthday_lists(id) ON DELETE CASCADE,
  house_id UUID REFERENCES houses(id),
  full_name TEXT NOT NULL,
  phone TEXT,
  cpf TEXT,
  birth_date DATE,
  gender TEXT CHECK (gender IN ('M','F','outro')),
  checked_in BOOLEAN DEFAULT false,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_birthday_lists_event ON birthday_lists(event_id);
CREATE INDEX IF NOT EXISTS idx_birthday_guests_list ON birthday_list_guests(birthday_list_id);

-- Tabela de configurações do WhatsApp por casa
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id UUID UNIQUE REFERENCES houses(id) ON DELETE CASCADE,
  instance_name TEXT,
  api_url TEXT,
  api_key TEXT,
  active BOOLEAN DEFAULT false,
  send_checkin_confirm BOOLEAN DEFAULT true,
  send_birthday_wish BOOLEAN DEFAULT true,
  send_event_invite BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
