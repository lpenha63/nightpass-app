import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Credenciais de recebimento por casa.
 *
 * Cada estabelecimento configura o proprio meio, e nem todos usam o mesmo: a chave
 * e (casa, provedor). Por isso a credencial e um jsonb — PagSeguro pede token +
 * e-mail, Stripe pede secret key + webhook secret, Asaas pede uma API key. Coluna
 * fixa obrigaria migrar segredo a cada gateway novo.
 *
 * Vive em house_payment_providers, tabela com RLS ligada e NENHUMA policy: nao ha
 * como ler pelo PostgREST em papel nenhum. Estas funcoes so funcionam com o cliente
 * service_role, que existe apenas no servidor.
 */

export type Provedor =
  | 'mercadopago' | 'pagseguro' | 'asaas' | 'stripe' | 'pagarme' | 'infinitepay' | 'cielo'

export function admin(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/** Credenciais de um provedor para uma casa. `null` quando nao ha nada configurado. */
export async function credenciais(
  sb: SupabaseClient, houseId: string, provedor: Provedor,
): Promise<Record<string, string> | null> {
  const { data } = await sb
    .from('house_payment_providers')
    .select('credentials')
    .eq('house_id', houseId).eq('provider', provedor).eq('active', true)
    .maybeSingle()
  const c = (data?.credentials ?? null) as Record<string, string> | null
  return c && Object.keys(c).length > 0 ? c : null
}

/** Atalho para o unico gateway integrado ate agora. */
export async function tokenMercadoPago(sb: SupabaseClient, houseId: string): Promise<string | null> {
  const c = await credenciais(sb, houseId, 'mercadopago')
  const t = (c?.access_token ?? '').trim()
  return t || null
}

/* ────────────────────────────── Asaas ──────────────────────────────
 * Diferencas em relacao ao Mercado Pago que moldam o codigo abaixo:
 *
 * - Autenticacao por cabecalho `access_token`, nao Bearer.
 * - O ambiente vem do PREFIXO da chave: $aact_prod_ vai para a API de producao,
 *   $aact_hmlg_ para a de homologacao. Errar isso e cobrar de mentira achando que
 *   e de verdade, entao a escolha e derivada da chave e nao configuravel a mao.
 * - O webhook e por CONTA, nao por cobranca (no MP mandamos notification_url em
 *   cada pagamento). Por isso ele e registrado uma vez, via POST /v3/webhooks,
 *   quando o cliente conecta a conta — assim ele continua sem configurar nada.
 * - A cobranca exige um `customer` cadastrado antes; nao da para cobrar avulso.
 */

export interface CredenciaisAsaas { api_key: string; webhook_token?: string }

export function baseAsaas(apiKey: string): string {
  return apiKey.startsWith('$aact_hmlg_') || apiKey.includes('_hmlg_')
    ? 'https://api-sandbox.asaas.com/v3'
    : 'https://api.asaas.com/v3'
}

export async function asaas<T = unknown>(
  apiKey: string, caminho: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T | null; erro: string | null }> {
  const r = await fetch(`${baseAsaas(apiKey)}${caminho}`, {
    method: init.method ?? 'GET',
    headers: {
      access_token: apiKey,
      'Content-Type': 'application/json',
      // A Asaas pede identificacao da integracao; sem isso algumas contas tomam bloqueio.
      'User-Agent': 'NightPass',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const corpo = await r.json().catch(() => null)
  if (!r.ok) {
    // Erro da Asaas vem em { errors: [{ code, description }] }
    const d = (corpo as { errors?: Array<{ description?: string }> } | null)?.errors?.[0]?.description
    return { ok: false, status: r.status, data: null, erro: d ?? `Asaas respondeu ${r.status}` }
  }
  return { ok: true, status: r.status, data: corpo as T, erro: null }
}

export async function chaveAsaas(sb: SupabaseClient, houseId: string): Promise<CredenciaisAsaas | null> {
  const c = await credenciais(sb, houseId, 'asaas')
  const k = (c?.api_key ?? '').trim()
  return k ? { api_key: k, webhook_token: c?.webhook_token } : null
}
