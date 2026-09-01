import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTicketWhatsApp } from './_ticket-wa.js'
import { sendTicketEmail } from './_ticket-email.js'

/**
 * O que acontece quando um pagamento e confirmado, seja qual for o gateway.
 *
 * Vive num arquivo so de proposito. Cada gateway novo traz um webhook novo, e
 * copiar este bloco para cada um garante que eles divirjam com o tempo — um
 * passa a mandar e-mail e o outro nao, um incrementa o lote e o outro esquece.
 * Aqui o webhook de cada gateway cuida apenas de PROVAR que o pagamento e
 * legitimo; o que acontece depois e identico para todos.
 */
export interface PedidoConfirmavel {
  id: string
  house_id: string
  event_id: string
  batch_id: string
  quantity: number
  buyer_name: string
  buyer_phone: string | null
  buyer_email: string | null
  holder_names: unknown
  payment_status: string | null
}

export async function confirmarPedido(sb: SupabaseClient, order: PedidoConfirmavel): Promise<void> {
  // Idempotencia: gateway reenvia notificacao. Sem esta trava, a segunda entrega
  // geraria a segunda leva de ingressos para o mesmo pedido.
  const { data: atual } = await sb
    .from('ticket_orders').select('payment_status').eq('id', order.id).single()
  if (atual?.payment_status === 'paid') return

  await sb.from('ticket_orders').update({ payment_status: 'paid' }).eq('id', order.id)

  // Ingresso nominal: usa os nomes coletados na compra (guardados no pedido, porque
  // os ingressos so nascem aqui, quando o pagamento confirma).
  const nomes: string[] = Array.isArray(order.holder_names) ? order.holder_names as string[] : []
  const tickets = Array.from({ length: order.quantity }, (_, i) => ({
    order_id: order.id,
    event_id: order.event_id,
    house_id: order.house_id,
    token: crypto.randomUUID(),
    holder_name: String(nomes[i] ?? '').trim() || order.buyer_name,
    checked_in: false,
  }))

  await sb.from('tickets').insert(tickets)
  await sb.rpc('increment_batch_sold', { p_batch_id: order.batch_id, p_qty: order.quantity })

  // Entrega o link do ingresso — sem isso o comprador so teria o QR na aba aberta na
  // hora. Os dois canais sao best-effort e independentes: falha num nao impede o outro.
  await Promise.allSettled([
    sendTicketWhatsApp(sb, {
      houseId: order.house_id, eventId: order.event_id, orderId: order.id,
      buyerName: order.buyer_name, buyerPhone: order.buyer_phone, quantity: order.quantity,
    }),
    sendTicketEmail(sb, {
      houseId: order.house_id, eventId: order.event_id, orderId: order.id,
      buyerName: order.buyer_name, buyerEmail: order.buyer_email, quantity: order.quantity,
    }),
  ])
}
