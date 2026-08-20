
ALTER TABLE houses
  ADD COLUMN IF NOT EXISTS birthday_msg text,
  ADD COLUMN IF NOT EXISTS birthday_image_url text;
