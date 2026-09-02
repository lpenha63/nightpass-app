import { useState, useEffect, useCallback } from 'react'
import { sb } from './lib/supabase'
import { C, inp, btn, lbl } from './theme'
import { Center, NavTab } from './components/ui'
import { Dashboard } from './pages/Dashboard'
import { Customers } from './pages/Customers'
import { Subscriptions } from './pages/Subscriptions'
import { Invoices } from './pages/Invoices'
import { Catalog } from './pages/Catalog'
import { Messages } from './pages/Messages'
import { Settings } from './pages/Settings'
import type { Product, Plan, Sub, Payment, Customer, Invoice } from './types'

type View = 'dashboard' | 'customers' | 'subs' | 'invoices' | 'catalog' | 'messages' | 'settings'

export default function App() {
  const [uid, setUid] = useState<string | null>(null)
  const [authorized, setAuthorized] = useState<boolean | null>(null)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setUid(data.session?.user?.id ?? null))
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setUid(s?.user?.id ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!uid) { setAuthorized(null); return }
    sb.from('profiles').select('is_saas_admin').eq('id', uid).single()
      .then(async r => {
        if (r.data?.is_saas_admin) setAuthorized(true)
        else { setAuthorized(false); await sb.auth.signOut() }
      })
  }, [uid])

  if (!uid) return <Login denied={authorized === false} />
  if (authorized === null) return <Center>Verificando acesso…</Center>
  if (!authorized) return <Login denied />
  return <Panel actorId={uid} />
}

// ─────────────────────────── LOGIN ───────────────────────────
function Login({ denied }: { denied?: boolean }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function enter() {
    setBusy(true); setErr('')
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pass })
    setBusy(false)
    if (error) setErr('Credenciais inválidas')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 380, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 20, padding: '34px 28px' }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{ fontSize: 34 }}>🛠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, marginTop: 8 }}>Central de Assinaturas</h1>
          <div style={{ color: C.mut, fontSize: 13, marginTop: 4 }}>Gestão de clientes e mensalidades dos apps</div>
        </div>
        {denied && (
          <div style={{ background: C.red + '18', border: `1px solid ${C.red}55`, color: C.red, borderRadius: 10, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>
            ⛔ Acesso restrito a administradores da plataforma.
          </div>
        )}
        <label style={lbl}>E-MAIL</label>
        <input style={{ ...inp, marginBottom: 14 }} type="email" value={email} onChange={e => setEmail(e.target.value)} />
        <label style={lbl}>SENHA</label>
        <input style={{ ...inp, marginBottom: 20 }} type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && enter()} />
        {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <button style={{ ...btn, width: '100%' }} disabled={busy} onClick={enter}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </div>
    </div>
  )
}

// ─────────────────────────── PAINEL ───────────────────────────
function Panel({ actorId }: { actorId: string }) {
  const [view, setView] = useState<View>('dashboard')
  const [products, setProducts] = useState<Product[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [pr, pl, cu, su, iv, pa] = await Promise.all([
      sb.from('saas_products').select('*').order('name'),
      sb.from('saas_plans').select('*').order('sort_order'),
      sb.from('saas_customers').select('*').order('name'),
      sb.from('saas_subscriptions').select('*, saas_plans(*), saas_customers(*)').neq('status', 'canceled').order('created_at'),
      sb.from('saas_invoices').select('*').order('due_date', { ascending: false }).limit(300),
      sb.from('saas_payments').select('id,customer_id,house_id,amount_cents,status,method,paid_at,created_at').order('created_at', { ascending: false }).limit(25),
    ])
    setProducts((pr.data ?? []) as Product[])
    setPlans((pl.data ?? []) as Plan[])
    setCustomers((cu.data ?? []) as Customer[])
    setSubs((su.data ?? []) as Sub[])
    setInvoices((iv.data ?? []) as Invoice[])
    setPayments((pa.data ?? []) as Payment[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 18px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 26 }}>🛠️</div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 900 }}>Central de Assinaturas</h1>
          <div style={{ color: C.mut, fontSize: 12 }}>Clientes, mensalidades e acessos de todos os apps</div>
        </div>
        <button
          onClick={() => sb.auth.signOut()}
          style={{ background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 14px', color: C.mut, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          Sair
        </button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${C.brd}`, paddingBottom: 2, overflowX: 'auto' }}>
        <NavTab active={view === 'dashboard'} onClick={() => setView('dashboard')}>📊 Painel</NavTab>
        <NavTab active={view === 'customers'} onClick={() => setView('customers')}>👥 Clientes</NavTab>
        <NavTab active={view === 'subs'} onClick={() => setView('subs')}>📋 Assinaturas</NavTab>
        <NavTab active={view === 'invoices'} onClick={() => setView('invoices')}>🧾 Mensalidades</NavTab>
        <NavTab active={view === 'catalog'} onClick={() => setView('catalog')}>🧩 Apps & Planos</NavTab>
        <NavTab active={view === 'messages'} onClick={() => setView('messages')}>💬 Comunicação</NavTab>
        <NavTab active={view === 'settings'} onClick={() => setView('settings')}>⚙️ Config</NavTab>
      </div>

      {loading ? (
        <div style={{ color: C.mut, fontSize: 13, padding: 40, textAlign: 'center' }}>Carregando…</div>
      ) : view === 'dashboard' ? (
        <Dashboard />
      ) : view === 'customers' ? (
        <Customers customers={customers} subs={subs} products={products} reload={load} />
      ) : view === 'subs' ? (
        <Subscriptions actorId={actorId} products={products} plans={plans} subs={subs} payments={payments} reload={load} />
      ) : view === 'invoices' ? (
        <Invoices invoices={invoices} products={products} customers={customers} reload={load} />
      ) : view === 'messages' ? (
        <Messages customers={customers} />
      ) : view === 'settings' ? (
        <Settings />
      ) : (
        <Catalog products={products} plans={plans} reload={load} />
      )}
    </div>
  )
}
