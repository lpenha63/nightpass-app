-- ETAPA 3: tabelas internas de operação estavam com política ALL/true para public
-- (o nome dizia "house members" mas a condição era true). Nenhuma página pública as usa.
DROP POLICY IF EXISTS "house members can manage event_expenses" ON event_expenses;
CREATE POLICY event_expenses_member ON event_expenses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e JOIN house_users hu ON hu.house_id = e.house_id
                 WHERE e.id = event_expenses.event_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM events e JOIN house_users hu ON hu.house_id = e.house_id
                 WHERE e.id = event_expenses.event_id AND hu.user_id = auth.uid() AND hu.is_active));

DROP POLICY IF EXISTS "house members can manage event_budget_overrides" ON event_budget_overrides;
CREATE POLICY event_budget_overrides_member ON event_budget_overrides FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e JOIN house_users hu ON hu.house_id = e.house_id
                 WHERE e.id = event_budget_overrides.event_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM events e JOIN house_users hu ON hu.house_id = e.house_id
                 WHERE e.id = event_budget_overrides.event_id AND hu.user_id = auth.uid() AND hu.is_active));

DROP POLICY IF EXISTS "house members can manage rating_criteria" ON rating_criteria;
CREATE POLICY rating_criteria_member ON rating_criteria FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = rating_criteria.house_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = rating_criteria.house_id AND hu.user_id = auth.uid() AND hu.is_active));

DROP POLICY IF EXISTS "house members can manage work_areas" ON work_areas;
CREATE POLICY work_areas_member ON work_areas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = work_areas.house_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = work_areas.house_id AND hu.user_id = auth.uid() AND hu.is_active));

DROP POLICY IF EXISTS house_spaces_insert ON house_spaces;
DROP POLICY IF EXISTS house_spaces_update ON house_spaces;
DROP POLICY IF EXISTS house_spaces_delete ON house_spaces;
CREATE POLICY house_spaces_member_write ON house_spaces FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = house_spaces.house_id AND hu.user_id = auth.uid() AND hu.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM house_users hu WHERE hu.house_id = house_spaces.house_id AND hu.user_id = auth.uid() AND hu.is_active));
