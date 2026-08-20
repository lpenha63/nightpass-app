-- Tipos de check-in agora são definidos pelo usuário (checkin_types + checkin_type_id FK),
-- então o enum fixo em checkin_type bloqueava check-ins com tipo custom.
-- O source também usa valores descritivos (lista_promoter, lista_reserva) fora do enum antigo.
ALTER TABLE public.checkins DROP CONSTRAINT IF EXISTS checkins_checkin_type_check;
ALTER TABLE public.checkins DROP CONSTRAINT IF EXISTS checkins_source_check;
