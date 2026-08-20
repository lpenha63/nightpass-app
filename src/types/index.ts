export interface House {
  id: string
  name: string
  slug?: string
  logo_url?: string
  created_at: string
}

export interface UserProfile {
  id: string
  email: string
  full_name?: string
}

export interface Session {
  house: House
  user: UserProfile
  role: string
  allowedPages: string[]
  freelancerId?: string | null
  isSaasAdmin?: boolean
  /** Todas as casas em que este usuário tem acesso ativo (para o seletor) */
  houses?: House[]
}

// ── SaaS (assinaturas) ──
export interface SaasPlan {
  id: string
  key: string
  name: string
  description?: string
  price_cents: number
  billing_period: 'monthly' | 'yearly'
  trial_days: number
  limits: Record<string, number | null>
  features: Record<string, boolean>
  active: boolean
  highlight: boolean
  sort_order: number
}

export type SaasStatus = 'trialing' | 'pending' | 'active' | 'past_due' | 'suspended' | 'canceled' | 'comp'

export interface SaasSubscription {
  id: string
  house_id: string
  plan_id: string
  status: SaasStatus
  trial_ends_at?: string | null
  current_period_start?: string | null
  current_period_end?: string | null
  grace_until?: string | null
  mp_preapproval_id?: string | null
  payer_email?: string | null
  saas_plans?: SaasPlan
}

export interface Client {
  id: string
  house_id: string
  full_name: string
  cpf?: string
  phone?: string
  birth_date?: string
  gender?: string
  email?: string
  photo_url?: string
  fingerprint_id?: string
  source?: string
  referral_source?: string
  status: string
  created_at: string
}

export interface ArtistEntry {
  name: string
  fee_type: 'fixed' | 'percent' | 'mixed' | 'tbd'
  fee_cents: number
  fee_percent: number
  consumption_cents: number
}

export interface PromotionEntry {
  label: string
  value_cents: number
}

export type PromoterPriceMode = 'list' | 'other' | 'vip'

export interface Event {
  id: string
  house_id: string
  name: string
  event_date: string
  genre?: string
  start_time?: string
  end_time?: string
  price_male_cents?: number
  price_female_cents?: number
  price_male_list_cents?: number
  price_female_list_cents?: number
  list_cutoff_time?: string | null
  price_male_list_early_cents?: number
  price_female_list_early_cents?: number
  is_operation?: boolean
  capacity?: number
  repeat_rule?: string
  attractions?: string
  promotions?: string
  promotions_list?: PromotionEntry[]
  promoter_enabled?: boolean
  promoter_invites?: string[]
  promoter_price_mode?: PromoterPriceMode
  promoter_price_cents?: number
  flyer_url?: string
  birthday_list_enabled?: boolean
  house_list_enabled?: boolean
  observations?: string
  artist_fee_cents?: number
  artists?: ArtistEntry[]
  consumption_cents?: number
  production_cost_cents?: number
  staffing_needs?: Record<string, number>
  list_locks?: { casa?: boolean; promoters?: boolean; reservas?: boolean }
  status: string
  created_at: string
}

export interface Checkin {
  id: string
  house_id: string
  client_id?: string
  event_id?: string
  amount_cents: number
  payment_method: string
  checkin_type: string
  created_at: string
  clients?: Pick<Client, 'full_name' | 'phone' | 'cpf'>
  events?: Pick<Event, 'name' | 'event_date'>
}

export interface Reservation {
  id: string
  house_id: string
  name: string
  phone?: string
  event_id?: string
  people_count?: number
  expected_arrival?: string
  location?: string
  status: string
  token?: string
  max_guests?: number
  created_at: string
}

export interface BirthdayList {
  id: string
  house_id: string
  birthday_person_name: string
  phone?: string
  birthday_date?: string
  token?: string
  event_id?: string
  max_guests?: number
  created_at: string
}

export type WorkType = 'limpeza' | 'cozinha' | 'servicos_gerais' | 'garcom' | 'cumim' | 'recepcao' | 'atendente' | 'seguranca'

export interface Freelancer {
  id: string
  house_id: string
  full_name: string
  address?: string
  phone?: string
  pix_key?: string
  daily_rate_cents?: number
  hourly_rate_cents?: number
  work_types: WorkType[]
  staff_type?: string
  notes?: string
  status: string
  access_token?: string
  can_delegate_tasks?: boolean
  can_see_all_events?: boolean
  created_at: string
}

export interface TicketBatch {
  id: string
  event_id: string
  house_id: string
  name: string
  gender: 'male' | 'female' | 'both'
  price_cents: number
  quantity: number
  sold: number
  active: boolean
  expires_at?: string
  /** Taxa de serviço em % somada ao preço na compra */
  service_fee_pct?: number
  /** Exige o nome de cada participante na compra */
  nominal?: boolean
  created_at: string
}

export interface TicketOrder {
  id: string
  house_id: string
  event_id: string
  batch_id: string
  buyer_name: string
  buyer_cpf?: string
  buyer_phone?: string
  buyer_email?: string
  quantity: number
  amount_cents: number
  payment_status: 'pending' | 'paid' | 'cancelled'
  payment_method?: string
  payment_id?: string
  /** Parte de amount_cents que é taxa de serviço (não é receita de ingresso) */
  service_fee_cents?: number
  mp_preference_id?: string
  notes?: string
  created_at: string
  ticket_batches?: Pick<TicketBatch, 'name' | 'gender' | 'price_cents'>
}

export interface Ticket {
  id: string
  order_id: string
  event_id: string
  house_id: string
  token: string
  holder_name?: string
  checked_in: boolean
  checked_in_at?: string
  created_at: string
}

export interface EventFreelancer {
  id: string
  event_id: string
  freelancer_id: string
  confirmed: boolean
  role?: string
  custom_fee_cents?: number | null
  entry_time?: string | null
  created_at: string
  freelancers?: Pick<Freelancer, 'full_name' | 'work_types' | 'daily_rate_cents' | 'phone'>
}

export interface WhatsAppConfig {
  id?: string
  house_id: string
  instance_name: string
  api_url: string
  api_key: string
  active: boolean
  send_checkin_confirm: boolean
  send_birthday_wish: boolean
  send_event_invite: boolean
}
