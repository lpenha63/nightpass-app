import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Busca do par (evento, casa) a partir do token de um link publico.
 *
 * Mora aqui porque DOIS lugares precisam do mesmo dado: a previa em HTML
 * (lista-preview) e a imagem do card (preview-imagem). Duplicar a consulta era
 * garantir que um dia os dois mostrassem eventos diferentes para o mesmo link.
 */

export const SB_URL = process.env.SUPABASE_URL ?? 'https://irghwfzcbazujddfftsx.supabase.co'
export const SB_ANON = process.env.SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyZ2h3ZnpjYmF6dWpkZGZmdHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjI4OTAsImV4cCI6MjA4ODEzODg5MH0.CMrdK4-7rWbgYcqttWtGF1CIWjywL0KVxYCBx27emhw'

export interface Ev { name?: string; event_date?: string; start_time?: string; flyer_url?: string }
export interface Casa { name?: string; logo_url?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any
type Row = Record<string, unknown> | null

/** Cliente com o token no cabecalho: o RLS dessas tabelas exige `x-np-token`. */
export function clientePublico(token: string): SupabaseClient {
  return createClient(SB_URL, SB_ANON, {
    global: { headers: { 'x-np-token': token } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Cada tipo de link resolve para o mesmo par (evento, casa). */
export async function resolve(
  sb: SB, type: string, token: string,
): Promise<{ ev: Ev | null; casa: Casa | null; extra?: string }> {
  const evSel = 'events(name,event_date,start_time,flyer_url),houses(name,logo_url)'
  const pick = (d: Row) => ({
    ev: (d?.events ?? null) as Ev | null,
    casa: (d?.houses ?? null) as Casa | null,
  })
  const txt = (d: Row, key: string) => (d?.[key] as string) || undefined

  if (type === 'lista') {
    const { data } = await sb.from('promoter_lists').select(evSel).eq('token', token).single()
    return pick(data as Row)
  }
  if (type === 'reserva') {
    const { data } = await sb.from('reservations').select(`name,${evSel}`).eq('token', token).single()
    return { ...pick(data as Row), extra: txt(data as Row, 'name') }
  }
  if (type === 'confirmar') {
    const { data } = await sb.from('promoter_list_guests').select(`full_name,${evSel}`).eq('invite_token', token).single()
    return { ...pick(data as Row), extra: txt(data as Row, 'full_name') }
  }
  if (type === 'niver') {
    const { data } = await sb.from('birthday_lists').select(`birthday_person_name,${evSel}`).eq('token', token).single()
    return { ...pick(data as Row), extra: txt(data as Row, 'birthday_person_name') }
  }
  if (type === 'evento') {
    const { data } = await sb.from('events').select('name,event_date,start_time,flyer_url,houses(name,logo_url)').eq('id', token).single()
    const d = data as Row
    return { ev: (d ?? null) as Ev | null, casa: (d?.houses ?? null) as Casa | null }
  }
  return { ev: null, casa: null }
}
