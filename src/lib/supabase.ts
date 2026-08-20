import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/**
 * Cliente para as páginas públicas de token (reserva, aniversário, convite, portal).
 *
 * O RLS dessas tabelas deixou de ser aberto: agora só devolve as linhas do link em uso,
 * e para saber qual é o link ele lê o cabeçalho `x-np-token`. Sem este cliente, a página
 * pública não enxerga nada — e sem o RLS, qualquer um baixava a base de convidados.
 *
 * Cada página cria o seu uma vez (useMemo) com o token da URL.
 */
export function supabasePublico(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { 'x-np-token': token } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
