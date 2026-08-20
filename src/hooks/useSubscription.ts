import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { SaasSubscription } from '../types'

/** Chave deste app em saas_products. Um app novo só precisa trocar esta constante. */
export const PRODUCT_KEY = 'nightpass'

/**
 * Assinatura viva do tenant NESTE produto (com o plano embutido). null = sem assinatura.
 *
 * A central cobra vários SaaS, então a busca é por produto + tenant — e não mais
 * "a assinatura da casa". Assim o hook é copiável para qualquer app novo: basta
 * passar o id do tenant dele e trocar PRODUCT_KEY.
 *
 * Fallback por house_id: se alguma assinatura legada estiver sem product_id/tenant_id,
 * ainda assim é encontrada (fail-open) — bloquear o cliente por dado incompleto seria pior.
 */
export function useSubscription(tenantId?: string, productKey: string = PRODUCT_KEY) {
  const [sub, setSub] = useState<SaasSubscription | null>(null)
  const [productId, setProductId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    // Sem tenantId ainda (sessão/casa em carregamento) — mantém loading=true em vez de
    // declarar "sem assinatura", senão o Gate chega a mostrar "Acesso suspenso" por um instante.
    if (!tenantId) return
    setLoading(true)

    const { data: prod } = await supabase
      .from('saas_products')
      .select('id')
      .eq('key', productKey)
      .maybeSingle()
    setProductId(prod?.id ?? null)

    let found: SaasSubscription | null = null

    if (prod?.id) {
      const { data } = await supabase
        .from('saas_subscriptions')
        .select('*, saas_plans(*)')
        .eq('product_id', prod.id)
        .eq('tenant_id', tenantId)
        .neq('status', 'canceled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      found = (data ?? null) as SaasSubscription | null
    }

    if (!found) {
      const { data } = await supabase
        .from('saas_subscriptions')
        .select('*, saas_plans(*)')
        .eq('house_id', tenantId)
        .neq('status', 'canceled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      found = (data ?? null) as SaasSubscription | null
    }

    setSub(found)
    setLoading(false)
  }, [tenantId, productKey])

  useEffect(() => { refresh() }, [refresh])

  return { sub, loading, refresh, productId }
}
