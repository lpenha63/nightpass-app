import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Diz ao app quais integrações de SERVIDOR estão configuradas.
// O front não enxerga variáveis de ambiente, então sem isto o guia de configuração
// não teria como dizer "e-mail ainda não está ligado".
// Só devolve true/false — nenhuma chave sai daqui.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const jwt = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
  if (!jwt) return res.status(401).json({ error: 'Não autenticado' })

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  )
  const { data: userData } = await sb.auth.getUser()
  if (!userData?.user) return res.status(401).json({ error: 'Sessão inválida' })

  return res.status(200).json({
    email: !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
    email_from: process.env.RESEND_FROM ?? null,
    pagamentos: !!process.env.SUPABASE_SERVICE_ROLE_KEY,   // funções de pagamento dependem dela
    app_url: process.env.APP_URL ?? null,
  })
}
