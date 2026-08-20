-- Permite que membros da casa corrijam valores de check-in (faltava política UPDATE → correções não gravavam)
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS amount_corrected boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS checkins_update ON checkins;
CREATE POLICY checkins_update ON checkins
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM house_users hu
    WHERE hu.house_id = checkins.house_id AND hu.user_id = auth.uid() AND hu.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu
    WHERE hu.house_id = checkins.house_id AND hu.user_id = auth.uid() AND hu.is_active = true));
