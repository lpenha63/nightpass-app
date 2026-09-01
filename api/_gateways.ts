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
