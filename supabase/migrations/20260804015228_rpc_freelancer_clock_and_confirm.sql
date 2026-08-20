-- Bater ponto pelo app (entrada/saída) com verificação de local por GPS.
-- Regra: se a casa tem coordenadas e o colaborador está fora do raio → BLOQUEIA.
-- Se a casa não tem coordenadas → registra sem verificação (e avisa).
CREATE OR REPLACE FUNCTION public.freelancer_clock(p_token uuid, p_event uuid, p_action text,
                                                   p_lat double precision DEFAULT NULL,
                                                   p_lng double precision DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record; h record; ef record; dist double precision; verified boolean := false;
begin
  select fr.id as fid, fr.house_id, fr.full_name into cf
  from freelancers fr where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null then return jsonb_build_object('ok', false, 'error', 'Link inválido'); end if;

  select id, lat, lng, coalesce(clock_radius_m, 250) as radius into h from houses where id = cf.house_id;

  -- só pode bater ponto em evento no qual está escalado
  select * into ef from event_freelancers
   where event_id = p_event and freelancer_id = cf.fid limit 1;
  if ef.id is null then return jsonb_build_object('ok', false, 'error', 'Você não está escalado neste evento'); end if;

  -- verificação de local
  if h.lat is not null and h.lng is not null then
    if p_lat is null or p_lng is null then
      return jsonb_build_object('ok', false, 'error', 'Ative a localização para bater o ponto');
    end if;
    dist := geo_distance_m(h.lat, h.lng, p_lat, p_lng);
    if dist > h.radius then
      return jsonb_build_object('ok', false, 'error',
        'Você está a ' || round(dist)::int || 'm da casa. Só é possível bater o ponto no local.',
        'distance', round(dist)::int);
    end if;
    verified := true;
  end if;

  if p_action = 'in' then
    if ef.checkin_at is not null then return jsonb_build_object('ok', false, 'error', 'Entrada já registrada'); end if;
    update event_freelancers set checkin_at = now(), checkin_source = 'app',
           checkin_distance_m = case when dist is null then null else round(dist)::int end
     where id = ef.id;
  elsif p_action = 'out' then
    if ef.checkin_at is null then return jsonb_build_object('ok', false, 'error', 'Registre a entrada primeiro'); end if;
    if ef.checkout_at is not null then return jsonb_build_object('ok', false, 'error', 'Saída já registrada'); end if;
    update event_freelancers set checkout_at = now(), checkout_source = 'app',
           checkout_distance_m = case when dist is null then null else round(dist)::int end
     where id = ef.id;
  else
    return jsonb_build_object('ok', false, 'error', 'Ação inválida');
  end if;

  return jsonb_build_object('ok', true, 'action', p_action, 'verified', verified,
                            'distance', case when dist is null then null else round(dist)::int end);
end; $function$;

-- Confirmar / recusar a escala
CREATE OR REPLACE FUNCTION public.freelancer_confirm_shift(p_token uuid, p_event uuid, p_confirm boolean,
                                                           p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record; ef record;
begin
  select fr.id as fid into cf from freelancers fr
   where fr.access_token = p_token and fr.status = 'ativo' limit 1;
  if cf.fid is null then return jsonb_build_object('ok', false, 'error', 'Link inválido'); end if;

  select * into ef from event_freelancers where event_id = p_event and freelancer_id = cf.fid limit 1;
  if ef.id is null then return jsonb_build_object('ok', false, 'error', 'Você não está escalado neste evento'); end if;

  update event_freelancers
     set confirmed = p_confirm, responded_at = now(),
         decline_reason = case when p_confirm then null else nullif(btrim(coalesce(p_reason,'')), '') end
   where id = ef.id;

  return jsonb_build_object('ok', true, 'confirmed', p_confirm);
end; $function$;
