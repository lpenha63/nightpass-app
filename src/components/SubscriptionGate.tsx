import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { fmtCurrency, fd } from '../utils/format'
import { effectiveStatus, isHouseActive, trialDaysLeft, SAAS_STATUS_LABEL, SAAS_STATUS_COLOR } from '../utils/saas'
import { PRODUCT_KEY } from '../hooks/useSubscription'
import type { Session, SaasPlan, SaasSubscription } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// PlanPicker — vitrine de planos + checkout (Mercado Pago via edge function)
// ─────────────────────────────────────────────────────────────────────────────
/** Régua de plano declarada pelo produto na central (saas_product_dimensions). */
interface PlanDimension {
  kind: 'limit' | 'feature'
  key: string
  label: string
  unit?: string | null
  sort_order: number
}

export function PlanPicker({ session, sub, onDone }: { session: Session; sub: SaasSubscription | null; onDone?: () => void }) {
  const [plans, setPlans] = useState<SaasPlan[]>([])
  const [dims, setDims] = useState<PlanDimension[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const isHouseAdmin = ['admin', 'super_admin'].includes(session.role)

  // Só os planos DESTE produto — a central vende vários apps no mesmo banco,
  // então listar todos os planos ativos mostraria os preços dos outros apps.
  // As dimensões vêm da central: o que a vitrine exibe é configurável lá,
  // sem precisar mexer neste arquivo a cada limite novo.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: prod } = await supabase
        .from('saas_products').select('id').eq('key', PRODUCT_KEY).maybeSingle()
      if (!alive) return

      let q = supabase.from('saas_plans').select('*').eq('active', true)
      if (prod?.id) q = q.eq('product_id', prod.id)
      const r = await q.order('sort_order')
      if (alive) setPlans((r.data ?? []) as SaasPlan[])

      if (prod?.id) {
        const d = await supabase.from('saas_product_dimensions')
          .select('kind,key,label,unit,sort_order')
          .eq('product_id', prod.id).eq('active', true).order('sort_order')
        if (alive) setDims((d.data ?? []) as PlanDimension[])
      }
    })()
    return () => { alive = false }
  }, [])

  async function subscribe(plan: SaasPlan) {
    setBusy(plan.key); setErr('')
    const { data, error } = await supabase.functions.invoke('saas-checkout', {
      body: { house_id: session.house.id, plan_key: plan.key, payer_email: session.user.email },
    })
    setBusy(null)
    if (error || !data?.init_point) { setErr(data?.error ?? error?.message ?? 'Falha ao iniciar o checkout'); return }
    // Redireciona para o checkout do Mercado Pago
    window.location.href = data.init_point
    onDone?.()
  }

  return (
    <div>
      <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, 1fr)`, gap: 14 }}>
        {plans.map(p => {
          const current = sub?.saas_plans?.key === p.key
          return (
            <div key={p.id} style={{
              background: C.bg, border: `2px solid ${p.highlight ? C.acc : C.brd}`, borderRadius: 16,
              padding: '20px 18px', position: 'relative', display: 'flex', flexDirection: 'column',
            }}>
              {p.highlight && (
                <span style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: C.acc, color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: 20, padding: '3px 12px', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>MAIS POPULAR</span>
              )}
              <div style={{ color: C.txt, fontWeight: 800, fontSize: 17 }}>{p.name}</div>
              <div style={{ color: C.mut, fontSize: 12, marginTop: 4, minHeight: 32 }}>{p.description}</div>
              <div style={{ margin: '12px 0' }}>
                <span style={{ color: C.txt, fontSize: 26, fontWeight: 900 }}>{fmtCurrency(p.price_cents)}</span>
                <span style={{ color: C.mut, fontSize: 12 }}> /mês</span>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'grid', gap: 6, flex: 1 }}>
                {dims.filter(d => d.kind === 'limit').map(d => {
                  const v = p.limits?.[d.key]
                  return (
                    <li key={d.key} style={{ fontSize: 12, color: C.sub }}>
                      • {v == null
                        ? `${d.label}: ilimitado`
                        : `${d.label}: ${v}${d.unit ? ' ' + d.unit : ''}`}
                    </li>
                  )
                })}
                {dims.filter(d => d.kind === 'feature').map(d => {
                  const on = !!p.features?.[d.key]
                  return (
                    <li key={d.key} style={{ fontSize: 12, color: on ? C.sub : C.mut }}>
                      {on ? '✅' : '✖'} {d.label}
                    </li>
                  )
                })}
              </ul>
              <button
                disabled={!isHouseAdmin || busy !== null || current}
                onClick={() => subscribe(p)}
                style={{
                  width: '100%', padding: '11px 0', borderRadius: 10, border: 'none', cursor: current || !isHouseAdmin ? 'default' : 'pointer',
                  background: current ? C.grn + '22' : p.highlight ? C.acc : C.brd,
                  color: current ? C.grn : '#fff', fontSize: 13, fontWeight: 800, fontFamily: 'inherit',
                  opacity: busy && busy !== p.key ? 0.5 : 1,
                }}>
                {current ? '✓ Plano atual' : busy === p.key ? 'Abrindo checkout…' : 'Assinar'}
              </button>
            </div>
          )
        })}
      </div>
      {!isHouseAdmin && <div style={{ color: C.mut, fontSize: 12, marginTop: 10 }}>Somente administradores da casa podem alterar a assinatura.</div>}
      {err && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 10 }}>⚠️ {err}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionGate — bloqueia o app quando a assinatura está suspensa/cancelada
// e mostra banner de trial / pagamento pendente.
// ─────────────────────────────────────────────────────────────────────────────
export function SubscriptionGate({ session, sub, loading, children }: {
  session: Session; sub: SaasSubscription | null; loading: boolean; children: React.ReactNode
}) {
  if (loading) return <>{children}</>

  const eff = effectiveStatus(sub)

  if (!isHouseActive(sub)) {
    return (
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 16px' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
          <h1 style={{ color: C.txt, fontSize: 24, fontWeight: 900, margin: 0 }}>
            {eff === 'canceled' ? 'Assinatura cancelada' : 'Acesso suspenso'}
          </h1>
          <p style={{ color: C.mut, fontSize: 14, marginTop: 8 }}>
            {sub?.status === 'trialing'
              ? 'Seu período de teste terminou. Escolha um plano para continuar usando o NightPass — seus dados estão guardados e voltam na hora.'
              : 'Regularize a assinatura para voltar a usar o NightPass. Seus dados estão preservados.'}
          </p>
        </div>
        <PlanPicker session={session} sub={sub} />
      </div>
    )
  }

  const days = trialDaysLeft(sub)
  const banner =
    sub?.status === 'past_due'
      ? { color: '#f59e0b', text: `⚠️ Pagamento pendente — regularize até ${sub.grace_until ? fd(sub.grace_until.slice(0, 10)) : 'o fim da carência'} para não perder o acesso.` }
      : sub?.status === 'pending'
        ? { color: '#f59e0b', text: '⏳ Aguardando confirmação do pagamento da assinatura…' }
        : days !== null && days <= 7
          ? { color: '#3b82f6', text: `🎁 Teste grátis: ${days === 0 ? 'último dia' : `${days} dia${days > 1 ? 's' : ''} restante${days > 1 ? 's' : ''}`}. Assine em Configurações → Assinatura.` }
          : null

  return (
    <>
      {banner && (
        <div style={{ background: banner.color + '18', border: `1px solid ${banner.color}55`, color: banner.color, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
          {banner.text}
        </div>
      )}
      {children}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionSection — bloco "Assinatura" nas Configurações da casa
// ─────────────────────────────────────────────────────────────────────────────
export function SubscriptionSection({ session, sub, refresh }: { session: Session; sub: SaasSubscription | null; refresh: () => void }) {
  const eff = effectiveStatus(sub)
  const color = SAAS_STATUS_COLOR[eff] ?? C.mut
  const days = trialDaysLeft(sub)
  const [showPlans, setShowPlans] = useState(!sub || eff === 'suspended' || eff === 'none')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ background: color + '22', color, border: `1px solid ${color}55`, borderRadius: 20, padding: '4px 14px', fontSize: 13, fontWeight: 800 }}>
          {SAAS_STATUS_LABEL[eff] ?? eff}
        </span>
        {sub?.saas_plans && <span style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>Plano {sub.saas_plans.name} · {fmtCurrency(sub.saas_plans.price_cents)}/mês</span>}
        {days !== null && <span style={{ color: C.mut, fontSize: 12 }}>({days} dia{days !== 1 ? 's' : ''} de teste restante{days !== 1 ? 's' : ''})</span>}
        {sub?.current_period_end && eff === 'active' && (
          <span style={{ color: C.mut, fontSize: 12 }}>Próxima cobrança: {fd(sub.current_period_end.slice(0, 10))}</span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => { setShowPlans(v => !v); refresh() }}
          style={{ background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 14px', color: C.sub, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          {showPlans ? 'Ocultar planos' : sub ? 'Trocar de plano' : 'Ver planos'}
        </button>
      </div>
      {showPlans && <PlanPicker session={session} sub={sub} />}
    </div>
  )
}
