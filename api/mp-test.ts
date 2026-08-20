import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Valida o Access Token do Mercado Pago.
// Precisa rodar no servidor: a API do MP não envia cabeçalho CORS, então o mesmo fetch
// feito pelo navegador é bloqueado antes de sair e aparece como "erro de conexão".
//
// Exige JWT de membro ativo da casa — senão isto viraria um serviço público de
// verificação de tokens do Mercado Pago para qualquer um.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { house_id, token } = req.body ?? {}
  if (!house_id || !token) return res.status(400).json({ error: 'Dados incompletos' })

  const jwt = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
  if (!jwt) return res.status(401).json({ error: 'Não autenticado' })

  // Cliente com o JWT do usuário: o RLS decide o que ele enxerga
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  )
  const { data: userData } = await sb.auth.getUser()
  if (!userData?.user) return res.status(401).json({ error: 'Sessão inválida' })

  const { data: membro } = await sb.from('house_users')
    .select('id').eq('house_id', house_id).eq('user_id', userData.user.id).eq('is_active', true).maybeSingle()
  if (!membro) return res.status(403).json({ error: 'Sem acesso a esta casa' })

  try {
    const r = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${String(token).trim()}` },
    })
    const body = await r.json().catch(() => null)
    if (!r.ok) {
      return res.status(200).json({
        ok: false,
        status: r.status,
        error: body?.message ?? (r.status === 401 ? 'Token recusado pelo Mercado Pago' : 'Falha na validação'),
      })
    }
    // Só devolve o que ajuda a conferir se é a conta certa — nada de credencial de volta
    return res.status(200).json({
      ok: true,
      nickname: body?.nickname ?? null,
      email: body?.email ?? null,
      site: body?.site_id ?? null,          // MLB = Brasil
      live_mode: body?.site_id === 'MLB',
    })
  } catch {
    return res.status(200).json({ ok: false, error: 'Não foi possível falar com o Mercado Pago' })
  }
}
