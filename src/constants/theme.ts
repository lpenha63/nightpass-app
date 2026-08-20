// ── Tema claro/escuro ──
// C é um Proxy que devolve a cor do tema ATIVO em runtime, então todos os
// estilos inline (`C.bg`, `C.acc + '22'` etc.) seguem o tema sem alterar componentes.
// Regra: só as SUPERFÍCIES/TEXTO trocam entre temas; os acentos (acc/grn/gold/red)
// são iguais nos dois (ficam bem sobre fundo claro ou escuro).

type Palette = Record<
  'bg' | 'bg2' | 'card' | 'brd' | 'acc' | 'acd' | 'gold' | 'grn' | 'red' | 'txt' | 'mut' | 'sub' | 'inp',
  string
>

const ACCENTS = { acc: '#3b82f6', acd: '#1d4ed8', gold: '#60a5fa', grn: '#10b981', red: '#f87171' }

const DARK: Palette = {
  bg: '#0a0e1a', bg2: '#111827', card: '#111827', brd: '#1e2736',
  txt: '#f9fafb', mut: '#6b7280', sub: '#9ca3af', inp: '#0f172a', ...ACCENTS,
}
const LIGHT: Palette = {
  bg: '#f4f6fb', bg2: '#e9edf4', card: '#ffffff', brd: '#e2e8f0',
  txt: '#0f172a', mut: '#64748b', sub: '#475569', inp: '#eef2f7', ...ACCENTS,
}

export type ThemeName = 'dark' | 'light'
let active: Palette = DARK
let current: ThemeName = 'dark'
const listeners = new Set<() => void>()

// Proxy: qualquer leitura de C.x devolve o valor do tema ativo naquele momento.
export const C = new Proxy({} as Palette, {
  get: (_t, key: string) => (active as Record<string, string>)[key],
}) as Palette

export function getTheme(): ThemeName { return current }

export function applyTheme(t: ThemeName) {
  current = t
  active = t === 'light' ? LIGHT : DARK
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', t)
  try { localStorage.setItem('np-theme', t) } catch { /* ignore */ }
  listeners.forEach(l => l())
}

export function initTheme() {
  let saved: ThemeName = 'dark'
  try { const s = localStorage.getItem('np-theme'); if (s === 'light' || s === 'dark') saved = s } catch { /* ignore */ }
  applyTheme(saved)
}

export function toggleTheme() { applyTheme(current === 'dark' ? 'light' : 'dark') }

export function subscribeTheme(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }

export const RC: Record<string, string> = {
  super_admin: '#60a5fa',
  admin:       '#3b82f6',
  operador:    '#10b981',
  portaria:    '#f59e0b',
  financeiro:  '#8b5cf6',
  promoter:    '#6366f1',
  colaborador: '#a78bfa',
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
  colaborador: 'Colaborador',
  door:    'Portaria',
  finance: 'Financeiro',
}

export type Role = keyof typeof RL
export type ColorKey = keyof Palette
