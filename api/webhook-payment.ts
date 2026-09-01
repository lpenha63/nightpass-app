import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { tokenMercadoPago } from './_gateways.js'
import { confirmarPedido } from './_confirmar-pedido.js'

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // MP sends GET to validate the webhook URL
  if (req.method === 'GET') return res.json({ ok: true })
  if (req.method !== 'POST') return res.status(405).end()

  const { type, data } = req.body ?? {}
  if (type !== 'payment' || !data?.id) return res.json({ ok: true })

  const paymentId = String(data.id)
  const sb = supabaseAdmin()

  // Acha o pedido. No Checkout Pro o id do pagamento só nasce quando o comprador paga,
  // então mandamos o id do pedido na própria notification_url (?order=...).
  // O PIX direto continua funcionando pelo payment_id gravado na criação.
  const orderId = typeof req.query.order === 'string' ? req.query.order : null
  const q = sb.from('ticket_orders').select('*')
  const { data: order } = orderId
    ? await q.eq('id', orderId).single()
    : await q.eq('payment_id', paymentId).single()

  if (!order || order.payment_status === 'paid') return res.json({ ok: true })

  // Credencial do gateway: vem do cofre, fora do alcance da API publica.
  const mpToken = await tokenMercadoPago(sb, order.house_id)
  if (!mpToken) return res.status(400).json({ error: 'No MP config' })

  try {
    const { MercadoPagoConfig, Payment } = await import('mercadopago')
    const client = new MercadoPagoConfig({ accessToken: mpToken })
    const paymentApi = new Payment(client)
    const mpPay = await paymentApi.get({ id: Number(paymentId) })

    // O pagamento consultado tem que ser DESTE pedido. Sem esta checagem, alguém
    // poderia chamar o webhook com ?order=<pedido alheio> e o id de qualquer
    // pagamento aprovado, e nós liberaríamos ingresso sem pagamento correspondente.
    if (String(mpPay.external_reference ?? '') !== String(order.id)) {
      console.error('Webhook: pagamento', paymentId, 'não pertence ao pedido', order.id)
      return res.status(400).json({ error: 'Pagamento não corresponde ao pedido' })
    }
    // Valor também precisa bater, para não confirmar com uma cobrança de outro valor
    const pagoCents = Math.round((mpPay.transaction_amount ?? 0) * 100)
    if (pagoCents < (order.amount_cents ?? 0)) {
      console.error('Webhook: valor pago', pagoCents, 'menor que o pedido', order.amount_cents)
      return res.status(400).json({ error: 'Valor divergente' })
    }

    if (mpPay.status !== 'approved') return res.json({ ok: true })
    await sb.from('ticket_orders')
      .update({ payment_id: paymentId, payment_method: mpPay.payment_method_id ?? null })
      .eq('id', order.id)
  } catch (e) {
    console.error('MP verify error:', e)
    return res.status(500).json({ error: 'MP verify failed' })
  }

  // Daqui para a frente e identico para qualquer gateway: o webhook so precisava
  // provar que o pagamento e legitimo.
  await confirmarPedido(sb, order)

  res.json({ ok: true })
}
