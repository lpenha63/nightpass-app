import type { SaasStatus, SaasSubscription } from '../types'

// Regra única de bloqueio (espelha saas_effective_status do banco):
// trial vencido → suspended; past_due com carência vencida → suspended.
export function effectiveStatus(sub: SaasSubscription | null): SaasStatus | 'none' {
  if (!sub) return 'none'
  const now = Date.now()
  if (sub.status === 'trialing' && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() < now) return 'suspended'
  if (sub.status === 'past_due' && sub.grace_until && new Date(sub.grace_until).getTime() < now) return 'suspended'
  return sub.status
}

// Casa pode usar o app? (bloqueio total só quando suspensa/cancelada/sem assinatura)
export function isHouseActive(sub: SaasSubscription | null): boolean {
  const s = effectiveStatus(sub)
  return s === 'active' || s === 'trialing' || s === 'comp' || s === 'past_due' || s === 'pending'
}

export function trialDaysLeft(sub: SaasSubscription | null): number | null {
  if (!sub || sub.status !== 'trialing' || !sub.trial_ends_at) return null
  const diff = new Date(sub.trial_ends_at).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / 864e5))
}

export const SAAS_STATUS_LABEL: Record<string, string> = {
  trialing: 'Período de teste',
  pending: 'Aguardando pagamento',
  active: 'Ativa',
  past_due: 'Pagamento pendente',
  suspended: 'Suspensa',
  canceled: 'Cancelada',
  comp: 'Cortesia',
  none: 'Sem assinatura',
}

export const SAAS_STATUS_COLOR: Record<string, string> = {
  trialing: '#3b82f6',
  pending: '#f59e0b',
  active: '#10b981',
  past_due: '#f59e0b',
  suspended: '#ef4444',
  canceled: '#ef4444',
  comp: '#a78bfa',
  none: '#94a3b8',
}
