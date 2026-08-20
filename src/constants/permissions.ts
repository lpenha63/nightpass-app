export const ALL_PAGES = [
  'dashboard','checkin','clients','events','reservas',
  'promoters','freelancers','reports','whatsapp','users','settings','agenda',
] as const

export type AppPage = typeof ALL_PAGES[number]

export const ROLE_PAGES: Record<string, string[]> = {
  super_admin: [...ALL_PAGES],
  admin:       [...ALL_PAGES],
  operador:    ['dashboard','checkin','clients','events','reservas','reports'],
  portaria:    ['checkin'],
  financeiro:  ['dashboard','events','reports'],
  promoter:    ['promoters','clients'],
  colaborador: ['agenda'],
}

export const PAGE_LABELS: Record<string, string> = {
  dashboard:   'Dashboard',
  checkin:     'Check-in',
  clients:     'Clientes',
  events:      'Eventos',
  reservas:    'Reservas',
  promoters:   'Promoters',
  freelancers: 'Equipe',
  reports:     'Relatórios',
  whatsapp:    'WhatsApp',
  users:       'Usuários',
  settings:    'Configurações',
  agenda:      'Minha Agenda',
}

// Sub-permissões (recursos) dentro de uma página. Permite liberar, ex., Produção sem Budget.
export const PAGE_FEATURES: Record<string, { key: string; label: string; icon: string }[]> = {
  events: [
    { key: 'listas',    label: 'Listas',        icon: 'people-fill' },
    { key: 'reservas',  label: 'Reservas',      icon: 'calendar2-check-fill' },
    { key: 'equipe',    label: 'Equipe / Escala', icon: 'person-badge-fill' },
    { key: 'ingressos', label: 'Ingressos',     icon: 'ticket-perforated-fill' },
    { key: 'budget',    label: 'Budget',        icon: 'cash-stack' },
    { key: 'producao',  label: 'Produção',      icon: 'box-seam-fill' },
  ],
}

// allowed_pages pode conter sub-chaves "events.budget".
// Regra: se a página NÃO está liberada → false. Se não há nenhuma sub-chave da página → libera tudo
// (compatibilidade). Se há sub-chaves → só os recursos listados são liberados.
export function canUseFeature(allowedPages: string[] | undefined | null, page: string, feature: string): boolean {
  const ap = allowedPages ?? []
  if (!ap.includes(page)) return false
  const subKeys = ap.filter(p => p.startsWith(page + '.'))
  if (subKeys.length === 0) return true
  return ap.includes(`${page}.${feature}`)
}

export const PAGE_ICONS: Record<string, string> = {
  dashboard:   'house-fill',
  checkin:     'person-check-fill',
  clients:     'person-lines-fill',
  events:      'calendar-event-fill',
  reservas:    'calendar2-check-fill',
  promoters:   'megaphone-fill',
  freelancers: 'people-fill',
  reports:     'graph-up-arrow',
  whatsapp:    'whatsapp',
  users:       'person-gear',
  settings:    'gear-fill',
  agenda:      'list-check',
}
