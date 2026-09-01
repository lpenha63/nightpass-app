import type { VercelRequest, VercelResponse } from '@vercel/node'
import { admin, chaveAsaas } from './_gateways.js'
import { confirmarPedido, type PedidoConfirmavel } from './_confirmar-pedido.js'

/**
 * Aviso de pagamento da Asaas.
 *
 * A responsabilidade daqui e so uma: PROVAR que o pagamento e legitimo. O que
 * acontece depois (marcar pago, gerar ingresso, avisar o comprador) mora em
 * confirmarPedido, compartilhado com o Mercado Pago.
 *
 * Tres verificacoes, todas necessarias:
 *   1. o cabecalho asaas-access-token bate com o token que geramos ao conectar —
 *      senao qualquer um poderia chamar esta URL e liberar ingresso de graca;
 *   2. a cobranca pertence ao pedido citado (externalReference);
 *   3. o valor pago cobre o valor do pedido.
 */

const PAGOS = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return res.json({ ok: true })
  if (req.method !== 'POST') return res.status(405).end()

  const houseId = typeof req.query.house === 'string' ? req.query.house : null
  if (!houseId) return res.status(400).json({ error: 'Casa não informada' })

  const sb = admin()
  const cred = await chaveAsaas(sb, houseId)
  if (!cred) return res.status(400).json({ error: 'Asaas não configurado para esta casa' })

  // ── 1. A notificacao veio mesmo da Asaas? ──
  const enviado = String(req.headers['asaas-access-token'] ?? '')
  if (!cred.webhook_token || enviado !== cred.webhook_token) {
    console.error('Webhook Asaas: token invalido para a casa', houseId)
    return res.status(401).json({ error: 'Origem não autorizada' })
  }

  const evento = String(req.body?.event ?? '')
  const pagamento = req.body?.payment as
    { id?: string; status?: string; value?: number; externalReference?: string; billingType?: string } | undefined
  if (!pagamento?.id) return res.json({ ok: true })

  // Eventos que nao sao confirmacao de dinheiro entrando: reconhecidos e ignorados,
  // para a Asaas parar de reenviar.
  if (!evento.startsWith('PAYMENT_') || !PAGOS.includes(String(pagamento.status))) {
    return res.json({ ok: true })
  }

  // ── 2. A cobranca aponta para um pedido nosso? ──
  const pedidoId = String(pagamento.externalReference ?? '')
  if (!pedidoId) return res.json({ ok: true })

  const { data: order } = await sb.from('ticket_orders').select('*').eq('id', pedidoId).single()
  if (!order) return res.json({ ok: true })
  if (order.house_id !== houseId) {
    console.error('Webhook Asaas: pedido', pedidoId, 'nao pertence a casa', houseId)
    return res.status(400).json({ error: 'Pedido de outra casa' })
  }
  if (order.payment_status === 'paid') return res.json({ ok: true })

  // ── 3. O valor cobre o pedido? ──
  const pagoCents = Math.round((pagamento.value ?? 0) * 100)
  if (pagoCents < (order.amount_cents ?? 0)) {
    console.error('Webhook Asaas: valor pago', pagoCents, 'menor que o pedido', order.amount_cents)
    return res.status(400).json({ error: 'Valor divergente' })
  }

  await sb.from('ticket_orders')
    .update({ payment_id: String(pagamento.id), payment_method: pagamento.billingType ?? null })
    .eq('id', order.id)

  await confirmarPedido(sb, order as PedidoConfirmavel)
  res.json({ ok: true })
}
