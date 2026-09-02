import { useState, useMemo } from 'react'
import { sb } from '../lib/supabase'
import { C, inp, btn, btnGhost, sel, card, STATUS_LABEL, STATUS_COLOR } from '../theme'
import { Modal, Field, Empty, Badge } from '../components/ui'
import { money, fdate, fmtDoc, fmtPhone, onlyDigits, effective } from '../format'
import type { Customer, Sub, Product } from '../types'

/**
 * Controle de clientes da plataforma.
 * Um cliente pode assinar VÁRIOS produtos — a ficha mostra todas as assinaturas dele.
 */
export function Customers({ customers, subs, products, reload }: {
  customers: Customer[]; subs: Sub[]; products: Product[]; reload: () => void
}) {
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Customer | 'new' | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const subsByCustomer = useMemo(() => {
    const m = new Map<string, Sub[]>()
    subs.forEach(s => {
      const arr = m.get(s.customer_id) ?? []
      arr.push(s)
      m.set(s.customer_id, arr)
    })
    return m
  }, [subs])

  const visible = customers.filter(c => {
    if (!q) return true
    const t = q.toLowerCase()
    return c.name.toLowerCase().includes(t)
      || (c.trade_name ?? '').toLowerCase().includes(t)
      || (c.email ?? '').toLowerCase().includes(t)
      || onlyDigits(c.doc ?? '').includes(onlyDigits(q))
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>👥 Clientes</h2>
        <span style={{ color: C.mut, fontSize: 12 }}>{customers.length} cadastrado{customers.length !== 1 ? 's' : ''}</span>
        <div style={{ flex: 1 }} />
        <button style={btn} onClick={() => setEdit('new')}>+ Novo cliente</button>
      </div>

      <input
        style={{ ...inp, marginBottom: 14 }}
        placeholder="🔍 Buscar por nome, e-mail ou CNPJ/CPF…"
        value={q}
        onChange={e => setQ(e.target.value)}
      />

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {visible.length === 0 && <Empty>Nenhum cliente encontrado.</Empty>}
        {visible.map(c => {
          const mine = subsByCustomer.get(c.id) ?? []
          const isOpen = open === c.id
          const mrr = mine
            .filter(s => ['active', 'trialing'].includes(effective(s)))
            .reduce((t, s) => t + (s.saas_plans?.price_cents ?? 0), 0)

          return (
            <div key={c.id} style={{ borderTop: `1px solid ${C.brd}55` }}>
              <div
                onClick={() => setOpen(isOpen ? null : c.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: 'pointer' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {c.name}
                    {c.status === 'inactive' && <Badge color={C.mut}>INATIVO</Badge>}
                  </div>
                  <div style={{ color: C.mut, fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[c.doc && fmtDoc(c.doc), c.email, c.phone && fmtPhone(c.phone), c.city].filter(Boolean).join(' · ') || 'sem dados de contato'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ color: mine.length ? C.txt : C.mut, fontSize: 12, fontWeight: 700 }}>
                    {mine.length} app{mine.length !== 1 ? 's' : ''}
                  </div>
                  {mrr > 0 && <div style={{ color: C.grn, fontSize: 11, fontWeight: 700 }}>{money(mrr)}/mês</div>}
                </div>
                <span style={{ color: C.mut, fontSize: 12, flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
              </div>

              {isOpen && (
                <div style={{ padding: '0 16px 16px', background: C.bg + '55' }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <button style={{ ...btnGhost, padding: '7px 14px' }} onClick={() => setEdit(c)}>✏️ Editar cadastro</button>
                    {c.phone && (
                      <a
                        href={`https://wa.me/${onlyDigits(c.phone).length <= 11 ? '55' + onlyDigits(c.phone) : onlyDigits(c.phone)}`}
                        target="_blank" rel="noreferrer"
                        style={{ ...btnGhost, padding: '7px 14px', textDecoration: 'none', display: 'inline-block' }}>
                        💬 WhatsApp
                      </a>
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>ASSINATURAS</div>
                  {mine.length === 0 && <div style={{ color: C.mut, fontSize: 12, paddingBottom: 8 }}>Este cliente ainda não assina nenhum app.</div>}
                  {mine.map(s => {
                    const eff = effective(s)
                    const color = STATUS_COLOR[eff] ?? C.mut
                    const prod = products.find(p => p.id === s.product_id)
                    return (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${C.brd}44`, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, minWidth: 120 }}>{prod?.name ?? '— sem produto —'}</span>
                        <Badge color={color}>{STATUS_LABEL[eff] ?? eff}</Badge>
                        <span style={{ color: C.sub, fontSize: 12 }}>
                          {s.saas_plans ? `${s.saas_plans.name} · ${money(s.saas_plans.price_cents)}` : '—'}
                        </span>
                        <div style={{ flex: 1 }} />
                        <span style={{ color: C.mut, fontSize: 11 }}>
                          {s.status === 'trialing' && s.trial_ends_at
                            ? `Trial até ${fdate(s.trial_ends_at)}`
                            : s.current_period_end ? `Renova ${fdate(s.current_period_end)}` : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {edit && (
        <CustomerForm
          customer={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); reload() }}
        />
      )}
    </div>
  )
}

function CustomerForm({ customer, onClose, onSaved }: {
  customer: Customer | null; onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState({
    name: customer?.name ?? '',
    trade_name: customer?.trade_name ?? '',
    doc: customer?.doc ?? '',
    email: customer?.email ?? '',
    phone: customer?.phone ?? '',
    address: customer?.address ?? '',
    city: customer?.city ?? '',
    state: customer?.state ?? '',
    zip: customer?.zip ?? '',
    billing_day: String(customer?.billing_day ?? 10),
    status: customer?.status ?? 'active',
    notes: customer?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f, v: string) => setF(s => ({ ...s, [k]: v }))

  async function save() {
    if (!f.name.trim()) { setErr('O nome do cliente é obrigatório.'); return }
    const day = Number(f.billing_day)
    if (!Number.isFinite(day) || day < 1 || day > 28) {
      setErr('O dia de vencimento deve ficar entre 1 e 28 (evita meses sem dia 29/30/31).')
      return
    }
    setBusy(true); setErr('')

    const doc = onlyDigits(f.doc)
    const payload = {
      name: f.name.trim(),
      trade_name: f.trade_name.trim() || null,
      doc: doc || null,
      doc_type: doc ? (doc.length === 14 ? 'cnpj' : doc.length === 11 ? 'cpf' : null) : null,
      email: f.email.trim() || null,
      phone: onlyDigits(f.phone) || null,
      address: f.address.trim() || null,
      city: f.city.trim() || null,
      state: f.state.trim().toUpperCase() || null,
      zip: onlyDigits(f.zip) || null,
      billing_day: day,
      status: f.status,
      notes: f.notes.trim() || null,
    }

    const res = customer
      ? await sb.from('saas_customers').update(payload).eq('id', customer.id)
      : await sb.from('saas_customers').insert(payload)

    setBusy(false)
    if (res.error) { setErr(res.error.message); return }
    onSaved()
  }

  return (
    <Modal title={customer ? 'Editar cliente' : 'Novo cliente'} onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <Field label="Nome / Razão social *">
          <input style={inp} value={f.name} onChange={e => set('name', e.target.value)} placeholder="Vila Beats Entretenimento LTDA" />
        </Field>
        <Field label="CNPJ / CPF">
          <input style={inp} value={f.doc} onChange={e => set('doc', e.target.value)} placeholder="00.000.000/0000-00" />
        </Field>
      </div>

      <Field label="Nome fantasia">
        <input style={inp} value={f.trade_name} onChange={e => set('trade_name', e.target.value)} placeholder="Vila Beats" />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="E-mail">
          <input style={inp} value={f.email} onChange={e => set('email', e.target.value)} type="email" />
        </Field>
        <Field label="WhatsApp (cobrança)" hint="É por aqui que a régua de cobrança vai falar com o cliente.">
          <input style={inp} value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="11954241297" />
        </Field>
      </div>

      <Field label="Endereço">
        <input style={inp} value={f.address} onChange={e => set('address', e.target.value)} />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <Field label="Cidade">
          <input style={inp} value={f.city} onChange={e => set('city', e.target.value)} />
        </Field>
        <Field label="UF">
          <input style={inp} value={f.state} onChange={e => set('state', e.target.value)} maxLength={2} />
        </Field>
        <Field label="CEP">
          <input style={inp} value={f.zip} onChange={e => set('zip', e.target.value)} />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Dia de vencimento" hint="1 a 28.">
          <input style={inp} value={f.billing_day} onChange={e => set('billing_day', e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Situação">
          <select style={{ ...sel, ...inp, padding: '11px 10px' }} value={f.status} onChange={e => set('status', e.target.value)}>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </Field>
      </div>

      <Field label="Observações">
        <input style={inp} value={f.notes} onChange={e => set('notes', e.target.value)} />
      </Field>

      {err && <div style={{ color: C.red, fontSize: 13, marginTop: 10 }}>⚠️ {err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button style={{ ...btnGhost, flex: 1 }} onClick={onClose}>Cancelar</button>
        <button style={{ ...btn, flex: 1 }} disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar cliente'}</button>
      </div>
    </Modal>
  )
}
