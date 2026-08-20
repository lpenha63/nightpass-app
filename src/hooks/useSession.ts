import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ROLE_PAGES, ALL_PAGES } from '../constants/permissions'
import type { Session, House } from '../types'

// Casa escolhida pelo usuário. Sem isto o app entrava numa casa QUALQUER: a consulta
// usava .limit(1) sem ordenar, e quem tem mais de uma casa nunca alcançava as outras.
const CASA_KEY = 'np.casa'
export const guardarCasa = (id: string) => { try { localStorage.setItem(CASA_KEY, id) } catch { /* modo privado */ } }
export const casaPreferida = () => { try { return localStorage.getItem(CASA_KEY) } catch { return null } }

// Painel "Suas unidades" no Dashboard. Ligado por padrão; quem acha ruído desliga.
// Fica no aparelho, como o tema — não é configuração da casa.
const PAINEL_KEY = 'np.painelUnidades'
export const painelUnidadesLigado = () => { try { return localStorage.getItem(PAINEL_KEY) !== '0' } catch { return true } }
export const setPainelUnidades = (on: boolean) => { try { localStorage.setItem(PAINEL_KEY, on ? '1' : '0') } catch { /* modo privado */ } }
const casaGuardada = casaPreferida

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { setChecked(true); return }
      await loadHouseSession(data.session.user.id, data.session.user.email ?? '')
    })
  }, [])

  async function loadHouseSession(uid: string, email: string) {
    const [profRes, vincRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).single(),
      // TODAS as casas: o seletor precisa da lista, e a escolha tem de ser estável
      supabase.from('house_users')
        .select('*,houses(*)')
        .eq('user_id', uid)
        .eq('is_active', true),
    ])

    const vincs = (vincRes.data ?? []).filter(v => (v as { houses?: House }).houses)
    const preferida = casaGuardada()
    const escolhido = vincs.find(v => v.house_id === preferida)
      // sem preferência: ordem alfabética da casa — determinística entre recargas
      ?? [...vincs].sort((a, b) => ((a as { houses?: House }).houses?.name ?? '').localeCompare((b as { houses?: House }).houses?.name ?? ''))[0]
    const houseRes = { data: escolhido ?? null }
    const todasCasas = [...vincs]
      .map(v => (v as unknown as { houses: House }).houses)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

    if (!houseRes.data) {
      // Check for a pending invite matching this email
      const { data: invite } = await supabase
        .from('house_invites')
        .select('*')
        .eq('invited_email', email.toLowerCase())
        .is('used_at', null)
        .limit(1)
        .single()

      if (invite) {
        const { data: newHu } = await supabase.from('house_users').insert({
          user_id: uid,
          house_id: invite.house_id,
          role: invite.role,
          freelancer_id: invite.freelancer_id,
          allowed_pages: invite.allowed_pages,
          is_active: true,
        }).select('*,houses(*)').single()

        await supabase.from('house_invites')
          .update({ used_at: new Date().toISOString() })
          .eq('id', invite.id)

        if (newHu?.houses) {
          const effectivePages: string[] = newHu.allowed_pages?.length
            ? newHu.allowed_pages
            : (ROLE_PAGES[newHu.role] ?? [...ALL_PAGES])
          setSession({
            user: { id: uid, email, full_name: profRes.data?.full_name },
            house: (newHu as any).houses,
            role: newHu.role,
            allowedPages: effectivePages,
            freelancerId: newHu.freelancer_id ?? null,
            isSaasAdmin: !!profRes.data?.is_saas_admin,
          })
          setChecked(true)
          return
        }
      }
      setChecked(true)
      return
    }

    const effectivePages: string[] = houseRes.data.allowed_pages?.length
      ? houseRes.data.allowed_pages
      : (ROLE_PAGES[houseRes.data.role] ?? [...ALL_PAGES])

    const casaAtual = (houseRes.data as any).houses as House
    guardarCasa(casaAtual.id)
    setSession({
      user: { id: uid, email, full_name: profRes.data?.full_name },
      house: casaAtual,
      role: houseRes.data.role,
      allowedPages: effectivePages,
      freelancerId: houseRes.data.freelancer_id ?? null,
      isSaasAdmin: !!profRes.data?.is_saas_admin,
      houses: todasCasas,
    })
    setChecked(true)
  }

  return { session, setSession, checked }
}
