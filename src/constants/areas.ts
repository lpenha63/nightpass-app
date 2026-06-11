// Áreas de trabalho (funções) — administráveis via tabela work_areas, com defaults.
export interface WorkArea {
  id?: string
  key: string
  label: string
  icon: string
  color: string
  sort_order?: number
  active?: boolean
}

export const DEFAULT_AREAS: WorkArea[] = [
  { key: 'limpeza', label: 'Limpeza', icon: '🧹', color: '#60a5fa' },
  { key: 'cozinha', label: 'Cozinha', icon: '👨‍🍳', color: '#f59e0b' },
  { key: 'servicos_gerais', label: 'Serv. Gerais', icon: '🔧', color: '#8b5cf6' },
  { key: 'garcom', label: 'Garçom', icon: '🍽️', color: '#10b981' },
  { key: 'cumim', label: 'Cumim', icon: '🥄', color: '#06b6d4' },
  { key: 'recepcao', label: 'Recepção', icon: '💁', color: '#ec4899' },
  { key: 'atendente', label: 'Atendente', icon: '🎟️', color: '#f87171' },
  { key: 'seguranca', label: 'Segurança', icon: '🛡️', color: '#64748b' },
]

export const AREA_ICON_OPTIONS = ['📋', '🧹', '👨‍🍳', '🔧', '🍽️', '🥄', '💁', '🎟️', '🛡️', '🍺', '🍸', '🎧', '💡', '🎤', '📦', '🚪', '🅿️', '🎥', '📸', '🚻']
export const AREA_COLOR_OPTIONS = ['#60a5fa', '#f59e0b', '#8b5cf6', '#10b981', '#06b6d4', '#ec4899', '#f87171', '#64748b', '#a78bfa', '#34d399']

const DIACRITICS = /[̀-ͯ]/g
export function slugifyArea(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'area'
}

export function areaMeta(areas: WorkArea[], key: string): WorkArea {
  return areas.find(a => a.key === key)
    ?? DEFAULT_AREAS.find(a => a.key === key)
    ?? { key, label: key, icon: '📋', color: '#94a3b8' }
}
