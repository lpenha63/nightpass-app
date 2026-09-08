#!/usr/bin/env node
/**
 * Confere se as consultas das PÁGINAS PÚBLICAS continuam permitidas ao anônimo.
 *
 * Existe porque `npm run smoke` só prova que as rotas de servidor respondem, e numa
 * SPA o HTTP 200 não prova nada: a casca abre igual. Em 08/09 a página da lista de
 * promoter respondia 200 dizendo "Lista não encontrada", na noite do evento — uma
 * coluna negada ao anônimo derrubava a consulta inteira, e só descobrimos quando
 * alguém tentou usar o link.
 *
 * COMO FUNCIONA, e por que não precisa de token real nem de navegador:
 *
 *   Consulta com token inexistente e colunas permitidas  ->  []
 *   Consulta com QUALQUER coluna negada                  ->  permission denied
 *
 * A falha que nos interessa aparece como ERRO, não como vazio. Então basta rodar a
 * consulta de cada página com um token falso e olhar o tipo da resposta. Um `[]` é
 * aprovação: significa que a permissão está inteira e só não houve correspondência.
 *
 * Uso:  node smoke-paginas.js
 */

import { readFileSync, existsSync } from 'fs'

// A chave anônima é pública por natureza — vai embutida em toda página do app.
// Lida daqui para o teste usar exatamente a mesma que o visitante usa.
function doArquivo(arquivo, regex) {
  if (!existsSync(arquivo)) return ''
  return (readFileSync(arquivo, 'utf8').match(regex) ?? [])[1] ?? ''
}

const URL_SB = process.env.SUPABASE_URL
  || doArquivo('agenda.html', /createClient\('(https:\/\/[a-z0-9]+\.supabase\.co)'/)
const ANON = process.env.VITE_SUPABASE_ANON_KEY
  || doArquivo('agenda.html', /(eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9._-]+)/)

if (!URL_SB || !ANON) {
  console.error('Não encontrei a URL do Supabase ou a chave anônima em agenda.html.')
  process.exit(2)
}

const FALSO = '00000000-0000-0000-0000-000000000000'

// Colunas de `events` que cada página pública pede. É aqui que a lista branca do
// anônimo é exercitada: acrescentou coluna na página? Acrescente aqui também.
const COLS_COMPRA = [
  'id', 'created_at', 'updated_at', 'house_id', 'name', 'event_date', 'start_time',
  'end_time', 'genre', 'flyer_url', 'capacity', 'status', 'price_male_cents',
  'price_female_cents', 'price_male_list_cents', 'price_female_list_cents',
  'price_male_list_early_cents', 'price_female_list_early_cents', 'list_cutoff_time',
  'promotions', 'promotions_list', 'attractions', 'artists_public',
  'house_list_enabled', 'birthday_list_enabled', 'is_operation',
].join(',')

const COLS_LISTA = [
  'name', 'event_date', 'start_time', 'flyer_url', 'price_male_cents',
  'price_female_cents', 'price_male_list_cents', 'price_female_list_cents',
  'artists_public', 'promotions', 'promotions_list', 'list_locks',
  'house_list_enabled', 'promoter_enabled', 'promoter_invites',
].join(',')

const CHECAGENS = [
  {
    pagina: '/ingresso/…',
    o_que: 'ingresso emitido',
    rpc: 'get_ticket_by_token',
    args: { p_token: FALSO },
  },
  {
    pagina: '/reserva/…',
    o_que: 'reserva do cliente',
    path: `/reservations?select=id,name,people_count,reservation_guests(id)&token=eq.${FALSO}`,
    token: FALSO,
  },
  {
    pagina: '/lista/…',
    o_que: 'lista de promoter (com o embed de events)',
    path: `/promoter_lists?select=*,promoters(full_name,photo_url),events(${COLS_LISTA}),houses(name,logo_url)&token=eq.${FALSO}`,
    token: FALSO,
  },
  {
    pagina: '/e/…',
    o_que: 'página de compra de ingresso',
    path: `/events?select=${COLS_COMPRA},houses(name,pix_key,pix_holder)&id=eq.${FALSO}`,
  },
  {
    pagina: '/e/… (lotes)',
    o_que: 'lotes à venda',
    path: `/ticket_batches?select=*&event_id=eq.${FALSO}`,
  },
  {
    pagina: 'lista.html',
    o_que: 'lista da casa (página estática)',
    path: `/events?select=name,list_locks,flyer_url,attractions,artists_public,start_time,price_male_list_cents,price_female_list_cents&id=eq.${FALSO}`,
  },
  {
    pagina: '/agenda.html',
    o_que: 'agenda da equipe',
    rpc: 'freelancer_agenda',
    args: { p_token: FALSO },
  },
]

async function roda(c) {
  const cab = { apikey: ANON, Authorization: `Bearer ${ANON}` }
  if (c.token) cab['x-np-token'] = c.token

  const r = c.rpc
    ? await fetch(`${URL_SB}/rest/v1/rpc/${c.rpc}`, {
        method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify(c.args),
      })
    : await fetch(`${URL_SB}/rest/v1${c.path}`, { headers: cab })

  const corpo = await r.json().catch(() => null)
  const msg = typeof corpo?.message === 'string' ? corpo.message : ''

  // `[]` ou null com HTTP 2xx = permissão inteira, só não houve correspondência.
  // É a resposta que queremos: prova o acesso sem depender de dado real.
  if (r.status < 400) return { ok: true }

  return {
    ok: false,
    motivo: /permission denied/i.test(msg) ? `PERMISSÃO NEGADA — ${msg}`
      : /column .* does not exist/i.test(msg) ? `COLUNA INEXISTENTE — ${msg}`
      : `HTTP ${r.status} — ${msg || 'sem mensagem'}`,
  }
}

const resultados = await Promise.all(CHECAGENS.map(async c => ({ c, r: await roda(c) })))

console.log('')
let falhou = false
for (const { c, r } of resultados) {
  if (!r.ok) falhou = true
  console.log(`  ${r.ok ? 'ok   ' : 'FALHA'} ${c.pagina.padEnd(16)} ${c.o_que}`)
  if (!r.ok) console.log(`        └─ ${r.motivo}`)
}

console.log(falhou
  ? '\nAlguma página pública perdeu acesso aos dados dela. Confira a permissão da coluna citada.'
  : '\nTodas as consultas das páginas públicas continuam permitidas.')
process.exit(falhou ? 1 : 0)
