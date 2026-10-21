import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { admin } from './_gateways.js'
import { confirmarPedido, type PedidoConfirmavel } from './_confirmar-pedido.js'

/**
 * Confirma à mão um pedido pago fora do gateway (PIX na chave da casa).
 *
 * Existe porque a tela marcava o pedido como pago e PARAVA aí: nenhum ingresso
 * era emitido e nada chegava ao comprador. Quem paga pelo Mercado Pago recebe
 * tudo automaticamente — o webhook chama confirmarPedido. Quem paga na chave PIX
 * manual pagava e não recebia nada.
 *
 * Reusa o MESMO confirmarPedido dos webhooks de propósito: emitir ingresso, dar
 * baixa no lote e entregar ao comprador precisam acontecer igual, venha a
 * confirmação de onde vier. Copiar esse bloco para cá seria garantir que um dia
 * divergissem.
 *
 * A emissão exige service_role (o navegador não tem, e não pode ter), por isso a
 * tela não consegue fazer isso sozinha — daí esta rota.
 */

const SB_URL = process.env.SUPABASE_URL ?? 'https://irghwfzcbazujddfftsx.supabase.co'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' })

  const jwt = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
  if (!jwt) return res.status(401).json({ error: 'Não autenticado' })

  const orderId = String((req.body as { order_id?: string } | undefined)?.order_id ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return res.status(400).json({ error: 'Pedido inválido' })

  // Quem é quem: cliente com o token do usuário, só para identificá-lo.
  const comoUsuario = createClient(SB_URL, process.env.VITE_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: userData } = await comoUsuario.auth.getUser()
  const userId = userData?.user?.id
  if (!userId) return res.status(401).json({ error: 'Sessão inválida' })

  const sb = admin()

  const { data: pedido } = await sb
    .from('ticket_orders')
    .select('id,house_id,event_id,batch_id,quantity,buyer_name,buyer_phone,buyer_email,holder_names,payment_status')
    .eq('id', orderId)
    .maybeSingle()
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' })

  // Sem esta checagem, QUALQUER usuário autenticado confirmaria o pedido de
  // qualquer casa — e confirmar emite ingresso válido na portaria.
  const { data: vinculo } = await sb
    .from('house_users')
    .select('id')
    .eq('house_id', (pedido as { house_id: string }).house_id)
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (!vinculo) return res.status(403).json({ error: 'Sem permissão para este pedido' })

  const p = pedido as PedidoConfirmavel
  if (p.payment_status === 'paid') return res.status(200).json({ ok: true, ja_estava: true })

  try {
    await confirmarPedido(sb, p)
  } catch (e) {
    return res.status(500).json({ error: 'Falha ao emitir: ' + (e as Error).message })
  }

  const { count } = await sb
    .from('tickets').select('id', { count: 'exact', head: true }).eq('order_id', p.id)
  return res.status(200).json({ ok: true, ingressos: count ?? 0 })
}
