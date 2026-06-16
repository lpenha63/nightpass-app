import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { ROLE_PAGES, ALL_PAGES } from '../constants/permissions'

const INP: React.CSSProperties = {
  width: '100%', background: '#1f2937', border: `1px solid #1e2736`,
  borderRadius: 10, padding: '12px 14px', color: '#f9fafb', fontSize: 15,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
}

type Tab = 'login' | 'signup'

export function LoginPage({ onLogin }: { onLogin: (s: any) => void }) {
  const [tab, setTab]           = useState<Tab>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]         = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [signupDone, setSignupDone] = useState(false)

  async function handleLogin() {
    if (!email || !password) { setError('Preencha e-mail e senha'); return }
    setLoading(true); setError('')

    const { data, error: authErr } = await supabase.auth.signInWithPassword({ email, password })
    if (authErr || !data.session) {
      setError('E-mail ou senha inválidos')
      setLoading(false); return
    }

    const uid = data.session.user.id
    const userEmail = data.session.user.email ?? ''

    // Load active house access
    const [profRes, houseRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).single(),
      supabase.from('house_users').select('*,houses(*)').eq('user_id', uid).eq('is_active', true).limit(1).single(),
    ])

    if (!houseRes.data) {
      // Check for a pending invite
      const { data: invite } = await supabase.from('house_invites')
        .select('*').eq('invited_email', userEmail.toLowerCase()).is('used_at', null).limit(1).single()

      if (invite) {
        const { data: newHu } = await supabase.from('house_users').insert({
          user_id: uid, house_id: invite.house_id, role: invite.role,
          freelancer_id: invite.freelancer_id, allowed_pages: invite.allowed_pages, is_active: true,
        }).select('*,houses(*)').single()
        await supabase.from('house_invites').update({ used_at: new Date().toISOString() }).eq('id', invite.id)
        if (newHu?.houses) {
          const effectivePages: string[] = newHu.allowed_pages?.length
            ? newHu.allowed_pages : (ROLE_PAGES[newHu.role] ?? [...ALL_PAGES])
          onLogin({ user: { id: uid, email: userEmail, full_name: profRes.data?.full_name }, house: (newHu as any).houses, role: newHu.role, allowedPages: effectivePages, freelancerId: newHu.freelancer_id ?? null })
          setLoading(false); return
        }
      }

      setError('Acesso não autorizado ou aguardando ativação. Contate o administrador.')
      await supabase.auth.signOut()
      setLoading(false); return
    }

    const effectivePages: string[] = houseRes.data.allowed_pages?.length
      ? houseRes.data.allowed_pages : (ROLE_PAGES[houseRes.data.role] ?? [...ALL_PAGES])

    onLogin({
      user: { id: uid, email: userEmail, full_name: profRes.data?.full_name },
      house: (houseRes.data as any).houses,
      role: houseRes.data.role,
      allowedPages: effectivePages,
      freelancerId: houseRes.data.freelancer_id ?? null,
    })
    setLoading(false)
  }

  async function handleSignup() {
    if (!email || !password) { setError('Preencha e-mail e senha'); return }
    if (password.length < 6) { setError('A senha deve ter pelo menos 6 caracteres'); return }
    setLoading(true); setError('')

    const { error: signErr } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name.trim() || undefined } },
    })

    if (signErr) {
      setError(signErr.message === 'User already registered' ? 'E-mail já cadastrado. Tente fazer login.' : signErr.message)
      setLoading(false); return
    }

    // Update profile name if provided
    if (name.trim()) {
      const { data: sess } = await supabase.auth.getSession()
      if (sess.session) {
        await supabase.from('profiles').upsert({ id: sess.session.user.id, full_name: name.trim(), email })
      }
    }

    await supabase.auth.signOut()
    setSignupDone(true)
    setLoading(false)
  }

  const TAB_BTN = (t: Tab, label: string) => (
    <button onClick={() => { setTab(t); setError('') }}
      style={{
        flex: 1, padding: '10px', borderRadius: 8,
        border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 14,
        background: tab === t ? C.acc : 'transparent',
        color: tab === t ? '#fff' : C.mut,
        transition: 'all .15s',
      }}>
      {label}
    </button>
  )

  return (
    <div style={{
      minHeight: '100vh', background: C.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter', sans-serif", padding: 20,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.brd}`,
        borderRadius: 20, padding: 36, maxWidth: 400, width: '100%',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>🎭</div>
          <h1 style={{ color: C.txt, fontWeight: 900, fontSize: 26, margin: 0 }}>NightPass</h1>
          <p style={{ color: C.mut, fontSize: 13, marginTop: 6 }}>Gestão inteligente para sua casa noturna</p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, background: C.bg, borderRadius: 10, padding: 4, marginBottom: 24 }}>
          {TAB_BTN('login', '🔑 Entrar')}
          {TAB_BTN('signup', '✨ Criar conta')}
        </div>

        {/* Login form */}
        {tab === 'login' && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, letterSpacing: '0.06em' }}>E-MAIL</label>
              <input style={INP} type="email" value={email} autoFocus
                onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="seu@email.com" />
            </div>
            <div>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, letterSpacing: '0.06em' }}>SENHA</label>
              <input style={INP} type="password" value={password}
                onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••" />
            </div>
            {error && <div style={{ background: '#f8717122', border: '1px solid #f8717144', borderRadius: 10, padding: '10px 14px', color: '#f87171', fontSize: 13 }}>{error}</div>}
            <button onClick={handleLogin} disabled={loading}
              style={{ background: loading ? C.brd : `linear-gradient(135deg,#3b82f6,#1d4ed8)`, color: '#fff', border: 'none', borderRadius: 12, padding: 14, fontSize: 16, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
              {loading ? 'Entrando...' : '🔑 Entrar'}
            </button>
            <p style={{ color: C.mut, fontSize: 11, textAlign: 'center' }}>Acesso restrito a colaboradores autorizados</p>
          </div>
        )}

        {/* Signup form */}
        {tab === 'signup' && !signupDone && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ background: '#f59e0b18', border: '1px solid #f59e0b33', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>ℹ️ Primeiro acesso?</div>
              <div style={{ color: C.mut, fontSize: 12, marginTop: 4 }}>
                Após criar sua conta, um administrador precisa ativar seu acesso ao sistema.
              </div>
            </div>
            <div>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, letterSpacing: '0.06em' }}>SEU NOME</label>
              <input style={INP} type="text" value={name} autoFocus
                onChange={e => setName(e.target.value)} placeholder="Nome completo" />
            </div>
            <div>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, letterSpacing: '0.06em' }}>E-MAIL</label>
              <input style={INP} type="email" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" />
            </div>
            <div>
              <label style={{ color: C.sub, fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 6, letterSpacing: '0.06em' }}>SENHA</label>
              <input style={INP} type="password" value={password}
                onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSignup()}
                placeholder="Mínimo 6 caracteres" />
            </div>
            {error && <div style={{ background: '#f8717122', border: '1px solid #f8717144', borderRadius: 10, padding: '10px 14px', color: '#f87171', fontSize: 13 }}>{error}</div>}
            <button onClick={handleSignup} disabled={loading}
              style={{ background: loading ? C.brd : `linear-gradient(135deg,#10b981,#059669)`, color: '#fff', border: 'none', borderRadius: 12, padding: 14, fontSize: 16, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              {loading ? 'Criando conta...' : '✨ Criar conta'}
            </button>
          </div>
        )}

        {/* Signup done */}
        {tab === 'signup' && signupDone && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <div style={{ color: C.grn, fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Conta criada!</div>
            <div style={{ color: C.mut, fontSize: 14, marginBottom: 20 }}>
              Aguarde a ativação por um administrador do sistema. Assim que liberado, faça login normalmente.
            </div>
            <button onClick={() => { setTab('login'); setSignupDone(false); setError('') }}
              style={{ background: C.acc, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Ir para Login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
