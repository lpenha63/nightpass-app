
ALTER TABLE houses ADD COLUMN IF NOT EXISTS mp_access_token text;

CREATE OR REPLACE FUNCTION increment_batch_sold(p_batch_id uuid, p_qty integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ticket_batches SET sold = sold + p_qty WHERE id = p_batch_id;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tickets' AND policyname = 'house_members_can_manage_tickets'
  ) THEN
    CREATE POLICY house_members_can_manage_tickets ON tickets
      FOR ALL TO authenticated
      USING (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid()))
      WITH CHECK (house_id IN (SELECT house_id FROM house_users WHERE user_id = auth.uid()));
  END IF;
END $$;
