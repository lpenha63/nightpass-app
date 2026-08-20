// Estado da conexão da instância (Evolution API). 'down' = servidor fora do ar / não encontrado.
export type WAConnState = 'open' | 'connecting' | 'close' | 'down'
export async function waConnectionState(cfg?: { api_url?: string; instance_name?: string; api_key?: string } | null): Promise<WAConnState> {
  if (!cfg?.api_url || !cfg.instance_name || !cfg.api_key) return 'down'
  try {
    const r = await fetch(`${cfg.api_url}/instance/connectionState/${cfg.instance_name}`, { headers: { apikey: cfg.api_key } })
    if (!r.ok) return 'down'
    const j = await r.json().catch(() => null)
    const state = j?.instance?.state ?? j?.state
    return state === 'open' ? 'open' : state === 'connecting' ? 'connecting' : 'close'
  } catch {
    return 'down'
  }
}
// Mensagem amigável para cada estado de conexão indisponível.
export function waStateMessage(s: WAConnState): string {
  if (s === 'down') return 'Servidor do WhatsApp fora do ar. Reative a Evolution API (ou atualize a URL) em Configurações → WhatsApp.'
  if (s === 'connecting') return 'WhatsApp ainda conectando. Aguarde alguns segundos e tente de novo.'
  return 'WhatsApp desconectado. Reconecte a instância (escaneie o QR) em Configurações → WhatsApp.'
}

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
  opts: { mediaUrl?: string; clientId?: string | null; eventId?: string | null; type?: string; silent?: boolean } = {}
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
        : { number: fph, text: message, linkPreview: true }
      const resp = await fetch(`${cfg.api_url}/message/${useMedia ? 'sendMedia' : 'sendText'}/${cfg.instance_name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.api_key },
        body: JSON.stringify(body),
      })
      const res = await resp.json()
      const ok = !!(res?.key || res?.status === 'success' || res?.status === 'PENDING')
      // O log é registro, não parte do envio. Se ele falhar (constraint, RLS, rede) a
      // mensagem JÁ foi entregue — deixar a exceção subir jogava o fluxo no fallback
      // wa.me e o destinatário recebia duas vezes.
      try {
        await supabase.from('whatsapp_logs').insert({
          house_id: houseId, recipient_phone: fph, message_type: opts.type ?? 'direct',
          message_body: message, status: ok ? 'sent' : 'failed',
          error_msg: ok ? null : JSON.stringify(res),
          related_client_id: opts.clientId ?? null, related_event_id: opts.eventId ?? null,
          sent_at: new Date().toISOString(),
        })
      } catch (e) { console.error('whatsapp_logs:', e) }
      if (ok) return { ok: true, viaApi: true }
    } catch {
      // falha na API → cai no fallback abaixo
    }
  }

  // Notificação em segundo plano (silent): não abre aba wa.me se a API falhar/estiver inativa
  if (opts.silent) return { ok: false, viaApi: false }
  // Fallback: abre conversa no WhatsApp Web/App
  window.open(`https://wa.me/${fph ?? ''}?text=${encodeURIComponent(message)}`, '_blank')
  return { ok: true, viaApi: false }
}

/**
 * Notifica o colaborador no WhatsApp que recebeu uma nova tarefa (com link da agenda dele).
 * Segundo plano: se a API estiver fora, não faz nada (não abre aba). Passe o freelancerId
 * para gerar/obter o token da agenda via RPC.
 */
export async function notifyTaskAssigned(
  houseId: string, houseName: string, freelancerId: string, title: string,
  extra: { eventName?: string | null; deadline?: string | null } = {}
): Promise<void> {
  if (!freelancerId || !title) return
  const { supabase } = await import('../lib/supabase')
  const { data } = await supabase.rpc('ensure_agenda_token', { p_freelancer: freelancerId })
  const info = data as { token?: string; phone?: string; name?: string } | null
  if (!info?.phone) return
  const link = info.token
    ? `${window.location.origin}/agenda.html?t=${info.token}`
    : window.location.origin
  const lines = [`📋 *Nova tarefa em ${houseName}*`, '', `✅ ${title}`]
  if (extra.eventName) lines.push(`🎉 ${extra.eventName}`)
  if (extra.deadline) lines.push(`⏰ ${new Date(extra.deadline).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`)
  lines.push('', 'Veja e conclua na sua agenda:', link)
  await sendWADirect(houseId, info.phone, lines.join('\n'), { type: 'task_assigned', silent: true })
  // Aviso no celular (push) — complementa o WhatsApp; silencioso se o colaborador não ativou
  try {
    const { data: sess } = await supabase.auth.getSession()
    const jwt = sess?.session?.access_token
    if (jwt) {
      supabase.functions.invoke('push-send', {
        body: { jwt, assignee_id: freelancerId, title: '📋 Nova tarefa', body: title, url: '/agenda.html' },
      })
    }
  } catch { /* push é best-effort */ }
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
