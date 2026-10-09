import type { VercelRequest, VercelResponse } from '@vercel/node'
import { clientePublico, resolve, type Ev, type Casa } from './_preview-dados.js'

// Preview dos links públicos (WhatsApp/Facebook).
// Esses robôs NÃO rodam JavaScript: leem o HTML cru do servidor. Como o app monta tudo por JS,
// sem isso todo link caía na imagem genérica (o icon-512, um quadrado roxo vazio).
// Aqui buscamos o evento/casa pelo token e injetamos flyer do evento (ou logo da casa) no preview.
//
// Regra da imagem: flyer do evento (retangular → preview largo)
//                → logo da casa (quadrado → preview compacto, senão o WhatsApp corta as laterais)
//                → ícone padrão.

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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
      const { ev, casa, extra } = await resolve(clientePublico(token), type, token)
      // O card de 1200x630 e GERADO (api/preview-imagem). O flyer e um cartaz EM
      // PE; declarar 1200x630 para ele fazia o WhatsApp desistir do card grande e
      // mostrar so o link — era o que o convidado do promoter via. Gerando, a
      // medida declarada vira verdade, e o limite de ~600KB do robo deixa de
      // importar porque o JPEG sai leve.
      if (ev?.flyer_url || casa?.logo_url) {
        image = `${origin}/api/preview-imagem?type=${encodeURIComponent(type)}&token=${encodeURIComponent(token)}`
        wide = true
      }
      const t = textoDe(type, ev, casa, extra)
      title = t.title; desc = t.desc
    } catch { /* sem dados: mantém o preview genérico */ }
  }

  // Endereco PUBLICO do link (o robo vê /api/lista-preview por causa do rewrite).
  const CAMINHO: Record<string, string> = {
    lista: '/lista/', reserva: '/reserva/', confirmar: '/confirmar/', niver: '/niver/', evento: '/e/',
  }
  const urlPublica = `${origin}${CAMINHO[type] ?? '/lista/'}${token}`

  const metas = `
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(urlPublica)}" />
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
