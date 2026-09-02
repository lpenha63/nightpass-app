import type { CSSProperties } from 'react'

export const C = {
  bg: '#0a0e1a', card: '#0f1526', brd: '#1c2540',
  txt: '#f1f5f9', sub: '#cbd5e1', mut: '#64748b',
  acc: '#3b82f6', grn: '#10b981', red: '#ef4444', gold: '#f59e0b', vio: '#a78bfa',
}

export const inp: CSSProperties = {
  width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10,
  padding: '11px 14px', color: C.txt, fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
export const btn: CSSProperties = {
  background: C.acc, border: 'none', borderRadius: 10, padding: '11px 20px',
  color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
}
export const btnGhost: CSSProperties = {
  background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 18px',
  color: C.sub, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
}
export const sel: CSSProperties = {
  background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8,
  padding: '6px 8px', color: C.txt, fontSize: 12, width: '100%', fontFamily: 'inherit',
}
export const lbl: CSSProperties = {
  fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 6, letterSpacing: '0.03em',
}
export const card: CSSProperties = {
  background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 16,
}

// Status de assinatura — rótulo e cor (espelha SAAS_STATUS_* do app de produto)
export const STATUS_LABEL: Record<string, string> = {
  trialing: 'Teste', pending: 'Aguardando pgto', active: 'Ativa', past_due: 'Inadimplente',
  suspended: 'Suspensa', canceled: 'Cancelada', comp: 'Cortesia', none: 'Sem assinatura',
}
export const STATUS_COLOR: Record<string, string> = {
  trialing: C.acc, pending: C.gold, active: C.grn, past_due: C.gold,
  suspended: C.red, canceled: C.red, comp: C.vio, none: C.mut,
}
