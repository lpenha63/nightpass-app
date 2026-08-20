/**
 * Pessoas esperadas numa reserva: o MAIOR entre o tamanho declarado (people_count)
 * e a quantidade de nomes já cadastrados (reservation_guests).
 *
 * Dashboard, card do evento e portaria divergiam por usar bases diferentes:
 *  - só `people_count` ignora quem o titular adicionou além do combinado;
 *  - só os nomes ignora quem ainda não foi cadastrado numa lista parcial
 *    (uma reserva de 80 pessoas com 12 nomes contava 12).
 * As duas situações são comuns, então o maior dos dois é o único valor seguro
 * para lotação e para o % de comparecimento.
 */
export function esperadoDaReserva(
  r: { people_count?: number | null; reservation_guests?: Array<unknown> | null }
): number {
  return Math.max(r.people_count ?? 0, r.reservation_guests?.length ?? 0)
}
