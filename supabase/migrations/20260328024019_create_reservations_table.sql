
CREATE TABLE public.reservations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  house_id uuid NOT NULL REFERENCES public.houses(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  people_count integer NOT NULL DEFAULT 1,
  location text DEFAULT '',
  amount_cents integer NOT NULL DEFAULT 0,
  expected_arrival text DEFAULT '22:00',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'arrived', 'cancelled')),
  arrived_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- house_users can do everything on reservations of their house
CREATE POLICY "house members can manage reservations"
  ON public.reservations
  FOR ALL
  USING (
    house_id IN (
      SELECT house_id FROM public.house_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    house_id IN (
      SELECT house_id FROM public.house_users WHERE user_id = auth.uid()
    )
  );

CREATE INDEX reservations_event_id_idx ON public.reservations(event_id);
CREATE INDEX reservations_house_id_idx ON public.reservations(house_id);
CREATE INDEX reservations_status_idx ON public.reservations(status);
