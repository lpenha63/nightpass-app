-- "Dia de operação": dia em que a casa abre sem evento, mas precisa de equipe escalada.
-- É um evento leve (reusa escala, check-in de equipe, tarefas, budget, DRE e agenda),
-- marcado com esta flag para a UI diferenciar de um evento de verdade.
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_operation boolean NOT NULL DEFAULT false;
