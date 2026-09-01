import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { admin, asaas, baseAsaas } from './_gateways.js'

/**
 * Conecta a conta Asaas de uma casa.
 *
 * Faz tres coisas que o cliente teria de fazer a mao em qualquer tutorial:
 *   1. valida a chave contra a Asaas e devolve de QUEM e a conta;
 *   2. registra o webhook de pagamento pela API, para o ingresso liberar sozinho;
 *   3. guarda a credencial no cofre (house_payment_providers), que o navegador
 *      nao le em papel nenhum.
 *
 * A chave passa por aqui uma vez, no corpo do POST, e nunca volta.
 */

const EVENTOS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { house_id, api_key } = req.body ?? {}
  if (!house_id || !api_key) return res.status(400).json({ error: 'Dados incompletos' })

  const chave = String(api_key).trim()
  if (!chave.startsWith('$aact_')) {
    return res.status(200).json({
      ok: false,
      error: 'A chave da Asaas começa com $aact_. Confira se copiou a chave de API inteira.',
    })
  }

  // ── Quem esta pedindo precisa ser admin DESTA casa ──
  const jwt = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
  if (!jwt) return res.status(401).json({ error: 'Não autenticado' })

  const comoUsuario = createClient(
    process.env.SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  )
  const { data: userData } = await comoUsuario.auth.getUser()
  if (!userData?.user) return res.status(401).json({ error: 'Sessão inválida' })

  const { data: membro } = await comoUsuario.from('house_users')
    .select('role').eq('house_id', house_id).eq('user_id', userData.user.id)
    .eq('is_active', true).maybeSingle()
  if (!membro || !['super_admin', 'admin'].includes(String(membro.role))) {
    return res.status(403).json({ error: 'Só administradores podem configurar o recebimento.' })
  }

  // ── 1. A chave e valida? De quem e a conta? ──
  const conta = await asaas<{ name?: string; email?: string; cpfCnpj?: string }>(chave, '/myAccount')
  if (!conta.ok) {
    return res.status(200).json({
      ok: false,
      error: conta.status === 401
        ? 'Chave recusada pela Asaas. Confira se copiou a chave inteira e do ambiente certo.'
        : conta.erro,
    })
  }

  const sandbox = baseAsaas(chave).includes('sandbox')

  // ── 2. Webhook: registrado por nos, nao pelo cliente ──
  const appUrl = (process.env.APP_URL || '').trim() || 'https://www.nightpassapp.com.br'
  const webhookToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')

  // A Asaas recusa webhook duplicado na mesma URL, entao removemos o anterior desta casa
  // antes de criar o novo — reconectar a conta nao pode deixar lixo acumulado.
  const url = `${appUrl}/api/webhook-asaas?house=${house_id}`
  const existentes = await asaas<{ data?: Array<{ id: string; url: string }> }>(chave, '/webhooks')
  for (const w of existentes.data?.data ?? []) {
    if (w.url === url) await asaas(chave, `/webhooks/${w.id}`, { method: 'DELETE' })
  }

  const hook = await asaas<{ id?: string }>(chave, '/webhooks', {
    method: 'POST',
    body: {
      name: 'NightPass — ingressos',
      url,
      email: userData.user.email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: webhookToken,
      sendType: 'SEQUENTIALLY',
      events: EVENTOS,
    },
  })
  if (!hook.ok) {
    return res.status(200).json({
      ok: false,
      error: `A chave funciona, mas não consegui registrar o aviso de pagamento: ${hook.erro}. ` +
             'Sem ele o ingresso não seria liberado sozinho, então não gravei a configuração.',
    })
  }

  // ── 3. Guarda no cofre ──
  const { error } = await admin().from('house_payment_providers').upsert({
    house_id,
    provider: 'asaas',
    credentials: { api_key: chave, webhook_token: webhookToken },
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'house_id,provider' })

  if (error) return res.status(500).json({ error: 'Falha ao guardar a credencial: ' + error.message })

  return res.status(200).json({
    ok: true,
    conta: conta.data?.name ?? null,
    email: conta.data?.email ?? null,
    sandbox,
  })
}
