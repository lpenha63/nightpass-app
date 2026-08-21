/**
 * A que hora vira o dia de trabalho da casa.
 *
 * A regra estava fixa em 6h espalhada por cinco telas e três funções do banco: correto
 * para balada (o movimento das 2h pertence à noite que começou ontem), mas errado para
 * comércio diurno — numa padaria o movimento das 5h cairia no dia anterior.
 *
 * Agora cada casa declara a sua (`houses.day_start_hour`): 6 para casa noturna,
 * 0 para quem opera de dia (o dia de trabalho é o dia do calendário).
 */
export const VIRADA_PADRAO = 6

type ComVirada = { day_start_hour?: number | null } | null | undefined

/** Lê a virada da casa, caindo no padrão de casa noturna quando não declarada. */
export function viradaDa(casa: ComVirada): number {
  const v = casa?.day_start_hour
  return typeof v === 'number' && v >= 0 && v <= 12 ? v : VIRADA_PADRAO
}

/** Data de referência do dia de trabalho — antes da virada, ainda é o dia anterior. */
export function diaOperacional(virada = VIRADA_PADRAO, base = new Date()): Date {
  const d = new Date(base)
  if (d.getHours() < virada) d.setDate(d.getDate() - 1)
  return d
}

/** Mesma coisa em `AAAA-MM-DD`, sempre no fuso local (toISOString viraria o dia após ~21h). */
export function diaOperacionalStr(virada = VIRADA_PADRAO, base = new Date()): string {
  const d = diaOperacional(virada, base)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Momento em que o dia de trabalho começou (para filtrar "o que entrou hoje"). */
export function inicioDoDia(virada = VIRADA_PADRAO, base = new Date()): Date {
  const d = diaOperacional(virada, base)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), virada, 0, 0, 0)
}
