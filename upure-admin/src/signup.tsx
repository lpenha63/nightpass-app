import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { sb } from './lib/supabase'
import { C, inp, btn, lbl } from './theme'
import { money, onlyDigits } from './format'
import type { Product, Plan } from './types'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? 'https://irghwfzcbazujddfftsx.supabase.co'

/** Lê ?app=, ?plano= e os utm_* da URL — é assim que o anúncio chega aqui. */
function readParams() {
  const q = new URLSearchParams(location.search)
  const origin: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref']) {
    const v = q.get(k)
    if (v) origin[k] = v
  }
  if (document.referrer) origin.referrer = document.referrer
  return { appKey: q.get('app') ?? '', planKey: q.get('plano') ?? q.get('plan') ?? '', origin }
}

function Signup() {
  const [{ appKey, planKey, origin }] = useState(readParams)
  const [product, setProduct] = useState<Product | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(true)

  const [f, setF] = useState({ org_name: '', full_name: '', email: '', phone: '', doc: '', password: '', website: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<{ app: string; app_url: string | null } | null>(null)
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }))

  useEffect(() => {
    if (!appKey) { setLoading(false); return }
    ;(async () => {
      const { data: prod } = await sb.from('saas_products')
        .select('*').eq('key', appKey).eq('active', true).maybeSingle()
      setProduct((prod ?? null) as Product | null)
      if (prod) {
        let q = sb.from('saas_plans').select('*').eq('product_id', prod.id).eq('active', true)
        if (planKey) q = q.eq('key', planKey)
        const { data: pl } = await q.order('sort_order').limit(1).maybeSingle()
        setPlan((pl ?? null) as Plan | null)
      }
      setLoading(false)
    })()
  }, [appKey, planKey])

  async function submit() {
    if (!f.org_name.trim()) { setErr('Informe o nome do seu estabelecimento.'); return }
    if (!f.email.trim()) { setErr('Informe seu e-mail.'); return }
    if (f.password.length < 6) { setErr('A senha precisa ter ao menos 6 caracteres.'); return }
    setBusy(true); setErr('')

    const r = await fetch(`${SUPABASE_URL}/functions/v1/saas-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_key: appKey, plan_key: planKey,
        org_name: f.org_name, full_name: f.full_name, email: f.email,
        phone: onlyDigits(f.phone), doc: onlyDigits(f.doc),
        password: f.password, website: f.website, origin,
      }),
    })
    const data = await r.json().catch(() => null)
    setBusy(false)
    if (!r.ok || data?.error) { setErr(data?.error ?? 'Não foi possível concluir o cadastro.'); return }
    setDone({ app: data.app, app_url: data.app_url })
  }

  if (loading) return <Shell><div style={{ color: C.mut, textAlign: 'center' }}>Carregando…</div></Shell>

  if (!appKey || !product) {
    return (
      <Shell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🤔</div>
          <h1 style={{ fontSize: 20, fontWeight: 900, marginBottom: 8 }}>Link incompleto</h1>
          <p style={{ color: C.mut, fontSize: 14, lineHeight: 1.5 }}>
            Este link de cadastro não indica qual aplicativo você quer assinar.
            Volte à página de vendas e clique no botão de cadastro.
          </p>
        </div>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 46, marginBottom: 12 }}>🎉</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Conta criada!</h1>
          <p style={{ color: C.sub, fontSize: 14, lineHeight: 1.6, marginBottom: 6 }}>
            Seu teste grátis do <b>{done.app}</b> já está ativo por <b>14 dias</b>.
          </p>
          <p style={{ color: C.mut, fontSize: 13, lineHeight: 1.6, marginBottom: 22 }}>
            Entre com <b style={{ color: C.sub }}>{f.email}</b> e a senha que você acabou de criar.
          </p>
          {done.app_url && (
            <a href={done.app_url} style={{ ...btn, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Entrar no {done.app} →
            </a>
          )}
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ color: C.acc, fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', marginBottom: 6 }}>
          TESTE GRÁTIS POR 14 DIAS
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 900 }}>Criar conta no {product.name}</h1>
        {product.description && (
          <p style={{ color: C.mut, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{product.description}</p>
        )}
        {plan && (
          <div style={{
            marginTop: 14, background: C.acc + '15', border: `1px solid ${C.acc}44`,
            borderRadius: 10, padding: '10px 14px', fontSize: 13, color: C.sub,
          }}>
            Plano <b style={{ color: C.txt }}>{plan.name}</b> · {money(plan.price_cents)}/mês
            <div style={{ color: C.mut, fontSize: 11, marginTop: 3 }}>
              Você só paga depois do teste. Sem cartão agora.
            </div>
          </div>
        )}
      </div>

      <label style={lbl}>NOME DO ESTABELECIMENTO *</label>
      <input style={{ ...inp, marginBottom: 12 }} value={f.org_name} onChange={e => set('org_name', e.target.value)} placeholder="Ex.: Bar do Léo" />

      <label style={lbl}>SEU NOME</label>
      <input style={{ ...inp, marginBottom: 12 }} value={f.full_name} onChange={e => set('full_name', e.target.value)} />

      <label style={lbl}>E-MAIL *</label>
      <input style={{ ...inp, marginBottom: 12 }} type="email" value={f.email} onChange={e => set('email', e.target.value)} />

      <label style={lbl}>WHATSAPP</label>
      <input style={{ ...inp, marginBottom: 12 }} inputMode="numeric" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="11 99999-8888" />

      <label style={lbl}>CNPJ OU CPF</label>
      <input style={{ ...inp, marginBottom: 12 }} inputMode="numeric" value={f.doc} onChange={e => set('doc', e.target.value)} placeholder="opcional" />

      <label style={lbl}>SENHA *</label>
      <input
        style={{ ...inp, marginBottom: 18 }} type="password" value={f.password}
        onChange={e => set('password', e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="mínimo 6 caracteres"
      />

      {/* Honeypot: invisível para humanos, irresistível para bots */}
      <input
        tabIndex={-1} autoComplete="off" value={f.website} onChange={e => set('website', e.target.value)}
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
        aria-hidden="true"
      />

      {err && (
        <div style={{ background: C.red + '18', border: `1px solid ${C.red}55`, color: C.red, borderRadius: 10, padding: '9px 12px', fontSize: 13, marginBottom: 14 }}>
          ⚠️ {err}
        </div>
      )}

      <button style={{ ...btn, width: '100%', padding: '13px 0', fontSize: 15 }} disabled={busy} onClick={submit}>
        {busy ? 'Criando sua conta…' : 'Começar teste grátis'}
      </button>

      <p style={{ color: C.mut, fontSize: 11, textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
        Sem cartão de crédito. Você escolhe o plano no fim do teste.
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
      <div style={{ width: '100%', maxWidth: 440, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 20, padding: '32px 26px' }}>
        {children}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Signup /></StrictMode>)
