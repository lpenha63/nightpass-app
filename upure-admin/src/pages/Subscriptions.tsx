import { useState } from 'react'
import { sb } from '../lib/supabase'
import { C, inp, sel, card, STATUS_LABEL, STATUS_COLOR } from '../theme'
import { Kpi, Pill, Badge, Empty } from '../components/ui'
import { money, fdate, effective } from '../format'
import type { Product, Plan, Sub, Payment } from '../types'

const GRID = '1fr 130px 150px 140px 130px'

export function Subscriptions({ actorId, products, plans, subs, payments, reload }: {
  actorId: string; products: Product[]; plans: Plan[]; subs: Sub[]; payments: Payment[]; reload: () => void
}) {
  const [prodSel, setProdSel] = useState('all')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const audit = (customerId: string, action: string, details: Record<string, unknown>) =>
    sb.from('saas_audit_log').insert({ actor_user_id: actorId, customer_id: customerId, action, details })

  async function changePlan(s: Sub, planId: string) {
    setBusy(s.id)
    await sb.from('saas_subscriptions').update({ plan_id: planId }).eq('id', s.id)
    await audit(s.customer_id, 'plan_change', { from: s.plan_id, to: planId })
    setBusy(null); reload()
  }

  async function changeStatus(s: Sub, status: string) {
    setBusy(s.id)
    const patch: Record<string, unknown> = { status }
    if (status === 'active') {
      patch.current_period_start = new Date().toISOString()
      patch.current_period_end = new Date(Date.now() + 30 * 864e5).toISOString()
      patch.grace_until = null
    }
    if (status === 'trialing') patch.trial_ends_at = new Date(Date.now() + 14 * 864e5).toISOString()
    if (status === 'canceled') patch.canceled_at = new Date().toISOString()
    await sb.from('saas_subscriptions').update(patch).eq('id', s.id)
    await audit(s.customer_id, 'status_change', { from: s.status, to: status })
    setBusy(null); reload()
  }

  const visible = subs
    .filter(s => prodSel === 'all' || s.product_id === prodSel)
    .filter(s => {
      if (!q) return true
      const t = q.toLowerCase()
      const c = s.saas_customers
      return (c?.name ?? '').toLowerCase().includes(t) || (c?.email ?? '').toLowerCase().includes(t)
    })

  const mrr = visible.filter(s => effective(s) === 'active').reduce((t, s) => t + (s.saas_plans?.price_cents ?? 0), 0)
  const counts = visible.reduce<Record<string, number>>((acc, s) => {
    const e = effective(s); acc[e] = (acc[e] ?? 0) + 1; return acc
  }, {})
  const prodPlans = (pid?: string | null) => plans.filter(p => !pid || p.product_id === pid)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <Pill active={prodSel === 'all'} onClick={() => setProdSel('all')}>🗂️ Todos os apps</Pill>
        {products.map(p => (
          <Pill key={p.id} active={prodSel === p.id} onClick={() => setProdSel(p.id)}>{p.name}</Pill>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 22 }}>
        <Kpi label="MRR" val={money(mrr)} color={C.grn} />
        <Kpi label="Ativas" val={String(counts.active ?? 0)} color={C.grn} />
        <Kpi label="Em teste" val={String(counts.trialing ?? 0)} color={C.acc} />
        <Kpi label="Cortesia" val={String(counts.comp ?? 0)} color={C.vio} />
        <Kpi label="Suspensas/inadimpl." val={String((counts.suspended ?? 0) + (counts.past_due ?? 0))} color={C.red} />
      </div>

      <input style={{ ...inp, marginBottom: 14 }} placeholder="🔍 Buscar assinante por nome ou e-mail…" value={q} onChange={e => setQ(e.target.value)} />

      <div style={{ ...card, marginBottom: 22, overflowX: 'auto' }}>
        <div style={{ minWidth: 760 }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '4px 8px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em' }}>
            <div>CLIENTE / APP</div><div>STATUS</div><div>PLANO</div><div>PERÍODO / TRIAL</div><div>AÇÃO</div>
          </div>
          {visible.length === 0 && <Empty>Nenhuma assinatura encontrada.</Empty>}
          {visible.map(s => {
            const eff = effective(s)
            const color = STATUS_COLOR[eff] ?? C.mut
            const prod = products.find(p => p.id === s.product_id)
            return (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '11px 8px', borderTop: `1px solid ${C.brd}55`, alignItems: 'center', fontSize: 13, opacity: busy === s.id ? 0.5 : 1 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.saas_customers?.name ?? '—'}
                  </div>
                  <div style={{ color: C.mut, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {prod?.name ?? 'sem produto'}{s.saas_customers?.email ? ` · ${s.saas_customers.email}` : ''}
                  </div>
                </div>
                <div><Badge color={color}>{STATUS_LABEL[eff] ?? eff}</Badge></div>
                <div>
                  <select style={sel} value={s.plan_id} disabled={busy === s.id} onChange={e => changePlan(s, e.target.value)}>
                    {prodPlans(s.product_id).map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.price_cents)}</option>)}
                  </select>
                </div>
                <div style={{ color: C.mut, fontSize: 11 }}>
                  {s.status === 'trialing' && s.trial_ends_at
                    ? `Trial até ${fdate(s.trial_ends_at)}`
                    : s.current_period_end ? `Renova ${fdate(s.current_period_end)}` : '—'}
                </div>
                <div>
                  <select style={sel} value="" disabled={busy === s.id} onChange={e => { if (e.target.value) changeStatus(s, e.target.value) }}>
                    <option value="">Alterar…</option>
                    <option value="active">✅ Liberar (30d)</option>
                    <option value="trialing">🎁 Trial +14d</option>
                    <option value="comp">💜 Cortesia</option>
                    <option value="suspended">🔒 Bloquear</option>
                    <option value="canceled">✖ Cancelar</option>
                  </select>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>💳 Últimos pagamentos</div>
        {payments.length === 0
          ? <div style={{ color: C.mut, fontSize: 13 }}>Nenhum pagamento registrado ainda.</div>
          : payments.map(p => {
            const s = subs.find(x => x.customer_id === p.customer_id)
            const ok = p.status === 'approved'
            return (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderTop: `1px solid ${C.brd}55`, fontSize: 13 }}>
                <span>
                  {s?.saas_customers?.name ?? '—'}
                  <span style={{ color: C.mut, fontSize: 11 }}> · {fdate(p.paid_at ?? p.created_at)}{p.method ? ` · ${p.method}` : ''}</span>
                </span>
                <span style={{ color: ok ? C.grn : C.gold, fontWeight: 700 }}>{money(p.amount_cents)} · {p.status}</span>
              </div>
            )
          })}
      </div>
    </div>
  )
}
