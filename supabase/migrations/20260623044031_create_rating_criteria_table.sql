CREATE TABLE IF NOT EXISTS public.rating_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  sort_order integer DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rating_criteria_house_idx ON public.rating_criteria(house_id);
ALTER TABLE public.rating_criteria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "house members can manage rating_criteria" ON public.rating_criteria;
CREATE POLICY "house members can manage rating_criteria" ON public.rating_criteria FOR ALL USING (true) WITH CHECK (true);
