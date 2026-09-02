import type { Sub } from './types'

export const money = (c: number) => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
export const fdate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—')

// centavos ⇄ reais (input em reais, banco sempre em centavos)
export const reaisFromCents = (c: number) => (c / 100).toFixed(2)
export const centsFromReais = (v: string) => Math.round(parseFloat(v.replace(',', '.') || '0') * 100)

export const numOrNull = (v: string) =>
  v.trim() === '' ? null : Math.max(0, Math.floor(Number(v.replace(',', '.')) || 0))

const COMBINING_MIN = 0x0300, COMBINING_MAX = 0x036f

/** "Vila Beats & Cia" → "vila_beats_cia". Sem regex de acentos (evita caracteres invisíveis no fonte). */
export const slug = (v: string) =>
  v.normalize('NFD')
    .split('')
    .filter(ch => { const c = ch.charCodeAt(0); return c < COMBINING_MIN || c > COMBINING_MAX })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

export const onlyDigits = (v: string) => v.replace(/\D/g, '')

/** Formata CNPJ (14) ou CPF (11); devolve como veio se não bater. */
export function fmtDoc(v?: string | null): string {
  const d = onlyDigits(v ?? '')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return v ?? ''
}

export function fmtPhone(v?: string | null): string {
  const d = onlyDigits(v ?? '')
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  return v ?? ''
}

/**
 * Regra única de bloqueio — espelha saas_effective_status() no banco
 * e effectiveStatus() em src/utils/saas.ts do app de produto.
 * Trial vencido ou carência vencida ⇒ suspensa, mesmo que a coluna não tenha mudado.
 */
export function effective(s: Sub): string {
  const now = Date.now()
  if (s.status === 'trialing' && s.trial_ends_at && new Date(s.trial_ends_at).getTime() < now) return 'suspended'
  if (s.status === 'past_due' && s.grace_until && new Date(s.grace_until).getTime() < now) return 'suspended'
  return s.status
}
