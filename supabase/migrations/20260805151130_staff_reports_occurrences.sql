-- Ocorrências relatadas pela equipe (ex.: "falta morango", "não tem cadeiras")
CREATE TABLE IF NOT EXISTS staff_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  freelancer_id uuid REFERENCES freelancers(id) ON DELETE SET NULL,
  author_name text,
  target text NOT NULL DEFAULT 'adm',   -- 'adm' | 'lider'
  category text NOT NULL DEFAULT 'geral', -- 'compra' | 'equipamento' | 'limpeza' | 'seguranca' | 'geral'
  message text NOT NULL,
  status text NOT NULL DEFAULT 'aberto', -- 'aberto' | 'resolvido'
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_reports_house ON staff_reports(house_id, status, created_at DESC);

ALTER TABLE staff_reports ENABLE ROW LEVEL SECURITY;
-- Gestão (logado) lê e resolve; o app da equipe escreve via RPC com token.
DROP POLICY IF EXISTS staff_reports_member ON staff_reports;
CREATE POLICY staff_reports_member ON staff_reports FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = staff_reports.house_id
                   AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = staff_reports.house_id
                   AND hu.user_id = auth.uid() AND hu.is_active));

-- Colaborador registra ocorrência pelo portal (sem login)
CREATE OR REPLACE FUNCTION public.freelancer_report(p_token uuid, p_message text,
                                                    p_target text DEFAULT 'adm',
                                                    p_category text DEFAULT 'geral',
                                                    p_event uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record; newid uuid;
begin
  select fr.id as fid, fr.house_id, fr.full_name into cf
    from freelancers fr where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null then return jsonb_build_object('ok', false, 'error', 'Link inválido'); end if;
  if coalesce(btrim(p_message), '') = '' then return jsonb_build_object('ok', false, 'error', 'Escreva a ocorrência'); end if;

  insert into staff_reports(house_id, event_id, freelancer_id, author_name, target, category, message)
  values (cf.house_id, p_event, cf.fid, cf.full_name,
          case when p_target in ('adm','lider') then p_target else 'adm' end,
          coalesce(nullif(btrim(p_category),''), 'geral'), btrim(p_message))
  returning id into newid;

  return jsonb_build_object('ok', true, 'id', newid);
end; $function$;

-- Lista as ocorrências que ESTE colaborador enviou (acompanhamento no app)
CREATE OR REPLACE FUNCTION public.freelancer_my_reports(p_token uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record;
begin
  select fr.id as fid into cf from freelancers fr
   where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'message', r.message, 'target', r.target, 'category', r.category,
      'status', r.status, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
      'event_name', e.name
    ) order by r.created_at desc)
    from staff_reports r left join events e on e.id = r.event_id
    where r.freelancer_id = cf.fid
  ), '[]'::jsonb);
end; $function$;
