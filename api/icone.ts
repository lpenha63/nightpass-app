import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

/**
 * Icone do app instalado, montado a partir da logo DA CASA.
 *
 * Existe porque os tres apps instalaveis (admin, agenda da equipe e portal do
 * promoter) dividiam os mesmos dois PNGs do projeto: no celular, tres atalhos
 * identicos. E como o NightPass atende varias casas, a logo certa nao cabe num
 * arquivo estatico — ela vive no banco, uma por estabelecimento.
 *
 * A logo sozinha tambem nao resolveria: equipe e promoter da MESMA casa teriam
 * icones iguais. Por isso a logo vai dentro de um ANEL colorido, uma cor por app.
 *
 * O anel e nao uma placa de fundo porque a logo da casa costuma trazer o proprio
 * fundo embutido (a da Vila Beats e um quadrado preto). Logo com fundo proprio
 * sobre uma placa colorida vira um quadrado boiando; dentro de um anel, nao.
 *
 * Maskable: o Android recorta o icone em circulo. O anel fica em r=228 de 256,
 * dentro da zona segura, e a logo ocupa 72% do lado.
 */

const SB_URL = process.env.SUPABASE_URL ?? 'https://irghwfzcbazujddfftsx.supabase.co'
const SB_ANON = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyZ2h3ZnpjYmF6dWpkZGZmdHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjI4OTAsImV4cCI6MjA4ODEzODg5MH0.CMrdK4-7rWbgYcqttWtGF1CIWjywL0KVxYCBx27emhw'

/** Uma cor por app: e o que separa a agenda do promoter quando a logo e a mesma. */
const APPS = {
  agenda:   { anel: '#a78bfa', de: '#7c3aed', para: '#a78bfa', letra: 'A' },
  promoter: { anel: '#ec4899', de: '#be185d', para: '#ec4899', letra: 'P' },
  admin:    { anel: '#818cf8', de: '#4f46e5', para: '#818cf8', letra: 'N' },
} as const
type AppId = keyof typeof APPS

const TAMANHOS = new Set([192, 512])
const svg = (s: string, lado: number) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${lado}" height="${lado}">${s}</svg>`)

const anelSvg = (cor: string, lado: number) =>
  svg(`<circle cx="256" cy="256" r="228" fill="none" stroke="${cor}" stroke-width="26"/>`, lado)

/** Sem logo cadastrada: a letra do app sobre a cor dele. Melhor um icone generico
 *  e correto do que tres atalhos identicos. */
const letraSvg = (app: AppId, lado: number) =>
  svg(`<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
         <stop offset="0%" stop-color="${APPS[app].de}"/>
         <stop offset="100%" stop-color="${APPS[app].para}"/>
       </linearGradient></defs>
       <rect width="512" height="512" fill="url(#g)"/>
       <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
             font-family="Helvetica,Arial,sans-serif" font-weight="bold"
             font-size="250" fill="#ffffff">${APPS[app].letra}</text>`, lado)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const casa = String(req.query.casa ?? '').trim()
  const appId = String(req.query.app ?? 'admin') as AppId
  const pedido = parseInt(String(req.query.size ?? 512), 10)
  const lado = TAMANHOS.has(pedido) ? pedido : 512

  if (!APPS[appId]) return res.status(400).json({ error: 'app inválido' })

  let logo: Buffer | null = null
  if (/^[0-9a-f-]{36}$/i.test(casa)) {
    try {
      const sb = createClient(SB_URL, SB_ANON)
      const { data } = await sb.from('houses').select('logo_url').eq('id', casa).maybeSingle()
      const url = (data as { logo_url?: string } | null)?.logo_url
      if (url) {
        const r = await fetch(url)
        if (r.ok) logo = Buffer.from(await r.arrayBuffer())
      }
    } catch {
      logo = null   // logo indisponivel nao derruba o icone: cai na letra
    }
  }

  let png: Buffer
  if (logo) {
    // A placa usa a cor dominante da propria logo: assim a borda dela some no
    // fundo, em vez de aparecer um quadrado recortado no meio do icone.
    const { dominant } = await sharp(logo).stats()
    const dentro = Math.round(lado * 0.72)
    const camada = await sharp(logo).resize(dentro, dentro, { fit: 'inside' }).png().toBuffer()
    png = await sharp({
      create: { width: lado, height: lado, channels: 4, background: { ...dominant, alpha: 1 } },
    })
      .composite([{ input: camada, gravity: 'center' }, { input: anelSvg(APPS[appId].anel, lado), gravity: 'center' }])
      .png().toBuffer()
  } else {
    png = await sharp(letraSvg(appId, lado)).png().toBuffer()
  }

  res.setHeader('Content-Type', 'image/png')
  // Muda quando a casa troca a logo — por isso revalidacao, nao imutavel.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800')
  return res.status(200).send(png)
}
