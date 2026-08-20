import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Converte o endereço da casa em coordenadas (geocodificação).
//
// Roda no servidor porque o Nominatim não envia cabeçalho CORS e sua política de uso
// exige um User-Agent identificando a aplicação. Usa OpenStreetMap: gratuito e sem
// cadastro, então casa nova nenhuma precisa criar conta ou cartão para configurar
// o ponto da equipe.
//
// A ordem das tentativas veio de teste com endereços reais:
//  1) nome da casa + endereço → acerta o próprio estabelecimento (mais preciso)
//  2) consulta estruturada com número
//  3) busca livre do endereço → costuma cair em ponto de ônibus da via (~400m de erro)
//  4) só a via, sem número → aproximado, último recurso
// Endereço abreviado ("Av." em vez de "Avenida Doutor") faz a estruturada falhar,
// por isso a busca livre existe como rede de segurança.

interface Achado { lat: number; lng: number; rotulo: string; tipo: string }

const UA = 'NightPass/1.0 (app de gestao de casas noturnas)'

async function nominatim(params: Record<string, string>): Promise<Achado[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '5')
  url.searchParams.set('countrycodes', 'br')

  const r = await fetch(url.toString(), { headers: { 'User-Agent': UA } })
  if (!r.ok) return []
  const body = await r.json().catch(() => null)
  if (!Array.isArray(body)) return []
  return body
    .map((x: { lat: string; lon: string; display_name: string; type?: string }) => ({
      lat: parseFloat(x.lat), lng: parseFloat(x.lon),
      rotulo: x.display_name, tipo: x.type ?? '',
    }))
    .filter((a: Achado) => !isNaN(a.lat) && !isNaN(a.lng))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const jwt = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
  if (!jwt) return res.status(401).json({ error: 'Não autenticado' })

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  )
  const { data: userData } = await sb.auth.getUser()
  if (!userData?.user) return res.status(401).json({ error: 'Sessão inválida' })

  const { address, city, state, house_id, house_name } = req.body ?? {}
  if (!address || !city) return res.status(400).json({ error: 'Preencha ao menos endereço e cidade' })

  if (house_id) {
    const { data: membro } = await sb.from('house_users')
      .select('id').eq('house_id', house_id).eq('user_id', userData.user.id).eq('is_active', true).maybeSingle()
    if (!membro) return res.status(403).json({ error: 'Sem acesso a esta casa' })
  }

  const end = String(address).trim()
  const cid = String(city).trim()
  const uf = String(state ?? '').trim()
  const nome = String(house_name ?? '').trim()

  // "Av. Fulano, 691" → via="Av. Fulano", numero="691"
  const m = end.match(/^(.*?)[\s,]+(\d+[A-Za-z]?)\s*$/)
  const via = m ? m[1].replace(/[\s,]+$/, '') : end
  const numero = m ? m[2] : ''

  try {
    // 1) nome da casa + endereço: acerta o estabelecimento, não a via
    if (nome) {
      const r = await nominatim({ q: [nome, end, cid, uf].filter(Boolean).join(', ') })
      if (r.length) return res.status(200).json({ ok: true, aproximado: false, origem: 'estabelecimento', melhor: r[0], alternativas: r.slice(1, 4) })
    }

    // 2) estruturada com número
    if (numero) {
      const r = await nominatim({ street: `${numero} ${via}`, city: cid, state: uf, country: 'Brasil' })
      if (r.length) return res.status(200).json({ ok: true, aproximado: false, origem: 'numero', melhor: r[0], alternativas: r.slice(1, 4) })
    }

    // 3) busca livre do endereço
    const r3 = await nominatim({ q: [end, cid, uf, 'Brasil'].filter(Boolean).join(', ') })
    if (r3.length) return res.status(200).json({ ok: true, aproximado: true, origem: 'endereco', melhor: r3[0], alternativas: r3.slice(1, 4) })

    // 4) só a via
    const r4 = await nominatim({ street: via, city: cid, state: uf, country: 'Brasil' })
    if (r4.length) return res.status(200).json({ ok: true, aproximado: true, origem: 'rua', melhor: r4[0], alternativas: r4.slice(1, 4) })

    return res.status(200).json({ ok: false, error: 'Endereço não encontrado. Confira a grafia ou cole as coordenadas do Google Maps.' })
  } catch {
    return res.status(200).json({ ok: false, error: 'Não foi possível consultar o serviço de mapas agora.' })
  }
}
