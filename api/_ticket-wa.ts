import type { SupabaseClient } from '@supabase/supabase-js'

// Envia o link do ingresso por WhatsApp assim que o pagamento é confirmado.
// Roda no servidor (service role), então lê whatsapp_config direto — o utilitário do front
// (src/utils/whatsapp.ts) não serve aqui porque depende do navegador.
// É best-effort: se o WhatsApp da casa estiver fora, a compra segue válida do mesmo jeito.

function fmtPhone(phone: string): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) return d
  if (d.length === 10 || d.length === 11) return '55' + d
  return d.length >= 10 ? '55' + d : null
}

export async function sendTicketWhatsApp(
  sb: SupabaseClient,
  opts: {
    houseId: string
    eventId: string
    orderId: string
    buyerName: string
    buyerPhone: string
    quantity: number
  }
): Promise<void> {
  try {
    const fph = fmtPhone(opts.buyerPhone)
    if (!fph) return

    const [{ data: cfg }, { data: ev }, { data: tks }] = await Promise.all([
      sb.from('whatsapp_config').select('api_url,instance_name,api_key,active').eq('house_id', opts.houseId).limit(1).single(),
      sb.from('events').select('name,event_date,start_time,houses(name)').eq('id', opts.eventId).single(),
      sb.from('tickets').select('token').eq('order_id', opts.orderId).order('created_at').limit(1),
    ])

    if (!cfg?.active || !cfg.api_url || !cfg.instance_name || !cfg.api_key) return
    const token = tks?.[0]?.token
    if (!token) return

    const appUrl = (process.env.APP_URL || '').trim() || 'https://www.nightpassapp.com.br'
    const link = `${appUrl}/ingresso/${token}`
    const casa = (ev as { houses?: { name?: string } } | null)?.houses?.name
    const data = ev?.event_date
      ? new Date(ev.event_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      : ''
    const hora = ev?.start_time ? ` às ${String(ev.start_time).slice(0, 5)}` : ''

    const linhas = [
      '🎫 *Ingresso confirmado!*',
      '',
      `*${ev?.name ?? 'Evento'}*`,
      [data && `📅 ${data}${hora}`, casa && `📍 ${casa}`].filter(Boolean).join('\n'),
      '',
      opts.quantity > 1 ? `Você comprou ${opts.quantity} ingressos — o link abre todos.` : 'Abra o link para ver seu QR code:',
      link,
      '',
      '_Guarde este link. Ele abre seu ingresso a qualquer momento._',
    ].filter(l => l !== undefined)

    const msg = linhas.join('\n')
    const resp = await fetch(`${cfg.api_url}/message/sendText/${cfg.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
      body: JSON.stringify({ number: fph, text: msg, linkPreview: true }),
    })
    const res = await resp.json().catch(() => null)
    const ok = !!(res?.key || res?.status === 'success' || res?.status === 'PENDING')

    await sb.from('whatsapp_logs').insert({
      house_id: opts.houseId, recipient_phone: fph, recipient_name: opts.buyerName,
      message_type: 'ticket_delivery', message_body: msg,
      status: ok ? 'sent' : 'failed',
      error_msg: ok ? null : JSON.stringify(res),
      related_event_id: opts.eventId,
      sent_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('sendTicketWhatsApp:', e)
  }
}
