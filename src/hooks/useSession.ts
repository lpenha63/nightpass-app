import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ROLE_PAGES, ALL_PAGES } from '../constants/permissions'
import type { Session } from '../types'

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
    const [profRes, houseRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).single(),
      supabase.from('house_users')
        .select('*,houses(*)')
        .eq('user_id', uid)
        .eq('is_active', true)
        .limit(1)
        .single(),
    ])

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

    setSession({
      user: { id: uid, email, full_name: profRes.data?.full_name },
      house: (houseRes.data as any).houses,
      role: houseRes.data.role,
      allowedPages: effectivePages,
      freelancerId: houseRes.data.freelancer_id ?? null,
    })
    setChecked(true)
  }

  return { session, setSession, checked }
}
