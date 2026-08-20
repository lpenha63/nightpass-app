-- Local da casa (para validar o ponto por GPS) + raio aceito
ALTER TABLE houses ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE houses ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE houses ADD COLUMN IF NOT EXISTS clock_radius_m integer NOT NULL DEFAULT 250;

-- Ponto batido pelo app: guarda de onde veio e a que distância da casa (auditoria)
ALTER TABLE event_freelancers ADD COLUMN IF NOT EXISTS checkin_source text;      -- 'app' | 'portaria'
ALTER TABLE event_freelancers ADD COLUMN IF NOT EXISTS checkin_distance_m integer;
ALTER TABLE event_freelancers ADD COLUMN IF NOT EXISTS checkout_source text;
ALTER TABLE event_freelancers ADD COLUMN IF NOT EXISTS checkout_distance_m integer;

-- Resposta da escala: distingue "não respondeu" (responded_at nulo) de "recusou"
ALTER TABLE event_freelancers ADD COLUMN IF NOT EXISTS responded_at timestamptz;
ALTER TABLE event_freelancers ADD COLUMN IF NOT EXISTS decline_reason text;

-- Distância entre dois pontos em metros (Haversine)
CREATE OR REPLACE FUNCTION public.geo_distance_m(lat1 double precision, lng1 double precision,
                                                 lat2 double precision, lng2 double precision)
 RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2-lat1)/2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2-lng1)/2), 2)
  ));
$$;
