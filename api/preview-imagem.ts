import type { VercelRequest, VercelResponse } from '@vercel/node'
import sharp from 'sharp'
import { clientePublico, resolve } from './_preview-dados.js'

/**
 * Imagem do card que o WhatsApp mostra quando alguem manda um link do sistema.
 *
 * O problema que resolve: o flyer de evento e um CARTAZ EM PE (o da casa mede
 * 1024x1536), e a previa declarava 1200x630 — proporcao de imagem deitada. O
 * WhatsApp usa a medida declarada para montar o card; recebendo uma proporcao
 * que nao bate, ele desiste do card grande e mostra so o link. Era o que o
 * convidado do promoter via.
 *
 * Em vez de declarar uma medida falsa, aqui a imagem de 1200x630 e CONSTRUIDA:
 * o flyer desfocado preenche o fundo e o flyer inteiro vai na frente. Nada e
 * cortado, a proporcao declarada vira verdade, e o card grande aparece.
 *
 * Sem texto desenhado de proposito: a Vercel nao tem fonte instalada (texto SVG
 * sai como quadradinho vazio) e o nome do evento e dinamico, entao nao da para
 * rasterizar antes. O WhatsApp ja escreve titulo e descricao ao lado da imagem —
 * eles vem das tags og: da previa.
 */

/**
 * Dois formatos a partir da mesma montagem:
 *   card   1200x630   previa de link (WhatsApp, Facebook)
 *   story  1080x1920  o que o promoter posta no Instagram
 *
 * O story existe porque o flyer cru, postado direto, aparece com tarja ou cortado:
 * cartaz e 2:3 e o story e 9:16. Aqui ele entra inteiro, com o fundo desfocado
 * preenchendo o resto.
 */
const FORMATOS = {
  card:  { l: 1200, a: 630 },
  story: { l: 1080, a: 1920 },
} as const
type Formato = keyof typeof FORMATOS

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token ?? '')
  const type = String(req.query.type ?? 'lista')
  const fmt = (String(req.query.formato ?? 'card') as Formato)
  const { l: L, a: A } = FORMATOS[fmt] ?? FORMATOS.card
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host) as string

  let fonte: Buffer | null = null
  let ehFlyer = false
  try {
    const { ev, casa } = await resolve(clientePublico(token), type, token)
    const url = ev?.flyer_url || casa?.logo_url
    ehFlyer = !!ev?.flyer_url
    if (url) {
      const r = await fetch(url)
      if (r.ok) fonte = Buffer.from(await r.arrayBuffer())
    }
  } catch { fonte = null }

  // Sem flyer nem logo: devolve o icone do app, que ja existe e e valido.
  if (!fonte) return res.redirect(302, `https://${host}/icon-512.png`)

  let jpeg: Buffer
  try {
    // Fundo: a propria imagem, ampliada, desfocada e escurecida. Preenche os
    // lados vazios que um cartaz em pe deixa num card deitado.
    const fundo = await sharp(fonte)
      .resize(L, A, { fit: 'cover' })
      .blur(28)
      .modulate({ brightness: 0.45 })
      .toBuffer()

    // Frente: a imagem inteira, sem corte. Margem de 20px em cima e embaixo.
    // Margem maior no story: o Instagram cobre topo e rodape com a interface dele.
    const margem = fmt === 'story' ? 320 : 40
    const frente = await sharp(fonte)
      .resize({ width: L - 40, height: A - margem, fit: 'inside' })
      .toBuffer()

    jpeg = await sharp(fundo)
      .composite([{ input: frente, gravity: 'center' }])
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
  } catch {
    return res.redirect(302, `https://${host}/icon-512.png`)
  }

  res.setHeader('Content-Type', 'image/jpeg')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800')
  res.setHeader('X-Origem', ehFlyer ? 'flyer' : 'logo')
  return res.status(200).send(jpeg)
}
