// ─── Domínio da central de assinaturas (multi-SaaS) ───

/** App vendido pela plataforma (nightpass, e os próximos). */
export interface Product {
  id: string; key: string; name: string
  description?: string | null; app_url?: string | null; active: boolean
}

export type PlanLimits = Record<string, number | null | undefined>
export type PlanFeatures = Record<string, boolean | undefined>

/**
 * Régua de plano declarada POR PRODUTO. É o que permite cadastrar um app novo
 * (academia, restaurante…) com dimensões próprias sem tocar em código.
 * O plano guarda os valores em limits/features usando estas `key`.
 */
export interface Dimension {
  id: string; product_id: string
  kind: 'limit' | 'feature'
  key: string; label: string
  unit?: string | null; description?: string | null
  enforced: boolean          // o app realmente aplica? false = plano decorativo
  sort_order: number; active: boolean
}

/** Plano de um produto. Preço sempre em centavos. */
export interface Plan {
  id: string; key: string; name: string; description?: string | null
  price_cents: number; billing_period?: string; trial_days?: number
  product_id?: string | null; active: boolean; highlight?: boolean; sort_order: number
  limits?: PlanLimits; features?: PlanFeatures
}

/** O cliente que paga — independente de qualquer produto. */
export interface Customer {
  id: string; name: string; trade_name?: string | null
  doc?: string | null; doc_type?: 'cnpj' | 'cpf' | null
  email?: string | null; phone?: string | null
  address?: string | null; city?: string | null; state?: string | null; zip?: string | null
  billing_day: number; status: 'active' | 'inactive'; notes?: string | null
  created_at?: string; updated_at?: string
}

export type SubStatus = 'trialing' | 'pending' | 'active' | 'past_due' | 'suspended' | 'canceled' | 'comp'

/**
 * Assinatura: 1 cliente pode ter N assinaturas (uma por produto).
 * tenant_id = id da entidade dentro do app (NightPass = houses.id).
 * house_id é legado do NightPass, mantido durante a transição.
 */
export interface Sub {
  id: string; customer_id: string; product_id?: string | null; tenant_id?: string | null
  house_id?: string | null; plan_id: string; status: SubStatus
  trial_ends_at?: string | null; current_period_start?: string | null
  current_period_end?: string | null; grace_until?: string | null
  billing_method?: string | null; billing_day?: number | null
  mp_preapproval_id?: string | null; payer_email?: string | null
  created_at?: string
  saas_plans?: Plan
  saas_customers?: Customer
}

export type InvoiceStatus = 'open' | 'paid' | 'overdue' | 'canceled' | 'void'
export type PayMethod = 'card_recurring' | 'pix' | 'boleto' | 'manual'

/** Fatura = o que é devido. Uma por assinatura/competência (nunca consolidada entre apps). */
export interface Invoice {
  id: string; customer_id: string; subscription_id?: string | null; product_id?: string | null
  competence: string; amount_cents: number; discount_cents: number
  due_date: string; status: InvoiceStatus; method?: PayMethod | null
  paid_at?: string | null; paid_amount_cents?: number | null
  checkout_url?: string | null; pix_copia_cola?: string | null; boleto_url?: string | null
  notes?: string | null; created_at?: string
  saas_customers?: Customer
}

export interface MessageTemplate {
  id: string; product_id?: string | null; key: string; channel: string
  body: string; active: boolean
}

export interface Message {
  id: string; customer_id: string; invoice_id?: string | null
  channel: string; to_addr: string; template_key?: string | null; body: string
  status: 'queued' | 'sent' | 'failed' | 'canceled'
  error?: string | null; attempts: number; sent_at?: string | null; created_at: string
}

export interface DunningStep { offset: number; template: string }

export interface PlatformConfig {
  id: number; company_name?: string | null
  wa_api_url?: string | null; wa_instance?: string | null; wa_api_key?: string | null
  wa_active: boolean; billing_day_default: number; grace_days: number
  dunning: DunningStep[]
}

export interface Payment {
  id: string; customer_id?: string | null; house_id?: string | null
  amount_cents: number; status: string; method?: string | null
  paid_at?: string | null; created_at: string
}
