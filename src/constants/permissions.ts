export const ALL_PAGES = [
  'dashboard','checkin','clients','events','reservas',
  'promoters','freelancers','reports','whatsapp','users','settings',
] as const

export type AppPage = typeof ALL_PAGES[number]

export const ROLE_PAGES: Record<string, string[]> = {
  super_admin: [...ALL_PAGES],
  admin:       [...ALL_PAGES],
  operador:    ['dashboard','checkin','clients','events','reservas','reports'],
  portaria:    ['checkin'],
  financeiro:  ['dashboard','events','reports'],
  promoter:    ['promoters','clients'],
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
}
