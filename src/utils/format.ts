/** Format date string to pt-BR */
export function fd(d?: string | null): string {
  return d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—'
}

/** Format CPF: 000.000.000-00 */
export function fcpf(v?: string | null): string {
  return (v || '').replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

/** Format phone: (00) 00000-0000 */
export function ftel(v?: string | null): string {
  return (v || '').replace(/\D/g, '').replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
}

/** Clean to digits only */
export function cn(v?: string | null): string {
  return (v || '').replace(/\D/g, '')
}

/** Format currency cents to R$ */
export function fmtCurrency(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Format date to relative label */
export function relativeDate(dateStr: string): string {
  const today = new Date()
  const d = new Date(dateStr + 'T12:00:00')
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return 'Hoje!'
  if (diff === 1) return 'Amanhã!'
  if (diff === -1) return 'Ontem'
  if (diff > 0) return `Em ${diff} dias`
  return `Há ${Math.abs(diff)} dias`
}

export type LoyalTier = { icon: string; label: string; color: string }

/** Loyalty tier based on checkin count */
export function loyalTier(n: number): LoyalTier {
  if (n >= 50) return { icon: '👑', label: 'VIP', color: '#c084fc' }
  if (n >= 20) return { icon: '🥇', label: 'Ouro', color: '#60a5fa' }
  if (n >= 8)  return { icon: '🥈', label: 'Prata', color: '#9ca3af' }
  if (n >= 3)  return { icon: '🥉', label: 'Bronze', color: '#b45309' }
  return { icon: '🆔', label: 'Novo', color: '#6b7280' }
}

export const PAY_COLORS: Record<string, string> = {
  pix: '#10b981', cartao: '#3b82f6', credito: '#3b82f6',
  debito: '#60a5fa', dinheiro: '#f59e0b', cortesia: '#9ca3af',
  // entrada por ingresso comprado no site — o dinheiro entra por ticket_orders
  online: '#a78bfa', lista: '#22d3ee',
}

export const PAY_LABELS: Record<string, string> = {
  pix: 'PIX', cartao: 'Cartão', credito: 'Crédito',
  debito: 'Débito', dinheiro: 'Dinheiro', cortesia: 'Cortesia',
  online: 'Ingresso online', lista: 'Lista',
}

export function payColor(k: string): string { return PAY_COLORS[k] || '#6b7280' }
export function payLabel(k: string): string { return PAY_LABELS[k] || k }
