-- Inscrições de push por colaborador (um device = uma linha)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  freelancer_id uuid NOT NULL REFERENCES freelancers(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz,
  fail_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subs_freelancer ON push_subscriptions(freelancer_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
-- Ninguém acessa direto: tudo passa por RPC (token) ou Edge Function (service_role).
DROP POLICY IF EXISTS push_subs_member_read ON push_subscriptions;
CREATE POLICY push_subs_member_read ON push_subscriptions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = push_subscriptions.house_id
                   AND hu.user_id = auth.uid() AND hu.is_active));

-- Chaves VAPID por instalação (lidas só pelo service_role da Edge Function)
CREATE TABLE IF NOT EXISTS push_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_key text NOT NULL,
  private_key text NOT NULL,
  subject text NOT NULL DEFAULT 'mailto:contato@nightpass.app'
);
ALTER TABLE push_config ENABLE ROW LEVEL SECURITY;  -- sem policies = só service_role

INSERT INTO push_config (id, public_key, private_key)
VALUES (true, 'BAlNgNLN33bnoR5KGyDBlq46c4HxRUSnRQ5Dvij6v0U19ig7BskqF3WLvmmTRWHdJNOm8KioveCjJpNlKMncB9g',
        'rNc8ldQoOzuqv6dTVV_p6HAtyQrDT9SBTIsRZ6Z303Y')
ON CONFLICT (id) DO NOTHING;

-- Colaborador registra o device dele pelo token do portal (sem login)
CREATE OR REPLACE FUNCTION public.freelancer_push_subscribe(p_token uuid, p_endpoint text, p_p256dh text, p_auth text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record;
begin
  select fr.id as fid, fr.house_id into cf
    from freelancers fr where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null then return jsonb_build_object('ok', false, 'error', 'Link inválido'); end if;
  if coalesce(btrim(p_endpoint),'') = '' then return jsonb_build_object('ok', false, 'error', 'Inscrição inválida'); end if;

  insert into push_subscriptions(house_id, freelancer_id, endpoint, p256dh, auth)
  values (cf.house_id, cf.fid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set freelancer_id = excluded.freelancer_id, house_id = excluded.house_id,
        p256dh = excluded.p256dh, auth = excluded.auth, fail_count = 0;

  return jsonb_build_object('ok', true);
end; $function$;

-- Chave pública para o app montar a inscrição
CREATE OR REPLACE FUNCTION public.push_public_key()
 RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public_key FROM push_config WHERE id LIMIT 1; $$;
