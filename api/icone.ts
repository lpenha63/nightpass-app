import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

/**
 * Icone do app instalado: a logo DA CASA, dentro de um anel colorido, com o nome
 * do app escrito embaixo.
 *
 * Existe porque os tres apps instalaveis (admin, agenda da equipe e portal do
 * promoter) dividiam os mesmos dois PNGs do projeto: tres atalhos identicos no
 * celular. E como o NightPass atende varias casas, a logo certa nao cabe num
 * arquivo estatico — ela vive no banco, uma por estabelecimento.
 *
 * A logo sozinha nao resolveria: equipe e promoter da MESMA casa ficariam iguais.
 * Dai o anel colorido (uma cor por app) e a faixa com o nome.
 *
 * Anel, e nao placa de fundo: a logo da casa costuma trazer o proprio fundo
 * embutido (a da Vila Beats e um quadrado preto). Logo com fundo proprio sobre
 * placa colorida vira um quadrado boiando. A placa usa a cor DOMINANTE da logo,
 * entao a borda dela some no fundo.
 *
 * ROTULOS EM PNG, e nao texto SVG: a Vercel nao tem fonte instalada. Texto SVG
 * sai como quadradinho vazio (tofu) — foi exatamente o que aconteceu com a versao
 * anterior deste arquivo, em producao. O projeto ja sabia disso: veja o comentario
 * "Letra N vetorizada (sem depender de fonte instalada)" em icon.svg. Os rotulos
 * sao rasterizados na maquina de desenvolvimento por scripts/gerar-rotulos-icone.cjs
 * e embutidos aqui em base64, o que deixa o runtime independente de fonte.
 *
 * Geometria (viewBox 512, depois reduzido para o tamanho pedido): tudo fica dentro
 * da zona segura do maskable (raio 205), porque o Android recorta o icone em
 * circulo. Os cantos da logo podem ser aparados — nao ha conteudo neles.
 */

const SB_URL = process.env.SUPABASE_URL ?? 'https://irghwfzcbazujddfftsx.supabase.co'
const SB_ANON = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyZ2h3ZnpjYmF6dWpkZGZmdHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjI4OTAsImV4cCI6MjA4ODEzODg5MH0.CMrdK4-7rWbgYcqttWtGF1CIWjywL0KVxYCBx27emhw'

/**
 * Uma cor por app. `anel` e o tom claro (destaca na tela inicial) e `faixa` o
 * escuro — o branco sobre o tom claro dava 3,5:1, baixo demais para ler; sobre o
 * escuro da 6:1.
 */
const APPS = {
  agenda:   { anel: '#a78bfa', faixa: '#7c3aed', grad: '#a78bfa' },
  promoter: { anel: '#ec4899', faixa: '#be185d', grad: '#ec4899' },
  admin:    { anel: '#818cf8', faixa: '#4f46e5', grad: '#818cf8' },
} as const
type AppId = keyof typeof APPS

/** Rotulos brancos sobre transparente, 480px de largura. Ver cabecalho. */
const ROTULOS: Record<AppId, string> = {
  agenda: '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',
  promoter: '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',
  admin: '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',
}

const LADO = 512
const TAMANHOS = new Set([192, 512])

const svg = (s: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${LADO}" height="${LADO}">${s}</svg>`)

/** Reduz o rotulo para caber na caixa. Nunca amplia: o PNG tem 480 de largura. */
const rotulo = (app: AppId, w: number, h: number) =>
  sharp(Buffer.from(ROTULOS[app], 'base64')).resize({ width: w, height: h, fit: 'inside' }).png().toBuffer()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const casa = String(req.query.casa ?? '').trim()
  const appId = String(req.query.app ?? 'admin') as AppId
  const pedido = parseInt(String(req.query.size ?? LADO), 10)
  const lado = TAMANHOS.has(pedido) ? pedido : LADO

  const cor = APPS[appId]
  if (!cor) return res.status(400).json({ error: 'app inválido' })

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
      logo = null   // logo fora do ar nao derruba o icone
    }
  }

  let png: Buffer
  if (logo) {
    const { dominant } = await sharp(logo).stats()
    const marca = await sharp(logo).resize(230, 230, { fit: 'inside' }).png().toBuffer()
    const texto = await rotulo(appId, 236, 40)
    const m = await sharp(texto).metadata()
    const enfeite = svg(
      `<circle cx="256" cy="256" r="228" fill="none" stroke="${cor.anel}" stroke-width="26"/>
       <rect x="120" y="338" width="272" height="56" rx="28" fill="${cor.faixa}"/>`)
    png = await sharp({
      create: { width: LADO, height: LADO, channels: 4, background: { ...dominant, alpha: 1 } },
    }).composite([
      { input: marca, top: 83, left: 141 },
      { input: enfeite, top: 0, left: 0 },
      { input: texto, top: 366 - Math.round((m.height ?? 0) / 2), left: 256 - Math.round((m.width ?? 0) / 2) },
    ]).png().toBuffer()
  } else {
    // Casa sem logo: so o nome do app sobre a cor dele. Generico, mas ainda
    // diferente entre os apps — que era o problema original.
    const texto = await rotulo(appId, 330, 90)
    const m = await sharp(texto).metadata()
    const fundo = svg(
      `<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
         <stop offset="0%" stop-color="${cor.faixa}"/><stop offset="100%" stop-color="${cor.grad}"/>
       </linearGradient></defs><rect width="512" height="512" fill="url(#g)"/>`)
    png = await sharp(fundo).composite([
      { input: texto, top: 256 - Math.round((m.height ?? 0) / 2), left: 256 - Math.round((m.width ?? 0) / 2) },
    ]).png().toBuffer()
  }

  if (lado !== LADO) png = await sharp(png).resize(lado, lado).png().toBuffer()

  res.setHeader('Content-Type', 'image/png')
  // Muda quando a casa troca a logo — revalidacao, nao imutavel.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800')
  return res.status(200).send(png)
}
