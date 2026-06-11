export const C = {
  bg: '#0a0e1a',
  bg2: '#111827',
  card: '#111827',
  brd: '#1e2736',
  acc: '#3b82f6',
  acd: '#1d4ed8',
  gold: '#60a5fa',
  grn: '#10b981',
  red: '#f87171',
  txt: '#f9fafb',
  mut: '#6b7280',
  sub: '#9ca3af',
  inp: '#0f172a',
} as const

export const RC: Record<string, string> = {
  super_admin: '#60a5fa',
  admin:       '#3b82f6',
  operador:    '#10b981',
  portaria:    '#f59e0b',
  financeiro:  '#8b5cf6',
  promoter:    '#6366f1',
  // legacy aliases
  door:    '#f59e0b',
  finance: '#8b5cf6',
}

export const RL: Record<string, string> = {
  super_admin: 'Super Admin',
  admin:       'Administrador',
  operador:    'Operador',
  portaria:    'Portaria',
  financeiro:  'Financeiro',
  promoter:    'Promoter',
  // legacy aliases
  door:    'Portaria',
  finance: 'Financeiro',
}

export type Role = keyof typeof RL
export type ColorKey = keyof typeof C
