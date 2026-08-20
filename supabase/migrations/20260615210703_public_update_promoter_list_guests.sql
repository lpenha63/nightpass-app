
CREATE POLICY "public_update_promoter_list_guests"
ON promoter_list_guests
FOR UPDATE
TO anon
USING (invite_token IS NOT NULL)
WITH CHECK (true);
