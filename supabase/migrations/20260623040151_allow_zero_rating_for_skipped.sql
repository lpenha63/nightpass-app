ALTER TABLE public.team_ratings DROP CONSTRAINT IF EXISTS team_ratings_rating_check;
ALTER TABLE public.team_ratings ADD CONSTRAINT team_ratings_rating_check CHECK (rating >= 0 AND rating <= 5);
