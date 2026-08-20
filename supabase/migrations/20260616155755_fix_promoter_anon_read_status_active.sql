DROP POLICY IF EXISTS public_read_promoters ON promoters;
CREATE POLICY public_read_promoters ON promoters FOR SELECT TO anon USING (status = 'active');
