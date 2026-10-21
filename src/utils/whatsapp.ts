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

/**
 * Numero em formato de WhatsApp brasileiro, ou null quando nao da para enviar.
 *
 * Antes isto aceitava quase tudo: 10 digitos viravam 55+10 (fixo, que nao tem
 * WhatsApp) e qualquer coisa com 14 ou 16 digitos passava inteira. O envio saia,
 * a API devolvia 400 e a tela dizia que tinha enviado. Na base ha
 * `55119999194804` (14) e `5511963984855362` (16) — numeros que nunca poderiam
 * funcionar.
 *
 * Celular no Brasil: DDD (2) + 9 + 8 digitos = 11, ou 13 com o 55 na frente.
 */
export function fmtWAPhone(phone: string): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length === 11) return '55' + d                      // DDD + 9 + 8 digitos
  if (d.length === 13 && d.startsWith('55')) return d       // o mesmo, ja com o pais
  // Dez digitos (sem o nono) parecem fixo, mas NAO sao descartados: no historico
  // desta casa quatro envios para numeros de 12 digitos chegaram. Sao celulares
  // antigos e WhatsApp Business em fixo. Quem decide e a API — e agora, quando ela
  // responde que o numero nao existe, a tela diz isso em vez de anunciar "enviado".
  if (d.length === 10) return '55' + d
  if (d.length === 12 && d.startsWith('55')) return d
  return null                                                // 9, 14, 15, 16, 18: impossivel
}

/**
 * Aviso para mostrar ao lado do campo de celular, no momento do CADASTRO.
 *
 * Avisar aqui vale mais do que avisar no envio: no cadastro a pessoa esta na
 * frente (ou ao telefone) e da para confirmar o numero. Depois, descobrir que a
 * mensagem nao chegou ja e tarde.
 *
 * Nunca BLOQUEIA: reserva com telefone fixo existe, e o numero serve para ligar
 * mesmo que nao receba WhatsApp.
 */
export function avisoDoTelefone(phone: string): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (!d) return null
  if (!fmtWAPhone(d)) {
    return d.length < 10
      ? 'Faltam dígitos — use DDD + número.'
      : 'Dígitos demais para um celular brasileiro — confira.'
  }
  if (d.length === 10 || (d.length === 12 && d.startsWith('55'))) {
    return 'Sem o nono dígito: pode não ter WhatsApp. Confirme com a pessoa.'
  }
  return null
}

/** Motivo pelo qual uma mensagem nao foi entregue. */
export type MotivoFalhaWA = 'numero_invalido' | 'sem_whatsapp' | 'api_falhou' | 'sem_api'

export const textoDaFalhaWA: Record<MotivoFalhaWA, string> = {
  numero_invalido: 'Número inválido para WhatsApp — confira o celular no cadastro (DDD + 9 dígitos).',
  sem_whatsapp: 'Este número não tem WhatsApp. Confirme o celular com a pessoa.',
  api_falhou: 'O WhatsApp da casa não respondeu. Abri a conversa para você enviar à mão.',
  sem_api: 'Envio automático desligado. Abri a conversa para você enviar à mão.',
}

/**
 * Traduz o resultado do envio para o aviso da tela.
 *
 * Existe porque as telas anunciavam "enviado" olhando so `viaApi`, e `viaApi`
 * era falso tanto quando NAO HA API quanto quando a API RECUSOU. Mensagem que
 * nunca saiu aparecia como enviada — 7 links de reserva em 30 dias nao chegaram
 * e ninguem ficou sabendo.
 */
export function avisoDoEnvioWA(
  r: { ok: boolean; viaApi: boolean; motivo?: MotivoFalhaWA },
  sucesso = '✅ Enviado pela API',
): { texto: string; tipo: 'success' | 'warn' | 'error' } {
  if (r.ok && r.viaApi) return { texto: sucesso, tipo: 'success' }
  if (r.motivo === 'numero_invalido') return { texto: textoDaFalhaWA.numero_invalido, tipo: 'error' }
  if (r.motivo === 'sem_whatsapp') return { texto: textoDaFalhaWA.sem_whatsapp, tipo: 'error' }
  if (r.motivo === 'api_falhou') return { texto: textoDaFalhaWA.api_falhou, tipo: 'warn' }
  return { texto: '📲 Abrindo WhatsApp…', tipo: 'success' }
}

/** A Evolution responde 400 com `exists:false` quando o numero nao tem WhatsApp. */
function naoTemWhatsApp(res: unknown): boolean {
  try {
    const msg = (res as { response?: { message?: Array<{ exists?: boolean }> } })?.response?.message
    return Array.isArray(msg) && msg.some(m => m?.exists === false)
  } catch { return false }
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
): Promise<{ ok: boolean; viaApi: boolean; motivo?: MotivoFalhaWA }> {
  const { supabase } = await import('../lib/supabase')
  const fph = fmtWAPhone(phone)

  // Numero que nunca vai funcionar: nao adianta tentar nem abrir conversa.
  if (!fph) return { ok: false, viaApi: false, motivo: 'numero_invalido' }

  const { data: cfg } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('house_id', houseId)
    .limit(1)
    .single()

  const useApi = !!(cfg?.active && cfg?.api_url && cfg?.instance_name && cfg?.api_key)
  // Guarda por que a API nao entregou, para o chamador poder dizer na tela em vez
  // de anunciar "enviado" sobre uma mensagem que nao saiu.
  let motivoApi: MotivoFalhaWA | undefined

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
      // Numero sem WhatsApp: abrir a conversa so mostraria "numero invalido" para
      // o operador. Melhor dizer o que houve — o cadastro e que precisa de ajuste.
      if (naoTemWhatsApp(res)) return { ok: false, viaApi: true, motivo: 'sem_whatsapp' }
      motivoApi = 'api_falhou'
    } catch {
      motivoApi = 'api_falhou'
    }
  }

  // Notificação em segundo plano (silent): não abre aba wa.me se a API falhar/estiver inativa
  if (opts.silent) return { ok: false, viaApi: false, motivo: motivoApi ?? 'sem_api' }
  // Fallback: abre conversa no WhatsApp Web/App
  window.open(`https://wa.me/${fph}?text=${encodeURIComponent(message)}`, '_blank')
  return { ok: true, viaApi: false, motivo: motivoApi ?? 'sem_api' }
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
