import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

/**
 * Manifest do app instalado, por casa.
 *
 * Dois motivos para ser rota e nao arquivo:
 *
 * 1. O nome e o icone dependem da casa, e o NightPass atende varias. Um
 *    .webmanifest estatico so consegue falar de uma.
 * 2. O portal do promoter montava o manifest em tempo de execucao e servia como
 *    `blob:`. A URL de blob muda a cada carregamento, entao o navegador nao
 *    reconhece o app instalado como o mesmo — instalacao instavel e atalho
 *    duplicado. Era o mesmo defeito ja corrigido na agenda da equipe.
 *
 * `id` e o que identifica a instalacao. Fica FIXO por app (nao inclui a casa):
 * trocar a logo ou o nome da casa nao pode transformar o app num app novo.
 */

const SB_URL = process.env.SUPABASE_URL ?? 'https://irghwfzcbazujddfftsx.supabase.co'
const SB_ANON = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyZ2h3ZnpjYmF6dWpkZGZmdHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjI4OTAsImV4cCI6MjA4ODEzODg5MH0.CMrdK4-7rWbgYcqttWtGF1CIWjywL0KVxYCBx27emhw'

const APPS = {
  agenda: {
    id: '/agenda.html',
    inicioPadrao: '/agenda.html',
    nome: 'Minha Agenda',
    descricao: 'Agenda, tarefas e ponto da equipe',
    tema: '#7c3aed',
    fundo: '#0a0a0f',
  },
  promoter: {
    id: '/promoter/',
    inicioPadrao: '/',
    nome: 'Portal do Promoter',
    descricao: 'Suas listas e convidados',
    tema: '#ec4899',
    fundo: '#0a0e1a',
  },
} as const
type AppId = keyof typeof APPS

/**
 * `start_url` so pode ser um caminho deste site. Sem esta checagem, qualquer um
 * montaria um manifest nosso apontando para fora — o app instalado com a cara da
 * casa abriria o site de outra pessoa.
 */
function caminhoSeguro(v: string): string | null {
  if (!v.startsWith('/') || v.startsWith('//')) return null
  if (!/^\/[A-Za-z0-9\-._~/]*$/.test(v)) return null
  return v
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const appId = String(req.query.app ?? '') as AppId
  const app = APPS[appId]
  if (!app) return res.status(400).json({ error: 'app inválido' })

  const casa = String(req.query.casa ?? '').trim()
  const casaOk = /^[0-9a-f-]{36}$/i.test(casa)

  const pedido = String(req.query.inicio ?? '').trim()
  const inicio = (pedido && caminhoSeguro(pedido)) || app.inicioPadrao

  let nomeCasa = ''
  if (casaOk) {
    try {
      const sb = createClient(SB_URL, SB_ANON)
      const { data } = await sb.from('houses').select('name').eq('id', casa).maybeSingle()
      nomeCasa = ((data as { name?: string } | null)?.name ?? '').trim()
    } catch { nomeCasa = '' }
  }

  // "Vila Beats — Agenda" diz de quem e o app. Sem a casa, o nome generico serve.
  const nome = nomeCasa ? `${nomeCasa} — ${app.nome}` : `${app.nome} — NightPass`
  const icone = (size: number) =>
    `/api/icone?app=${appId}&size=${size}${casaOk ? `&casa=${casa}` : ''}`

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800')
  return res.status(200).json({
    id: appId === 'promoter' ? inicio : app.id,
    name: nome,
    short_name: nomeCasa || app.nome,
    description: app.descricao,
    start_url: inicio,
    scope: inicio,
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: app.fundo,
    theme_color: app.tema,
    lang: 'pt-BR',
    icons: [
      { src: icone(192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icone(512), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    prefer_related_applications: false,
  })
}
