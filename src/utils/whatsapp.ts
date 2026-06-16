export function fmtWAPhone(phone: string): string | null {
  const d = phone.replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) return d
  if (d.length === 11 || d.length === 10) return '55' + d
  if (d.length === 13 && d.startsWith('55')) return d
  return d.length >= 10 ? '55' + d : null
}

/**
 * Envio direto/avulso de WhatsApp.
 * - Se a casa tem Evolution API ativa e configurada → envia pela API (sem abrir aba) e registra log.
 * - Caso contrário (ou se a API falhar) → cai no fallback wa.me abrindo uma aba.
 * Retorna { ok, viaApi } para o chamador decidir feedback.
 */
export async function sendWADirect(
  houseId: string,
  phone: string,
  message: string,
  opts: { mediaUrl?: string; clientId?: string | null; eventId?: string | null; type?: string } = {}
): Promise<{ ok: boolean; viaApi: boolean }> {
  const { supabase } = await import('../lib/supabase')
  const fph = fmtWAPhone(phone)

  const { data: cfg } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('house_id', houseId)
    .limit(1)
    .single()

  const useApi = !!(cfg?.active && cfg?.api_url && cfg?.instance_name && cfg?.api_key && fph)

  if (useApi) {
    try {
      const useMedia = !!opts.mediaUrl
      const body = useMedia
        ? { number: fph, mediatype: 'image', media: opts.mediaUrl, caption: message }
        : { number: fph, text: message }
      const resp = await fetch(`${cfg.api_url}/message/${useMedia ? 'sendMedia' : 'sendText'}/${cfg.instance_name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
        body: JSON.stringify(body),
      })
      const res = await resp.json()
      const ok = !!(res?.key || res?.status === 'success' || res?.status === 'PENDING')
      await supabase.from('whatsapp_logs').insert({
        house_id: houseId, recipient_phone: fph, message_type: opts.type ?? 'direct',
        message_body: message, status: ok ? 'sent' : 'failed',
        error_msg: ok ? null : JSON.stringify(res),
        related_client_id: opts.clientId ?? null, related_event_id: opts.eventId ?? null,
        sent_at: new Date().toISOString(),
      })
      if (ok) return { ok: true, viaApi: true }
    } catch {
      // falha na API → cai no fallback abaixo
    }
  }

  // Fallback: abre conversa no WhatsApp Web/App
  window.open(`https://wa.me/${fph ?? ''}?text=${encodeURIComponent(message)}`, '_blank')
  return { ok: true, viaApi: false }
}

export async function sendWA(
  houseId: string,
  type: string,
  phone: string,
  name: string,
  extra: Record<string, string> = {},
  clientId?: string | null,
  eventId?: string | null
) {
  const { supabase } = await import('../lib/supabase')
  const fph = fmtWAPhone(phone)
  if (!fph) return

  const { data: cfgData } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('house_id', houseId)
    .limit(1)
    .single()

  const cfg = cfgData
  if (!cfg?.active) return
  if (type === 'checkin_confirm' && !cfg.send_checkin_confirm) return
  if (type === 'birthday_wish' && !cfg.send_birthday_wish) return
  if (type === 'event_invite' && !cfg.send_event_invite) return

  const { data: tmplData } = await supabase
    .from('whatsapp_templates')
    .select('body')
    .eq('house_id', houseId)
    .eq('type', type)
    .eq('active', true)
    .limit(1)
    .single()

  if (!tmplData?.body) return

  let msg = tmplData.body.replaceAll('{{name}}', name ?? '')
  Object.entries(extra).forEach(([k, v]) => { msg = msg.replaceAll(`{{${k}}}`, v) })

  try {
    const resp = await fetch(`${cfg.api_url}/message/sendText/${cfg.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
      body: JSON.stringify({ number: fph, text: msg }),
    })
    const res = await resp.json()
    await supabase.from('whatsapp_logs').insert({
      house_id: houseId, recipient_phone: fph, recipient_name: name,
      message_type: type, message_body: msg,
      status: res?.key ? 'sent' : 'failed',
      error_msg: res?.key ? null : JSON.stringify(res),
      related_client_id: clientId ?? null,
      related_event_id: eventId ?? null,
      sent_at: new Date().toISOString(),
    })
  } catch (err: any) {
    await supabase.from('whatsapp_logs').insert({
      house_id: houseId, recipient_phone: fph, recipient_name: name,
      message_type: type, message_body: msg, status: 'failed',
      error_msg: err.message, related_client_id: clientId ?? null,
      related_event_id: eventId ?? null,
    })
  }
}
