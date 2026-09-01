import type { SupabaseClient } from '@supabase/supabase-js'

// Entrega do ingresso por e-mail (Resend).
// Complementa o WhatsApp: quem não informar telefone válido, ou perder a mensagem,
// ainda recebe. É best-effort — falha aqui nunca invalida a compra.
//
// Requer duas variáveis de ambiente:
//   RESEND_API_KEY  — chave da conta Resend
//   RESEND_FROM     — remetente verificado, ex: ingressos@suaempresa.com.br
// Sem elas a função simplesmente não envia (e não quebra nada).
//
// O nome da CASA vai no display do remetente ("Vila Beats via NightPass"), então um
// único domínio verificado atende todas as casas — nenhum cliente novo precisa mexer em DNS.

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function sendTicketEmail(
  sb: SupabaseClient,
  opts: {
    houseId: string
    eventId: string
    orderId: string
    buyerName: string
    buyerEmail?: string | null
    quantity: number
  }
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!apiKey || !from || !opts.buyerEmail) return

  try {
    const [{ data: ev }, { data: tks }] = await Promise.all([
      sb.from('events').select('name,event_date,start_time,houses(name)').eq('id', opts.eventId).single(),
      sb.from('tickets').select('token,holder_name').eq('order_id', opts.orderId).order('created_at'),
    ])
    const ingressos = (tks ?? []) as Array<{ token: string; holder_name?: string }>
    if (!ingressos.length) return

    const appUrl = (process.env.APP_URL || '').trim() || 'https://www.nightpassapp.com.br'
    const casa = (ev as { houses?: { name?: string } } | null)?.houses?.name ?? 'NightPass'
    const data = ev?.event_date
      ? new Date(ev.event_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
      : ''
    const hora = ev?.start_time ? ` · ${String(ev.start_time).slice(0, 5)}` : ''

    const linhas = ingressos.map((t, i) => `
      <tr>
        <td style="padding:14px 16px;border:1px solid #e6e6e6;border-radius:10px;background:#fafafa">
          <div style="font-size:12px;color:#888;margin-bottom:2px">Ingresso ${i + 1} de ${ingressos.length}</div>
          <div style="font-size:15px;font-weight:700;color:#111">${esc(t.holder_name || opts.buyerName)}</div>
          <div style="font-size:12px;color:#666;font-family:monospace;letter-spacing:1px;margin-top:4px">
            ${esc(t.token.slice(0, 8).toUpperCase())}
          </div>
          <a href="${appUrl}/ingresso/${esc(t.token)}"
             style="display:inline-block;margin-top:10px;background:#111;color:#fff;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:700">
            Abrir QR code
          </a>
        </td>
      </tr>
      <tr><td style="height:10px"></td></tr>`).join('')

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" style="max-width:540px;margin:0 auto;background:#fff;border-radius:14px;padding:28px">
    <tr><td>
      <div style="font-size:12px;letter-spacing:2px;color:#888;text-transform:uppercase">${esc(casa)}</div>
      <h1 style="margin:6px 0 4px;font-size:24px;color:#111">${esc(ev?.name ?? 'Seu ingresso')}</h1>
      <div style="font-size:14px;color:#555;text-transform:capitalize">${esc(data)}${esc(hora)}</div>

      <p style="font-size:15px;color:#333;line-height:1.6;margin:22px 0 16px">
        Olá, ${esc(opts.buyerName.split(' ')[0])}! Seu pagamento foi confirmado e
        ${ingressos.length > 1 ? `seus ${ingressos.length} ingressos estão` : 'seu ingresso está'} pronto.
      </p>

      <table role="presentation" width="100%">${linhas}</table>

      <p style="font-size:13px;color:#666;line-height:1.6;margin-top:18px">
        Apresente o QR code na entrada. Cada código permite <b>uma única entrada</b>.
        Guarde este e-mail — os links funcionam a qualquer momento.
      </p>

      <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
      <div style="font-size:11px;color:#999;line-height:1.5">
        Você recebeu este e-mail porque comprou um ingresso em ${esc(casa)}.<br />
        Emitido por NightPass Tickets.
      </div>
    </td></tr>
  </table>
</body></html>`

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Display com o nome da casa; endereço é o domínio único verificado
        from: `${casa} via NightPass <${from}>`,
        to: [opts.buyerEmail],
        subject: `🎫 Seu ingresso — ${ev?.name ?? casa}`,
        html,
      }),
    })
    if (!r.ok) console.error('Resend falhou:', r.status, await r.text().catch(() => ''))
  } catch (e) {
    console.error('sendTicketEmail:', e)
  }
}
