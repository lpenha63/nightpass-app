
-- Adicionar colunas ao profiles se não existirem
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'admin';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Criar/atualizar profiles
INSERT INTO profiles (id, full_name, email, role, created_at)
VALUES
  ('1c879e9d-ef07-47a5-9b4b-a7738f7a8c80', 'Admin Principal', 'lpenha63@gmail.com',          'super_admin', now()),
  ('1e8e63d1-473e-486c-91a9-e278e338cc6e', 'Financeiro VB',   'financeiro@vilabeats.com.br', 'admin',       now()),
  ('45ee2a4d-ea31-4a34-b8a0-dea4cffad9d4', 'Admin Penha',     'penha63@msn.com',             'admin',       now()),
  ('7f44f068-b531-43a2-9e72-a0ff0fe4b2c6', 'Upure Admin',     'upureadm@gmail.com',          'admin',       now()),
  ('5d4c9b3e-5e2c-4239-9722-43e3fdece455', 'Porteiro Teste',  'teste@teste.com',             'door',        now())
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, role = EXCLUDED.role, updated_at = now();

-- Vincular usuários à casa Vila Beats
INSERT INTO house_users (id, house_id, user_id, role, is_active, created_at)
VALUES
  (gen_random_uuid(), '04f7516c-bd3f-4d41-8a3e-402d097f6984', '1c879e9d-ef07-47a5-9b4b-a7738f7a8c80', 'super_admin', true, now()),
  (gen_random_uuid(), '04f7516c-bd3f-4d41-8a3e-402d097f6984', '1e8e63d1-473e-486c-91a9-e278e338cc6e', 'finance',     true, now()),
  (gen_random_uuid(), '04f7516c-bd3f-4d41-8a3e-402d097f6984', '45ee2a4d-ea31-4a34-b8a0-dea4cffad9d4', 'admin',       true, now()),
  (gen_random_uuid(), '04f7516c-bd3f-4d41-8a3e-402d097f6984', '7f44f068-b531-43a2-9e72-a0ff0fe4b2c6', 'admin',       true, now()),
  (gen_random_uuid(), '04f7516c-bd3f-4d41-8a3e-402d097f6984', '5d4c9b3e-5e2c-4239-9722-43e3fdece455', 'door',        true, now())
ON CONFLICT DO NOTHING;

-- Admin principal nas outras casas também
INSERT INTO house_users (id, house_id, user_id, role, is_active, created_at)
VALUES
  (gen_random_uuid(), 'a9b96b82-42cc-4626-b321-727cea240377', '1c879e9d-ef07-47a5-9b4b-a7738f7a8c80', 'super_admin', true, now()),
  (gen_random_uuid(), '9bf7fdd3-a5fc-4c7d-8a60-6352d6e194c7', '1c879e9d-ef07-47a5-9b4b-a7738f7a8c80', 'super_admin', true, now())
ON CONFLICT DO NOTHING;
