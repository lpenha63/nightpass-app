import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Preview dos links públicos (WhatsApp/Facebook).
// Esses robôs NÃO rodam JavaScript: leem o HTML cru do servidor. Como o app monta tudo por JS,
// sem isso todo link caía na imagem genérica (o icon-512, um quadrado roxo vazio).
// Aqui buscamos o evento/casa pelo token e injetamos flyer do evento (ou logo da casa) no preview.
//
// Regra da imagem: flyer do evento (retangular → preview largo)
//                → logo da casa (quadrado → preview compacto, senão o WhatsApp corta as laterais)
//                → ícone padrão.

const SB_URL = process.env.SUPABASE_URL ?? 'https://irghwfzcbazujddfftsx.supabase.co'
const SB_ANON = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyZ2h3ZnpjYmF6dWpkZGZmdHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjI4OTAsImV4cCI6MjA4ODEzODg5MH0.CMrdK4-7rWbgYcqttWtGF1CIWjywL0KVxYCBx27emhw'

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface Ev { name?: string; event_date?: string; start_time?: string; flyer_url?: string }
interface Casa { name?: string; logo_url?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any
type Row = Record<string, unknown> | null

// Cada tipo de link resolve para o mesmo par (evento, casa)
async function resolve(sb: SB, type: string, token: string): Promise<{ ev: Ev | null; casa: Casa | null; extra?: string }> {
  const evSel = 'events(name,event_date,start_time,flyer_url),houses(name,logo_url)'
  const pick = (d: Row) => ({
    ev: (d?.events ?? null) as Ev | null,
    casa: (d?.houses ?? null) as Casa | null,
  })
  const txt = (d: Row, key: string) => (d?.[key] as string) || undefined

  if (type === 'lista') {
    const { data } = await sb.from('promoter_lists').select(evSel).eq('token', token).single()
    return pick(data as Row)
  }
  if (type === 'reserva') {
    const { data } = await sb.from('reservations').select(`name,${evSel}`).eq('token', token).single()
    return { ...pick(data as Row), extra: txt(data as Row, 'name') }
  }
  if (type === 'confirmar') {
    const { data } = await sb.from('promoter_list_guests').select(`full_name,${evSel}`).eq('invite_token', token).single()
    return { ...pick(data as Row), extra: txt(data as Row, 'full_name') }
  }
  if (type === 'niver') {
    const { data } = await sb.from('birthday_lists').select(`birthday_person_name,${evSel}`).eq('token', token).single()
    return { ...pick(data as Row), extra: txt(data as Row, 'birthday_person_name') }
  }
  if (type === 'evento') {
    const { data } = await sb.from('events').select('name,event_date,start_time,flyer_url,houses(name,logo_url)').eq('id', token).single()
    const d = data as Row
    return { ev: (d ?? null) as Ev | null, casa: (d?.houses ?? null) as Casa | null }
  }
  return { ev: null, casa: null }
}

function textoDe(type: string, ev: Ev | null, casa: Casa | null, extra?: string) {
  const data = ev?.event_date ? new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''
  const hora = ev?.start_time ? ` às ${ev.start_time.slice(0, 5)}` : ''
  const quando = data ? `${data}${hora}` : ''
  const onde = casa?.name ? ` · ${casa.name}` : ''
  const nome = ev?.name

  if (!nome) return { title: 'NightPass', desc: 'Toque para abrir.' }

  switch (type) {
    case 'reserva':
      return { title: `Reserva — ${nome}`, desc: `${quando}${onde} — confirme os convidados da sua reserva. 🪑` }
    case 'confirmar':
      return { title: nome, desc: `${extra ? `${extra}, c` : 'C'}onfirme sua presença com 1 clique. ${quando}${onde} 🎉` }
    case 'niver':
      return { title: `Aniversário de ${extra ?? ''} — ${nome}`.trim(), desc: `${quando}${onde} — monte a lista de convidados. 🎂` }
    case 'evento':
      return { title: `${nome} — NightPass Tickets`, desc: `${quando}${onde} — compre seu ingresso com segurança. 🎫` }
    default: // lista
      return { title: nome, desc: `${quando}${onde} — entre na lista e garanta sua entrada. 🎉` }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '')
  const type = String(req.query.type ?? 'lista')
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host) as string
  const origin = `https://${host}`

  // HTML base do app — o SPA continua funcionando normalmente na mesma URL
  let html = ''
  try {
    html = await (await fetch(`${origin}/index-src.html`)).text()
  } catch {
    return res.redirect(302, '/index-src.html')
  }

  let title = 'NightPass — Confirme sua presença'
  let desc = 'Toque para confirmar sua presença e garantir sua entrada. 🎉'
  let image = `${origin}/icon-512.png`
  let wide = false

  if (token) {
    try {
      // O RLS dessas tabelas passou a exigir o token no cabeçalho (x-np-token).
      // Sem isto a prévia voltaria a cair na imagem genérica.
      const sb = createClient(SB_URL, SB_ANON, {
        global: { headers: { 'x-np-token': token } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { ev, casa, extra } = await resolve(sb, type, token)
      // O robô do WhatsApp descarta imagem grande (~600KB) e o preview fica SEM foto.
      // Se o flyer estourar o limite, cai no logo da casa (melhor que nada).
      const cabeNoPreview = async (url: string) => {
        try {
          const r = await fetch(url, { method: 'HEAD' })
          const len = Number(r.headers.get('content-length') ?? 0)
          return r.ok && len > 0 && len <= 600 * 1024
        } catch { return false }
      }
      if (ev?.flyer_url && await cabeNoPreview(ev.flyer_url)) { image = ev.flyer_url; wide = true }
      else if (casa?.logo_url) { image = casa.logo_url; wide = false }
      else if (ev?.flyer_url) { image = ev.flyer_url; wide = true } // sem logo: tenta o flyer mesmo assim
      const t = textoDe(type, ev, casa, extra)
      title = t.title; desc = t.desc
    } catch { /* sem dados: mantém o preview genérico */ }
  }

  const metas = `
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="NightPass" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:image:width" content="${wide ? 1200 : 512}" />
    <meta property="og:image:height" content="${wide ? 630 : 512}" />
    <meta property="og:locale" content="pt_BR" />
    <meta name="twitter:card" content="${wide ? 'summary_large_image' : 'summary'}" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <meta name="twitter:image" content="${esc(image)}" />`

  html = html
    .replace(/\s*<meta property="og:[^>]*>/g, '')
    .replace(/\s*<meta name="twitter:[^>]*>/g, '')
    .replace('</head>', `${metas}\n  </head>`)

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600')
  return res.status(200).send(html)
}
