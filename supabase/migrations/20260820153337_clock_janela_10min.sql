-- Ponto: só abre 10 min antes do horário de entrada combinado.
-- Sem horário definido, continua liberado a qualquer hora (regra do usuário).
CREATE OR REPLACE FUNCTION public.freelancer_clock(p_token uuid, p_event uuid, p_action text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare cf record; h record; ef record; dist double precision; verified boolean := false;
        v_data date; v_entrada timestamptz; v_abre timestamptz;
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
      return jsonb_build_object('ok', false, 'error', 'Não recebemos sua localização. Confira se o GPS está ligado e toque de novo.');
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

    -- Janela de entrada: nada de bater ponto horas antes. Só vale se houver horário combinado.
    if ef.entry_time is not null then
      select e.event_date into v_data from events e where e.id = p_event;
      -- evento que vira a madrugada: hora antes das 6h pertence à noite seguinte
      v_entrada := ((v_data + (case when ef.entry_time < '06:00'::time then 1 else 0 end))
                    + ef.entry_time) at time zone 'America/Sao_Paulo';
      v_abre := v_entrada - interval '10 minutes';
      if now() < v_abre then
        return jsonb_build_object('ok', false,
          'error', 'Seu ponto abre às ' || to_char(v_abre at time zone 'America/Sao_Paulo', 'HH24:MI')
                   || ' — entrada combinada para as ' || to_char(ef.entry_time, 'HH24:MI') || '.',
          'opens_at', v_abre);
      end if;
    end if;

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
