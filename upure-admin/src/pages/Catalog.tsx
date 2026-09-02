import { useState, useEffect, useCallback } from 'react'
import { sb } from '../lib/supabase'
import { C, inp, btn, btnGhost, sel } from '../theme'
import { Modal, Field, Toggle, Badge, Empty } from '../components/ui'
import { money, reaisFromCents, centsFromReais, numOrNull, slug } from '../format'
import type { Product, Plan, Dimension } from '../types'

/**
 * Link de cadastro por app — derivado da chave, não armazenado.
 * Guardar numa coluna criaria mais um dado para manter em dia (e que aponta
 * silenciosamente para o lugar errado quando algo muda).
 */
function signupLink(appKey: string, planKey?: string) {
  const base = `${location.origin}/cadastro.html?app=${encodeURIComponent(appKey)}`
  return planKey ? `${base}&plano=${encodeURIComponent(planKey)}` : base
}

function CopyLink({ url, label }: { url: string; label: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <input
        readOnly value={url} onFocus={e => e.currentTarget.select()}
        style={{ ...inp, padding: '6px 9px', fontSize: 10, color: C.mut, flex: 1, minWidth: 0 }}
      />
      <button
        onClick={() => navigator.clipboard.writeText(url).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1600) })}
        title={`Copiar link — ${label}`}
        style={{ ...btnGhost, padding: '6px 10px', fontSize: 11, whiteSpace: 'nowrap' }}>
        {copiado ? '✓' : 'Copiar'}
      </button>
    </div>
  )
}

export function Catalog({ products, plans, reload }: {
  products: Product[]; plans: Plan[]; reload: () => void
}) {
  const [editProd, setEditProd] = useState<Product | 'new' | null>(null)
  const [editPlan, setEditPlan] = useState<Plan | 'new' | null>(null)
  const [dimsOf, setDimsOf] = useState<Product | null>(null)
  const [planProd, setPlanProd] = useState('')
  const [linkProd, setLinkProd] = useState<string | null>(null)
  const [dims, setDims] = useState<Dimension[]>([])

  const loadDims = useCallback(async () => {
    const { data } = await sb.from('saas_product_dimensions').select('*').order('sort_order')
    setDims((data ?? []) as Dimension[])
  }, [])
  useEffect(() => { loadDims() }, [loadDims])

  const activeProd = planProd || products[0]?.id || ''
  const prodPlans = plans.filter(p => p.product_id === activeProd).sort((a, b) => a.sort_order - b.sort_order)
  const dimsFor = (pid: string) => dims.filter(d => d.product_id === pid && d.active)

  return (
    <div>
      {/* ── Apps ── */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>🧩 Apps cadastrados</h2>
        <button style={btn} onClick={() => setEditProd('new')}>+ Novo app</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12, marginBottom: 30 }}>
        {products.length === 0 && <div style={{ color: C.mut, fontSize: 13 }}>Nenhum app cadastrado ainda.</div>}
        {products.map(p => {
          const n = plans.filter(pl => pl.product_id === p.id).length
          const nd = dimsFor(p.id).length
          return (
            <div key={p.id} style={{ background: C.card, border: `1px solid ${activeProd === p.id ? C.acc : C.brd}`, borderRadius: 14, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 15, flex: 1 }}>{p.name}</span>
                <Badge color={p.active ? C.grn : C.mut}>{p.active ? 'ATIVO' : 'INATIVO'}</Badge>
              </div>
              <div style={{ color: C.mut, fontSize: 12, marginBottom: 4 }}>chave: <code style={{ color: C.sub }}>{p.key}</code></div>
              {p.app_url && <div style={{ color: C.mut, fontSize: 11, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.app_url}</div>}
              <div style={{ color: C.sub, fontSize: 12, marginBottom: 12 }}>
                {n} plano{n !== 1 ? 's' : ''} · {nd} dimensõe{nd !== 1 ? 's' : 'm'}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...btnGhost, flex: 1, padding: '8px 0' }} onClick={() => setPlanProd(p.id)}>Ver planos</button>
                <button style={{ ...btnGhost, flex: 1, padding: '8px 0' }} onClick={() => setEditProd(p)}>Editar</button>
              </div>
              <button
                style={{ ...btnGhost, width: '100%', padding: '7px 0', marginTop: 8, fontSize: 12 }}
                onClick={() => setDimsOf(p)}>
                ⚙️ Dimensões dos planos
              </button>
              <button
                onClick={() => setLinkProd(linkProd === p.id ? null : p.id)}
                style={{ ...btnGhost, width: '100%', padding: '7px 0', marginTop: 8, borderColor: C.acc + '66', color: C.acc, fontSize: 12 }}>
                🔗 Link para página de vendas
              </button>

              {linkProd === p.id && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
                  <div style={{ color: C.mut, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>CADASTRO GERAL</div>
                  <CopyLink url={signupLink(p.key)} label="geral" />
                  {plans.filter(pl => pl.product_id === p.id && pl.active).length > 0 && (
                    <>
                      <div style={{ color: C.mut, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', marginTop: 12 }}>
                        POR PLANO <span style={{ fontWeight: 500 }}>(um anúncio por plano)</span>
                      </div>
                      {plans.filter(pl => pl.product_id === p.id && pl.active)
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map(pl => (
                          <div key={pl.id} style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 11, color: C.sub, fontWeight: 700 }}>{pl.name}</div>
                            <CopyLink url={signupLink(p.key, pl.key)} label={pl.name} />
                          </div>
                        ))}
                    </>
                  )}
                  <div style={{ color: C.mut, fontSize: 10, marginTop: 12, lineHeight: 1.5 }}>
                    Acrescente <code style={{ color: C.sub }}>&utm_source=meta&utm_campaign=nome</code> para
                    saber de qual anúncio veio cada assinante.
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Planos ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>💰 Planos & preços</h2>
        {products.length > 0 && (
          <select style={{ ...sel, width: 'auto', minWidth: 180, padding: '8px 10px', fontSize: 13 }} value={activeProd} onChange={e => setPlanProd(e.target.value)}>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <button style={btn} disabled={!activeProd} onClick={() => setEditPlan('new')}>+ Novo plano</button>
      </div>

      {activeProd && dimsFor(activeProd).length === 0 && (
        <div style={{ background: C.gold + '18', border: `1px solid ${C.gold}55`, color: C.gold, borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>
          ⚠️ Este app ainda não tem dimensões definidas — os planos ficariam sem limites nem recursos.
          Configure em <b>⚙️ Dimensões dos planos</b> no card do app.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {prodPlans.length === 0 && <div style={{ color: C.mut, fontSize: 13 }}>Este app ainda não tem planos.</div>}
        {prodPlans.map(p => {
          const ds = dimsFor(activeProd)
          return (
            <div key={p.id} style={{ background: C.card, border: `2px solid ${p.highlight ? C.acc : C.brd}`, borderRadius: 14, padding: 16, position: 'relative' }}>
              {p.highlight && <span style={{ position: 'absolute', top: -10, left: 14, background: C.acc, color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 10, padding: '2px 10px' }}>DESTAQUE</span>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 15, flex: 1 }}>{p.name}</span>
                <Badge color={p.active ? C.grn : C.mut}>{p.active ? 'ATIVO' : 'OFF'}</Badge>
              </div>
              <div style={{ margin: '8px 0' }}>
                <span style={{ fontSize: 24, fontWeight: 900 }}>{money(p.price_cents)}</span>
                <span style={{ color: C.mut, fontSize: 12 }}>/{p.billing_period === 'yearly' ? 'ano' : 'mês'}</span>
              </div>
              <div style={{ color: C.mut, fontSize: 11, marginBottom: 10 }}>
                chave <code style={{ color: C.sub }}>{p.key}</code> · trial {p.trial_days ?? 0}d · ordem {p.sort_order}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: 4 }}>
                {ds.filter(d => d.kind === 'limit').map(d => {
                  const v = p.limits?.[d.key]
                  return (
                    <li key={d.key} style={{ fontSize: 11, color: C.sub }}>
                      {d.label}: <b>{v == null ? 'ilimitado' : `${v}${d.unit ? ' ' + d.unit : ''}`}</b>
                      {!d.enforced && <span title="Definido mas não aplicado pelo app" style={{ color: C.gold, marginLeft: 4 }}>⚠</span>}
                    </li>
                  )
                })}
                {ds.filter(d => d.kind === 'feature' && p.features?.[d.key]).map(d => (
                  <li key={d.key} style={{ fontSize: 11, color: C.grn }}>
                    ✓ {d.label}
                    {!d.enforced && <span title="Definido mas não aplicado pelo app" style={{ color: C.gold, marginLeft: 4 }}>⚠</span>}
                  </li>
                ))}
              </ul>
              <button style={{ ...btnGhost, width: '100%', padding: '8px 0' }} onClick={() => setEditPlan(p)}>Editar plano</button>
            </div>
          )
        })}
      </div>

      {prodPlans.length > 0 && dimsFor(activeProd).some(d => !d.enforced) && (
        <div style={{ color: C.mut, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
          ⚠ = dimensão definida no plano mas <b>ainda não aplicada pelo app</b> — o cliente consegue
          usar além do contratado. Marque como “aplicada” só depois de implementar a checagem no produto.
        </div>
      )}

      {editProd && (
        <ProductForm product={editProd === 'new' ? null : editProd} onClose={() => setEditProd(null)} onSaved={() => { setEditProd(null); reload() }} />
      )}
      {dimsOf && (
        <DimensionsModal product={dimsOf} dims={dims.filter(d => d.product_id === dimsOf.id)} onClose={() => setDimsOf(null)} onChanged={loadDims} />
      )}
      {editPlan && (
        <PlanForm
          plan={editPlan === 'new' ? null : editPlan}
          productId={activeProd}
          dims={dimsFor(activeProd)}
          nextSort={prodPlans.length ? Math.max(...prodPlans.map(p => p.sort_order)) + 1 : 1}
          onClose={() => setEditPlan(null)}
          onSaved={() => { setEditPlan(null); reload() }}
        />
      )}
    </div>
  )
}

// ─────────────────────────── DIMENSÕES ───────────────────────────
function DimensionsModal({ product, dims, onClose, onChanged }: {
  product: Product; dims: Dimension[]; onClose: () => void; onChanged: () => void
}) {
  const [novo, setNovo] = useState<{ kind: 'limit' | 'feature'; label: string; key: string; unit: string }>({
    kind: 'limit', label: '', key: '', unit: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function add() {
    if (!novo.label.trim() || !novo.key.trim()) { setErr('Preencha rótulo e chave.'); return }
    setBusy(true); setErr('')
    const { error } = await sb.from('saas_product_dimensions').insert({
      product_id: product.id, kind: novo.kind,
      key: novo.key.trim(), label: novo.label.trim(),
      unit: novo.kind === 'limit' ? (novo.unit.trim() || null) : null,
      sort_order: (dims.length ? Math.max(...dims.map(d => d.sort_order)) : 0) + 1,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setNovo({ kind: 'limit', label: '', key: '', unit: '' })
    onChanged()
  }

  async function toggleEnforced(d: Dimension) {
    await sb.from('saas_product_dimensions').update({ enforced: !d.enforced }).eq('id', d.id)
    onChanged()
  }

  async function remove(d: Dimension) {
    if (!confirm(`Remover "${d.label}"? Os planos mantêm o valor gravado, mas ele deixa de aparecer.`)) return
    await sb.from('saas_product_dimensions').delete().eq('id', d.id)
    onChanged()
  }

  const lista = [...dims].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <Modal title={`Dimensões · ${product.name}`} onClose={onClose} wide>
      <div style={{ color: C.mut, fontSize: 12, marginBottom: 16, lineHeight: 1.55 }}>
        São as réguas que os planos deste app preenchem. Cada app tem as suas —
        um app de academia teria “alunos ativos”, não “eventos por mês”.
        A <b>chave</b> é o que o código do app lê (<code style={{ color: C.sub }}>plan.limits.max_alunos</code>).
      </div>

      {lista.length === 0 && <Empty>Nenhuma dimensão ainda.</Empty>}
      {lista.map(d => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: `1px solid ${C.brd}55` }}>
          <Badge color={d.kind === 'limit' ? C.acc : C.vio}>{d.kind === 'limit' ? 'LIMITE' : 'RECURSO'}</Badge>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{d.label}</div>
            <div style={{ color: C.mut, fontSize: 11 }}>
              <code>{d.key}</code>{d.unit ? ` · ${d.unit}` : ''}
            </div>
          </div>
          <button
            onClick={() => toggleEnforced(d)}
            title={d.enforced ? 'O app aplica esta régua' : 'Definida mas NÃO aplicada — cliente usa além do contratado'}
            style={{
              ...btnGhost, padding: '4px 10px', fontSize: 11, whiteSpace: 'nowrap',
              borderColor: (d.enforced ? C.grn : C.gold) + '77', color: d.enforced ? C.grn : C.gold,
            }}>
            {d.enforced ? '✓ aplicada' : '⚠ não aplicada'}
          </button>
          <button onClick={() => remove(d)} style={{ background: 'transparent', border: 'none', color: C.mut, cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      ))}

      <div style={{ borderTop: `1px solid ${C.brd}`, marginTop: 16, paddingTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 10 }}>Nova dimensão</div>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 10 }}>
          <Field label="Tipo">
            <select style={{ ...inp, padding: '11px 8px' }} value={novo.kind}
              onChange={e => setNovo(s => ({ ...s, kind: e.target.value as 'limit' | 'feature' }))}>
              <option value="limit">Limite</option>
              <option value="feature">Recurso</option>
            </select>
          </Field>
          <Field label="Rótulo">
            <input style={inp} value={novo.label} placeholder={novo.kind === 'limit' ? 'Alunos ativos' : 'Treino online'}
              onChange={e => setNovo(s => ({ ...s, label: e.target.value, key: s.key || slug(e.target.value) }))} />
          </Field>
          <Field label="Chave (código)">
            <input style={inp} value={novo.key} placeholder={novo.kind === 'limit' ? 'max_alunos' : 'treino_online'}
              onChange={e => setNovo(s => ({ ...s, key: slug(e.target.value) }))} />
          </Field>
        </div>
        {novo.kind === 'limit' && (
          <Field label="Unidade (opcional)">
            <input style={inp} value={novo.unit} placeholder="alunos" onChange={e => setNovo(s => ({ ...s, unit: e.target.value }))} />
          </Field>
        )}
        {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 8 }}>⚠️ {err}</div>}
        <button style={{ ...btn, width: '100%' }} disabled={busy} onClick={add}>{busy ? 'Adicionando…' : '+ Adicionar dimensão'}</button>
      </div>

      <button style={{ ...btnGhost, width: '100%', marginTop: 16 }} onClick={onClose}>Fechar</button>
    </Modal>
  )
}

// ─────────────────────────── APP ───────────────────────────
function ProductForm({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name ?? '')
  const [key, setKey] = useState(product?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(!!product)
  const [appUrl, setAppUrl] = useState(product?.app_url ?? '')
  const [desc, setDesc] = useState(product?.description ?? '')
  const [active, setActive] = useState(product?.active ?? true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!name.trim() || !key.trim()) { setErr('Nome e chave são obrigatórios.'); return }
    setBusy(true); setErr('')
    const payload = { name: name.trim(), key: key.trim(), app_url: appUrl.trim() || null, description: desc.trim() || null, active }
    const res = product
      ? await sb.from('saas_products').update(payload).eq('id', product.id)
      : await sb.from('saas_products').insert(payload)
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }

  return (
    <Modal title={product ? 'Editar app' : 'Novo app'} onClose={onClose}>
      <Field label="Nome do app">
        <input style={inp} value={name} onChange={e => { setName(e.target.value); if (!keyTouched) setKey(slug(e.target.value)) }} placeholder="Ex.: NightPass" />
      </Field>
      <Field
        label="Chave (slug único — usado no código)"
        hint={product ? 'A chave não pode mudar depois de criada (assinaturas e links dependem dela).' : undefined}>
        <input style={inp} value={key} onChange={e => { setKey(slug(e.target.value)); setKeyTouched(true) }} placeholder="nightpass" disabled={!!product} />
      </Field>
      <Field label="URL do app (opcional)">
        <input style={inp} value={appUrl} onChange={e => setAppUrl(e.target.value)} placeholder="https://meu-app.vercel.app" />
      </Field>
      <Field label="Descrição (aparece na página de cadastro)">
        <input style={inp} value={desc} onChange={e => setDesc(e.target.value)} />
      </Field>
      <Toggle label="App ativo (aceita novos cadastros)" checked={active} onChange={setActive} />
      {!product && (
        <div style={{ background: C.acc + '15', border: `1px solid ${C.acc}44`, borderRadius: 10, padding: '10px 12px', fontSize: 12, color: C.sub, marginTop: 12, lineHeight: 1.5 }}>
          Depois de salvar, configure as <b>Dimensões dos planos</b> deste app — é o que define
          quais limites e recursos os planos dele vão ter.
        </div>
      )}
      {err && <div style={{ color: C.red, fontSize: 13, marginTop: 10 }}>⚠️ {err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button style={{ ...btnGhost, flex: 1 }} onClick={onClose}>Cancelar</button>
        <button style={{ ...btn, flex: 1 }} disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </Modal>
  )
}

// ─────────────────────────── PLANO ───────────────────────────
function PlanForm({ plan, productId, dims, nextSort, onClose, onSaved }: {
  plan: Plan | null; productId: string; dims: Dimension[]; nextSort: number
  onClose: () => void; onSaved: () => void
}) {
  const limitDims = dims.filter(d => d.kind === 'limit').sort((a, b) => a.sort_order - b.sort_order)
  const featureDims = dims.filter(d => d.kind === 'feature').sort((a, b) => a.sort_order - b.sort_order)

  const [name, setName] = useState(plan?.name ?? '')
  const [key, setKey] = useState(plan?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(!!plan)
  const [desc, setDesc] = useState(plan?.description ?? '')
  const [price, setPrice] = useState(plan ? reaisFromCents(plan.price_cents) : '')
  const [period, setPeriod] = useState(plan?.billing_period ?? 'monthly')
  const [trial, setTrial] = useState(String(plan?.trial_days ?? 14))
  const [sort, setSort] = useState(String(plan?.sort_order ?? nextSort))
  const [highlight, setHighlight] = useState(plan?.highlight ?? false)
  const [active, setActive] = useState(plan?.active ?? true)
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(limitDims.map(d => [d.key, plan?.limits?.[d.key] == null ? '' : String(plan?.limits?.[d.key])])))
  const [features, setFeatures] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(featureDims.map(d => [d.key, !!plan?.features?.[d.key]])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    if (!name.trim() || !key.trim()) { setErr('Nome e chave são obrigatórios.'); return }
    setBusy(true); setErr('')
    const payload = {
      product_id: productId,
      name: name.trim(), key: key.trim(), description: desc.trim() || null,
      price_cents: centsFromReais(price), billing_period: period,
      trial_days: Number(trial) || 0, sort_order: Number(sort) || 0,
      highlight, active,
      // Só grava as chaves declaradas pelo produto — sem lixo de dimensão removida
      limits: Object.fromEntries(limitDims.map(d => [d.key, numOrNull(limits[d.key] ?? '')])),
      features: Object.fromEntries(featureDims.map(d => [d.key, !!features[d.key]])),
    }
    const res = plan
      ? await sb.from('saas_plans').update(payload).eq('id', plan.id)
      : await sb.from('saas_plans').insert(payload)
    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }

  return (
    <Modal title={plan ? 'Editar plano' : 'Novo plano'} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Nome do plano">
          <input style={inp} value={name} onChange={e => { setName(e.target.value); if (!keyTouched) setKey(slug(e.target.value)) }} placeholder="Profissional" />
        </Field>
        <Field label="Chave (slug)">
          <input style={inp} value={key} onChange={e => { setKey(slug(e.target.value)); setKeyTouched(true) }} placeholder="profissional" disabled={!!plan} />
        </Field>
        <Field label="Preço (R$)">
          <input style={inp} value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="197,00" />
        </Field>
        <Field label="Cobrança">
          <select style={{ ...inp, padding: '11px 10px' }} value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="monthly">Mensal</option>
            <option value="yearly">Anual</option>
          </select>
        </Field>
        <Field label="Trial (dias)">
          <input style={inp} value={trial} onChange={e => setTrial(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Ordem de exibição">
          <input style={inp} value={sort} onChange={e => setSort(e.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Descrição (opcional)">
        <input style={inp} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Para casas em crescimento" />
      </Field>

      {dims.length === 0 && (
        <div style={{ background: C.gold + '18', border: `1px solid ${C.gold}55`, color: C.gold, borderRadius: 10, padding: '10px 12px', fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
          ⚠️ Este app ainda não tem dimensões. O plano será salvo só com preço —
          configure as dimensões no card do app para definir limites e recursos.
        </div>
      )}

      {limitDims.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, margin: '16px 0 8px' }}>
            Limites <span style={{ color: C.mut, fontWeight: 500 }}>(vazio = ilimitado)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {limitDims.map(d => (
              <Field key={d.key} label={d.label + (d.unit ? ` (${d.unit})` : '')}>
                <input style={inp} value={limits[d.key] ?? ''} inputMode="numeric" placeholder="ilimitado"
                  onChange={e => setLimits(l => ({ ...l, [d.key]: e.target.value }))} />
              </Field>
            ))}
          </div>
        </>
      )}

      {featureDims.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.sub, margin: '16px 0 8px' }}>Recursos liberados</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {featureDims.map(d => (
              <Toggle key={d.key} label={d.label} checked={!!features[d.key]}
                onChange={v => setFeatures(s => ({ ...s, [d.key]: v }))} />
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 16 }}>
        <Toggle label="Plano em destaque" checked={highlight} onChange={setHighlight} />
        <Toggle label="Plano ativo" checked={active} onChange={setActive} />
      </div>

      {err && <div style={{ color: C.red, fontSize: 13, marginTop: 10 }}>⚠️ {err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button style={{ ...btnGhost, flex: 1 }} onClick={onClose}>Cancelar</button>
        <button style={{ ...btn, flex: 1 }} disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar plano'}</button>
      </div>
    </Modal>
  )
}
