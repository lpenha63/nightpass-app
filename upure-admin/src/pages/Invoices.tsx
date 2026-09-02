import { useState, useMemo } from 'react'
import { sb } from '../lib/supabase'
import { C, inp, btn, btnGhost, sel, card } from '../theme'
import { Kpi, Pill, Badge, Empty, Modal, Field } from '../components/ui'
import { money, fdate, reaisFromCents, centsFromReais } from '../format'
import type { Invoice, Product, Customer } from '../types'

const INV_LABEL: Record<string, string> = {
  open: 'Em aberto', paid: 'Paga', overdue: 'Vencida', canceled: 'Cancelada', void: 'Anulada',
}
const INV_COLOR: Record<string, string> = {
  open: C.gold, paid: C.grn, overdue: C.red, canceled: C.mut, void: C.mut,
}
const METHOD_LABEL: Record<string, string> = {
  card_recurring: 'Cartão recorrente', pix: 'PIX', boleto: 'Boleto', manual: 'Manual',
}

const GRID = '1fr 110px 110px 110px 150px'
const competenceLabel = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })

export function Invoices({ invoices, products, customers, reload }: {
  invoices: Invoice[]; products: Product[]; customers: Customer[]; reload: () => void
}) {
  const [filter, setFilter] = useState<'all' | 'open' | 'overdue' | 'paid'>('all')
  const [prodSel, setProdSel] = useState('all')
  const [q, setQ] = useState('')
  const [pay, setPay] = useState<Invoice | null>(null)
  const [charge, setCharge] = useState<Invoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const custName = useMemo(() => {
    const m = new Map(customers.map(c => [c.id, c.name]))
    return (id: string) => m.get(id) ?? '—'
  }, [customers])

  const visible = invoices
    .filter(i => prodSel === 'all' || i.product_id === prodSel)
    .filter(i => filter === 'all'
      || (filter === 'open' && i.status === 'open')
      || (filter === 'overdue' && i.status === 'overdue')
      || (filter === 'paid' && i.status === 'paid'))
    .filter(i => !q || custName(i.customer_id).toLowerCase().includes(q.toLowerCase()))

  const openTotal = invoices.filter(i => i.status === 'open').reduce((t, i) => t + i.amount_cents - i.discount_cents, 0)
  const overdueTotal = invoices.filter(i => i.status === 'overdue').reduce((t, i) => t + i.amount_cents - i.discount_cents, 0)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const paidMonth = invoices
    .filter(i => i.status === 'paid' && (i.paid_at ?? '').slice(0, 7) === thisMonth)
    .reduce((t, i) => t + (i.paid_amount_cents ?? i.amount_cents), 0)

  async function generate() {
    setBusy(true); setMsg('')
    const { data, error } = await sb.rpc('saas_generate_invoices')
    setBusy(false)
    setMsg(error ? `Erro: ${error.message}` : `${data ?? 0} fatura(s) gerada(s) para este mês.`)
    if (!error) reload()
  }

  async function markOverdue() {
    setBusy(true); setMsg('')
    const { data, error } = await sb.rpc('saas_mark_overdue')
    setBusy(false)
    setMsg(error ? `Erro: ${error.message}` : `${data ?? 0} fatura(s) marcada(s) como vencida(s).`)
    if (!error) reload()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800 }}>🧾 Mensalidades</h2>
        <div style={{ flex: 1 }} />
        <button style={btnGhost} disabled={busy} onClick={markOverdue}>Marcar vencidas</button>
        <button style={btn} disabled={busy} onClick={generate}>+ Gerar faturas do mês</button>
      </div>

      {msg && (
        <div style={{ background: C.acc + '18', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 10, padding: '9px 14px', fontSize: 13, marginBottom: 14 }}>
          {msg}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
        <Kpi label="Em aberto" val={money(openTotal)} color={C.gold} />
        <Kpi label="Vencido" val={money(overdueTotal)} color={C.red} />
        <Kpi label="Recebido no mês" val={money(paidMonth)} color={C.grn} />
        <Kpi label="Faturas" val={String(invoices.length)} color={C.acc} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Pill active={filter === 'all'} onClick={() => setFilter('all')}>Todas</Pill>
        <Pill active={filter === 'open'} onClick={() => setFilter('open')}>Em aberto</Pill>
        <Pill active={filter === 'overdue'} onClick={() => setFilter('overdue')}>Vencidas</Pill>
        <Pill active={filter === 'paid'} onClick={() => setFilter('paid')}>Pagas</Pill>
        {products.length > 1 && (
          <select style={{ ...sel, width: 'auto', minWidth: 150, padding: '8px 10px', fontSize: 13 }} value={prodSel} onChange={e => setProdSel(e.target.value)}>
            <option value="all">Todos os apps</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      <input style={{ ...inp, marginBottom: 14 }} placeholder="🔍 Buscar por cliente…" value={q} onChange={e => setQ(e.target.value)} />

      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ minWidth: 720 }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '4px 8px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em' }}>
            <div>CLIENTE / APP</div><div>COMPETÊNCIA</div><div>VENCIMENTO</div><div>VALOR</div><div>SITUAÇÃO</div>
          </div>
          {visible.length === 0 && <Empty>Nenhuma fatura encontrada.</Empty>}
          {visible.map(i => {
            const color = INV_COLOR[i.status] ?? C.mut
            const prod = products.find(p => p.id === i.product_id)
            const total = i.amount_cents - i.discount_cents
            const payable = i.status === 'open' || i.status === 'overdue'
            return (
              <div key={i.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '11px 8px', borderTop: `1px solid ${C.brd}55`, alignItems: 'center', fontSize: 13 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{custName(i.customer_id)}</div>
                  <div style={{ color: C.mut, fontSize: 11 }}>{prod?.name ?? '—'}{i.method ? ` · ${METHOD_LABEL[i.method] ?? i.method}` : ''}</div>
                </div>
                <div style={{ color: C.sub, fontSize: 12 }}>{competenceLabel(i.competence)}</div>
                <div style={{ color: i.status === 'overdue' ? C.red : C.sub, fontSize: 12 }}>{fdate(i.due_date)}</div>
                <div style={{ fontWeight: 700 }}>{money(total)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Badge color={color}>{INV_LABEL[i.status] ?? i.status}</Badge>
                  {payable && (
                    <>
                      <button
                        onClick={() => setCharge(i)}
                        style={{ ...btnGhost, padding: '4px 10px', fontSize: 11, borderColor: C.acc + '77', color: C.acc }}>
                        Cobrar
                      </button>
                      <button
                        onClick={() => setPay(i)}
                        style={{ ...btnGhost, padding: '4px 10px', fontSize: 11, borderColor: C.grn + '77', color: C.grn }}>
                        Dar baixa
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {pay && (
        <PayModal
          invoice={pay}
          customerName={custName(pay.customer_id)}
          onClose={() => setPay(null)}
          onDone={() => { setPay(null); reload() }}
        />
      )}
      {charge && (
        <ChargeModal
          invoice={charge}
          customerName={custName(charge.customer_id)}
          onClose={() => setCharge(null)}
          onDone={reload}
        />
      )}
    </div>
  )
}

/** Gera cobrança avulsa (PIX/boleto) no Mercado Pago para a fatura. */
function ChargeModal({ invoice, customerName, onClose, onDone }: {
  invoice: Invoice; customerName: string; onClose: () => void; onDone: () => void
}) {
  const [method, setMethod] = useState<'pix' | 'boleto'>('pix')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState<{ pix_copia_cola?: string | null; boleto_url?: string | null; boleto_barcode?: string | null; checkout_url?: string | null } | null>(
    invoice.pix_copia_cola || invoice.boleto_url
      ? { pix_copia_cola: invoice.pix_copia_cola, boleto_url: invoice.boleto_url, checkout_url: invoice.checkout_url }
      : null,
  )
  const [copiado, setCopiado] = useState(false)
  const due = invoice.amount_cents - invoice.discount_cents

  async function gerar() {
    setBusy(true); setErr('')
    const { data, error } = await sb.functions.invoke('saas-invoice-charge', {
      body: { invoice_id: invoice.id, method },
    })
    setBusy(false)
    if (error || data?.error) { setErr(data?.error ?? error?.message ?? 'Falha ao gerar a cobrança'); return }
    setRes(data)
    onDone()
  }

  function copiar(txt: string) {
    navigator.clipboard.writeText(txt).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1800) })
  }

  return (
    <Modal title="Gerar cobrança" onClose={onClose}>
      <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700 }}>{customerName}</div>
        <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
          {competenceLabel(invoice.competence)} · vence {fdate(invoice.due_date)} · <b style={{ color: C.txt }}>{money(due)}</b>
        </div>
      </div>

      {!res && (
        <>
          <Field label="Forma de cobrança">
            <div style={{ display: 'flex', gap: 8 }}>
              <Pill active={method === 'pix'} onClick={() => setMethod('pix')}>PIX</Pill>
              <Pill active={method === 'boleto'} onClick={() => setMethod('boleto')}>Boleto</Pill>
            </div>
          </Field>
          <div style={{ color: C.mut, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
            O cliente precisa ter e-mail cadastrado{method === 'boleto' ? ' e CPF/CNPJ válido' : ''}.
            A fatura é quitada automaticamente quando o Mercado Pago confirmar o pagamento.
          </div>
        </>
      )}

      {res && (
        <div style={{ display: 'grid', gap: 10 }}>
          {res.pix_copia_cola && (
            <Field label="PIX copia e cola">
              <textarea readOnly style={{ ...inp, minHeight: 92, fontSize: 11, resize: 'vertical' }} value={res.pix_copia_cola} />
              <button style={{ ...btnGhost, width: '100%', marginTop: 6 }} onClick={() => copiar(res.pix_copia_cola!)}>
                {copiado ? '✓ Copiado' : 'Copiar código'}
              </button>
            </Field>
          )}
          {res.boleto_url && (
            <a href={res.boleto_url} target="_blank" rel="noreferrer" style={{ ...btn, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Abrir boleto
            </a>
          )}
          {res.checkout_url && !res.boleto_url && (
            <a href={res.checkout_url} target="_blank" rel="noreferrer" style={{ ...btnGhost, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              Abrir página de pagamento
            </a>
          )}
        </div>
      )}

      {err && <div style={{ color: C.red, fontSize: 13, marginTop: 10 }}>⚠️ {err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button style={{ ...btnGhost, flex: 1 }} onClick={onClose}>Fechar</button>
        {!res && <button style={{ ...btn, flex: 1 }} disabled={busy} onClick={gerar}>{busy ? 'Gerando…' : 'Gerar cobrança'}</button>}
      </div>
    </Modal>
  )
}

/** Baixa manual — chama a RPC atômica (registra pagamento + quita + estende assinatura + audita). */
function PayModal({ invoice, customerName, onClose, onDone }: {
  invoice: Invoice; customerName: string; onClose: () => void; onDone: () => void
}) {
  const due = invoice.amount_cents - invoice.discount_cents
  const [amount, setAmount] = useState(reaisFromCents(due))
  const [method, setMethod] = useState<'pix' | 'boleto' | 'manual'>('pix')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function confirm() {
    setBusy(true); setErr('')
    const { error } = await sb.rpc('saas_pay_invoice_manual', {
      p_invoice: invoice.id,
      p_amount_cents: centsFromReais(amount),
      p_method: method,
      p_notes: notes.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    onDone()
  }

  return (
    <Modal title="Dar baixa na fatura" onClose={onClose}>
      <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700 }}>{customerName}</div>
        <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
          {competenceLabel(invoice.competence)} · vence {fdate(invoice.due_date)} · <b style={{ color: C.txt }}>{money(due)}</b>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Valor recebido (R$)">
          <input style={inp} value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Forma de pagamento">
          <select style={{ ...inp, padding: '11px 10px' }} value={method} onChange={e => setMethod(e.target.value as typeof method)}>
            <option value="pix">PIX</option>
            <option value="boleto">Boleto</option>
            <option value="manual">Outro (transferência/dinheiro)</option>
          </select>
        </Field>
      </div>
      <Field label="Observação (opcional)">
        <input style={inp} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex.: PIX recebido em 30/07" />
      </Field>

      <div style={{ color: C.mut, fontSize: 11, marginTop: 4 }}>
        A assinatura será reativada e o período estendido em 30 dias.
      </div>

      {err && <div style={{ color: C.red, fontSize: 13, marginTop: 10 }}>⚠️ {err}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button style={{ ...btnGhost, flex: 1 }} onClick={onClose}>Cancelar</button>
        <button style={{ ...btn, flex: 1, background: C.grn }} disabled={busy} onClick={confirm}>
          {busy ? 'Registrando…' : 'Confirmar pagamento'}
        </button>
      </div>
    </Modal>
  )
}
