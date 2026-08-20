-- Folha por hora: até agora só existia diária (daily_rate_cents). Cada função tem valor/hora
-- diferente (bar, segurança, produção), então o valor fica na pessoa, não numa taxa global.
ALTER TABLE freelancers ADD COLUMN IF NOT EXISTS hourly_rate_cents integer;
COMMENT ON COLUMN freelancers.hourly_rate_cents IS 'Valor por hora em centavos; usado no relatório de ponto quando o cálculo é por hora';
