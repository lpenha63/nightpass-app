import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fmtCurrency } from '../utils/format'
import QRCode from 'react-qr-code'
import { NightPassBar } from './TicketPublic'
import type { Event, TicketBatch, TicketOrder, Ticket } from '../types'

const C = {
  bg: '#0a0e1a', card: '#111827', brd: '#1e2736',
  acc: '#3b82f6', grn: '#10b981', red: '#f87171',
  gold: '#f59e0b', txt: '#f9fafb', mut: '#6b7280', sub: '#9ca3af',
}

const STATUS_ORDER: Record<TicketOrder['payment_status'], { label: string; color: string }> = {
  pending:   { label: '⏳ Aguardando pagamento', color: C.gold },
  paid:      { label: '✅ Pago e confirmado!',   color: C.grn },
  cancelled: { label: '❌ Cancelado',            color: C.red },
}

const GENDER_LABEL: Record<string, string> = { male: '♂ Masculino', female: '♀ Feminino', both: 'Misto' }

interface EventWithHouse extends Event {
  houses?: { name: string; pix_key?: string; pix_holder?: string }
}
interface BatchWithAvail extends TicketBatch { available: number }

/** ***.456.789-** — o suficiente para a portaria conferir sem expor o documento inteiro */
function maskCpf(cpf: string) {
  const d = cpf.replace(/\D/g, '')
  if (d.length < 11) return cpf
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
}

type PayResult =
  | { mode: 'free';     order_id: string }
  | { mode: 'manual';   order_id: string; amount_cents: number; pix_key?: string; pix_holder?: string }
  | { mode: 'mp';       order_id: string; amount_cents: number; qr_code?: string; qr_code_base64?: string }
  | { mode: 'checkout'; order_id: string; amount_cents: number; service_fee_cents: number; init_point: string }

/** Taxa de serviço por unidade, em centavos */
function taxaUnit(b: { price_cents: number; service_fee_pct?: number | null }) {
  return Math.round(b.price_cents * Number(b.service_fee_pct ?? 0) / 100)
}

export function EventPublicPage({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<EventWithHouse | null>(null)
  const [batches, setBatches] = useState<BatchWithAvail[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [selBatch, setSelBatch] = useState<BatchWithAvail | null>(null)
  const [qty, setQty] = useState(1)
  const [form, setForm] = useState({ name: '', cpf: '', phone: '', email: '' })
  const [nomes, setNomes] = useState<string[]>([])   // ingresso nominal: um nome por unidade
  const [step, setStep] = useState<'select' | 'form' | 'pix' | 'done'>('select')
  const [submitting, setSubmitting] = useState(false)
  const [payResult, setPayResult] = useState<PayResult | null>(null)
  const [order, setOrder] = useState<TicketOrder | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    supabase.from('events').select('*,houses(name,pix_key,pix_holder)').eq('id', eventId).single()
      .then(r => {
        if (r.error || !r.data) { setNotFound(true); setLoading(false); return }
        setEvent(r.data as EventWithHouse)
        document.title = `NightPass Tickets — ${(r.data as EventWithHouse).name}`
        return supabase.from('ticket_batches').select('*').eq('event_id', eventId).eq('active', true).order('price_cents')
      })
      .then(r => {
        if (!r) return
        const now = new Date()
        const bs = ((r.data ?? []) as TicketBatch[])
          .filter(b => !b.expires_at || new Date(b.expires_at) > now)
          .map(b => ({ ...b, available: Math.max(0, b.quantity - b.sold) }))
        setBatches(bs)
        setLoading(false)
        // ?lote=<id> abre direto naquele lote — é o link que a casa copia por lote
        const alvo = new URLSearchParams(window.location.search).get('lote')
        const b = alvo ? bs.find(x => x.id === alvo) : null
        if (b && b.available > 0) { setSelBatch(b); setQty(1); setStep('form') }
      })
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [eventId])

  // Leitura via RPC: o comprador é anônimo e não tem (nem deve ter) SELECT em ticket_orders/tickets
  async function fetchOrder(orderId: string) {
    const { data } = await supabase.rpc('get_order_public', { p_order_id: orderId })
    const row = data?.[0] as { order_id: string; batch_name?: string } | undefined
    if (!row) return null
    // a RPC devolve order_id; a tela usa order.id
    return { ...row, id: row.order_id } as unknown as TicketOrder
  }
  async function fetchTickets(orderId: string) {
    const { data } = await supabase.rpc('get_tickets_by_order', { p_order_id: orderId })
    return ((data ?? []) as { ticket_id: string; token: string; holder_name: string }[])
      .map(t => ({ id: t.ticket_id, token: t.token, holder_name: t.holder_name })) as Ticket[]
  }

  function startPolling(orderId: string) {
    pollRef.current = setInterval(async () => {
      const ord = await fetchOrder(orderId)
      if (!ord) return
      setOrder(ord)
      if (ord.payment_status === 'paid') {
        clearInterval(pollRef.current!)
        setTickets(await fetchTickets(orderId))
        setStep('done')
      }
    }, 4000)
  }

  async function submit(metodo: 'pix' | 'card' = 'pix') {
    if (!form.name.trim()) { setError('Nome obrigatório'); return }
    if (!form.phone.trim()) { setError('Telefone obrigatório'); return }
    if (!selBatch || !event) return
    if (selBatch.nominal) {
      const faltando = Array.from({ length: qty }, (_, i) => (nomes[i] ?? '').trim()).filter(n => n.length < 2).length
      if (faltando > 0) { setError(`Informe o nome de cada participante (${faltando} faltando)`); return }
    }
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: event.id,
          batch_id: selBatch.id,
          house_id: event.house_id,
          buyer_name: form.name.trim(),
          buyer_cpf: form.cpf || null,
          buyer_phone: form.phone.trim(),
          buyer_email: form.email || null,
          quantity: qty,
          method: metodo,
          holder_names: selBatch.nominal ? Array.from({ length: qty }, (_, i) => (nomes[i] ?? '').trim()) : undefined,
        }),
      })
      const result: PayResult = await res.json()
      if (!res.ok) { setError((result as { error?: string }).error ?? 'Erro ao processar'); return }

      setPayResult(result)

      if (result.mode === 'free') {
        setOrder(await fetchOrder(result.order_id))
        setTickets(await fetchTickets(result.order_id))
        setStep('done')
      } else if (result.mode === 'checkout') {
        // Checkout Pro: crédito, débito, PIX e boleto ficam na tela do Mercado Pago.
        // O comprador volta para /pagamento/:order, que acompanha a confirmação.
        window.location.href = result.init_point
      } else {
        setOrder(await fetchOrder(result.order_id))
        setStep('pix')
        startPolling(result.order_id)
      }
    } catch (e) {
      setError('Erro de conexão. Tente novamente.')
      console.error(e)
    } finally { setSubmitting(false) }
  }

  function copyPix(key: string) {
    navigator.clipboard.writeText(key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  function fdate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  }

  const inp = {
    style: {
      width: '100%', background: '#1f2937', border: `1px solid ${C.brd}`,
      borderRadius: 10, padding: '12px 14px', color: C.txt, fontSize: 15,
      fontFamily: 'inherit', boxSizing: 'border-box' as const, outline: 'none',
    },
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: C.mut, fontSize: 15 }}>Carregando evento...</div>
    </div>
  )

  if (notFound || !event) return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: C.mut }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎭</div>
        <div style={{ fontSize: 18, color: C.txt, fontWeight: 700 }}>Evento não encontrado</div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Inter', sans-serif" }}>
      <NightPassBar />
      {/* Hero */}
      <div style={{
        background: event.flyer_url
          ? `linear-gradient(to bottom, rgba(10,14,26,0.3) 0%, rgba(10,14,26,1) 100%), url(${event.flyer_url}) center/cover`
          : `linear-gradient(135deg, #1d4ed8, #0a0e1a)`,
        padding: '48px 20px 32px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          {event.flyer_url && (
            <img loading="lazy" decoding="async" src={event.flyer_url} alt={event.name}
              style={{ width: '100%', maxWidth: 300, borderRadius: 16, marginBottom: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }} />
          )}
          <div style={{ color: C.acc, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
            {event.houses?.name ?? ''}
          </div>
          <h1 style={{ color: C.txt, fontSize: 32, fontWeight: 900, margin: '0 0 10px', letterSpacing: '-0.02em' }}>{event.name}</h1>
          <div style={{ color: C.sub, fontSize: 14, marginBottom: 4 }}>📅 {fdate(event.event_date)}</div>
          {event.start_time && <div style={{ color: C.sub, fontSize: 14, marginBottom: 4 }}>🕙 {event.start_time.slice(0, 5)}{event.end_time ? ` — ${event.end_time.slice(0, 5)}` : ''}</div>}
          {event.genre && <div style={{ color: C.acc, fontSize: 13, fontWeight: 600, marginTop: 8 }}>🎵 {event.genre}</div>}
          {event.attractions && <div style={{ color: C.sub, fontSize: 13, marginTop: 6 }}>🎤 {event.attractions}</div>}
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 20px 60px' }}>

        {/* STEP: Select batch */}
        {step === 'select' && (
          <>
            {event.promotions && (
              <div style={{ background: C.gold + '18', border: `1px solid ${C.gold}44`, borderRadius: 12, padding: '12px 16px', marginBottom: 20, color: C.gold, fontSize: 13, fontWeight: 600 }}>
                🎉 {event.promotions}
              </div>
            )}
            <h2 style={{ color: C.txt, fontSize: 18, fontWeight: 800, marginBottom: 16 }}>Escolha seu ingresso</h2>
            {batches.length === 0
              ? <div style={{ background: C.card, borderRadius: 16, padding: 32, textAlign: 'center', border: `1px solid ${C.brd}` }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🎫</div>
                  <div style={{ color: C.mut, fontSize: 14 }}>Vendas encerradas ou em breve</div>
                </div>
              : batches.map(b => (
                <div key={b.id} onClick={() => b.available > 0 && (setSelBatch(b), setQty(1), setStep('form'), setError(''))}
                  style={{
                    background: C.card, border: `1px solid ${b.available > 0 ? C.brd : C.brd + '55'}`,
                    borderRadius: 16, padding: '16px 18px', marginBottom: 10,
                    cursor: b.available > 0 ? 'pointer' : 'default', opacity: b.available > 0 ? 1 : 0.5,
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: C.txt, fontWeight: 700, fontSize: 16 }}>{b.name}</div>
                      <div style={{ color: C.mut, fontSize: 12, marginTop: 3 }}>
                        {GENDER_LABEL[b.gender]}
                        {b.expires_at && ` · até ${new Date(b.expires_at).toLocaleDateString('pt-BR')}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: b.available > 0 ? C.grn : C.red, fontWeight: 900, fontSize: 22 }}>
                        {b.price_cents === 0 ? 'GRÁTIS' : fmtCurrency(b.price_cents)}
                      </div>
                      {taxaUnit(b) > 0 && (
                        <div style={{ color: C.mut, fontSize: 11, marginTop: 1 }}>+ {fmtCurrency(taxaUnit(b))} taxa</div>
                      )}
                      <div style={{ color: b.available > 5 ? C.grn : b.available > 0 ? C.gold : C.red, fontSize: 11, fontWeight: 600, marginTop: 2 }}>
                        {b.available === 0 ? 'Esgotado' : b.available <= 10 ? `Últimas ${b.available}` : `${b.available} disponíveis`}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            }
          </>
        )}

        {/* STEP: Fill form */}
        {step === 'form' && selBatch && (
          <>
            <button onClick={() => setStep('select')} style={{ background: 'none', border: 'none', color: C.acc, fontSize: 14, cursor: 'pointer', padding: 0, marginBottom: 20, fontFamily: 'inherit' }}>
              ← Voltar
            </button>
            <div style={{ background: C.acc + '18', border: `1px solid ${C.acc}44`, borderRadius: 12, padding: '12px 16px', marginBottom: 24 }}>
              <div style={{ color: C.acc, fontWeight: 700, fontSize: 15 }}>{selBatch.name}</div>
              <div style={{ color: C.sub, fontSize: 13 }}>{GENDER_LABEL[selBatch.gender]} · {selBatch.price_cents === 0 ? 'GRÁTIS' : fmtCurrency(selBatch.price_cents)} por pessoa</div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ color: C.sub, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>QUANTIDADE</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setQty(n)}
                    style={{ width: 40, height: 40, borderRadius: 10, border: `2px solid ${qty === n ? C.acc : C.brd}`, background: qty === n ? C.acc + '22' : 'transparent', color: qty === n ? C.acc : C.mut, fontSize: 16, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ color: C.sub, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>NOME COMPLETO *</label>
                <input {...inp} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Seu nome completo" />
              </div>
              <div>
                <label style={{ color: C.sub, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>CELULAR (WhatsApp) *</label>
                <input {...inp} type="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="(11) 99999-9999" />
              </div>
              <div>
                <label style={{ color: C.sub, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>CPF</label>
                <input {...inp} value={form.cpf} onChange={e => setForm(p => ({ ...p, cpf: e.target.value }))} placeholder="000.000.000-00" />
              </div>
              <div>
                <label style={{ color: C.sub, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>E-MAIL</label>
                <input {...inp} type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="seu@email.com" />
              </div>
            </div>

            {/* Lote nominal: um nome por ingresso, conferido na portaria contra documento */}
            {selBatch.nominal && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ color: C.sub, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  {qty > 1 ? 'Nome de cada participante' : 'Nome do participante'}
                </div>
                <div style={{ color: C.mut, fontSize: 11, marginBottom: 8 }}>
                  Cada ingresso sai nominal e pode ser conferido com documento na entrada.
                </div>
                {Array.from({ length: qty }, (_, i) => (
                  <input key={i} {...inp}
                    style={{ ...inp.style, marginBottom: 8 }}
                    placeholder={qty > 1 ? `Nome do ingresso ${i + 1}` : 'Nome completo'}
                    value={nomes[i] ?? ''}
                    onChange={e => setNomes(p => { const n = [...p]; n[i] = e.target.value; return n })} />
                ))}
                {qty > 1 && (
                  <button
                    onClick={() => setNomes(p => { const n = [...p]; n[0] = form.name; return n })}
                    style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                    Usar meu nome no primeiro ingresso
                  </button>
                )}
              </div>
            )}

            {error && <div style={{ background: C.red + '22', border: `1px solid ${C.red}44`, borderRadius: 10, padding: '10px 14px', color: C.red, fontSize: 13, marginBottom: 16 }}>{error}</div>}

            {/* Total aberto: o comprador precisa ver a taxa antes de ir para o pagamento */}
            <div style={{ padding: '14px 0', borderTop: `1px solid ${C.brd}`, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.mut, fontSize: 14 }}>{qty}x {selBatch.name}</span>
                <span style={{ color: C.sub, fontSize: 14 }}>{selBatch.price_cents === 0 ? 'GRÁTIS' : fmtCurrency(selBatch.price_cents * qty)}</span>
              </div>
              {taxaUnit(selBatch) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <span style={{ color: C.mut, fontSize: 13 }}>Taxa de serviço</span>
                  <span style={{ color: C.sub, fontSize: 13 }}>{fmtCurrency(taxaUnit(selBatch) * qty)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.brd}` }}>
                <span style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>Total</span>
                <span style={{ color: C.txt, fontWeight: 900, fontSize: 20 }}>
                  {selBatch.price_cents === 0 ? 'GRÁTIS' : fmtCurrency((selBatch.price_cents + taxaUnit(selBatch)) * qty)}
                </span>
              </div>
            </div>

            {/* PIX em destaque: cai na hora, sem sair do site e sem conta no Mercado Pago */}
            <button onClick={() => submit('pix')} disabled={submitting}
              style={{ width: '100%', background: `linear-gradient(135deg,#0e9f6e,${C.grn})`, color: '#04231a', border: 'none', borderRadius: 14, padding: 16, fontSize: 16, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, fontFamily: 'inherit' }}>
              {submitting ? 'Processando...' : `⚡ Pagar com PIX${qty > 1 ? ` (${qty})` : ''}`}
            </button>
            <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', marginTop: 6 }}>
              Aprovação na hora · o ingresso chega em seguida
            </div>

            <button onClick={() => submit('card')} disabled={submitting}
              style={{ width: '100%', marginTop: 12, background: 'transparent', color: C.acc, border: `1px solid ${C.acc}66`, borderRadius: 14, padding: 14, fontSize: 15, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1, fontFamily: 'inherit' }}>
              💳 Pagar com cartão
            </button>
          </>
        )}

        {/* STEP: PIX payment */}
        {step === 'pix' && payResult && order && (payResult.mode === 'mp' || payResult.mode === 'manual') && (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: C.txt, fontSize: 20, fontWeight: 900, marginBottom: 6 }}>💳 Pague via PIX</h2>
            <p style={{ color: C.sub, fontSize: 13, marginBottom: 24 }}>
              {payResult.mode === 'mp' ? 'Escaneie o QR code ou copie o código PIX' : 'Use a chave PIX abaixo para pagar'}
            </p>

            {/* MP QR code */}
            {payResult.mode === 'mp' && payResult.qr_code_base64 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 16, display: 'inline-block', marginBottom: 20 }}>
                <img loading="lazy" decoding="async" src={`data:image/png;base64,${payResult.qr_code_base64}`} alt="PIX QR Code"
                  style={{ width: 220, height: 220, display: 'block' }} />
              </div>
            )}

            {/* MP PIX copy-paste code */}
            {payResult.mode === 'mp' && payResult.qr_code && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ color: C.sub, fontSize: 12, marginBottom: 8 }}>Código PIX Copia e Cola:</div>
                <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', color: C.txt, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 10 }}>
                  {payResult.qr_code.slice(0, 80)}...
                </div>
                <button onClick={() => copyPix(payResult.qr_code!)}
                  style={{ background: copied ? C.grn + '22' : C.acc + '22', border: `1px solid ${copied ? C.grn : C.acc}44`, color: copied ? C.grn : C.acc, borderRadius: 10, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {copied ? '✅ Copiado!' : '📋 Copiar código PIX'}
                </button>
              </div>
            )}

            {/* Manual PIX */}
            {payResult.mode === 'manual' && payResult.pix_key && (
              <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 20, marginBottom: 20, textAlign: 'left' }}>
                <div style={{ color: C.sub, fontSize: 12, marginBottom: 6 }}>Chave PIX:</div>
                <div style={{ background: C.bg, borderRadius: 10, padding: '10px 14px', color: C.txt, fontSize: 15, fontWeight: 700, fontFamily: 'monospace', marginBottom: 8 }}>
                  {payResult.pix_key}
                </div>
                {payResult.pix_holder && <div style={{ color: C.mut, fontSize: 12, marginBottom: 12 }}>Favorecido: {payResult.pix_holder}</div>}
                <button onClick={() => copyPix(payResult.pix_key!)}
                  style={{ background: copied ? C.grn + '22' : C.acc + '22', border: `1px solid ${copied ? C.grn : C.acc}44`, color: copied ? C.grn : C.acc, borderRadius: 10, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                  {copied ? '✅ Copiado!' : '📋 Copiar chave PIX'}
                </button>
              </div>
            )}

            <div style={{ background: C.gold + '12', border: `1px solid ${C.gold}33`, borderRadius: 12, padding: '12px 16px', marginBottom: 20, textAlign: 'left' }}>
              <div style={{ color: C.gold, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                💰 Total: {fmtCurrency(payResult.amount_cents)}
              </div>
              <div style={{ color: C.sub, fontSize: 12 }}>
                {payResult.mode === 'mp'
                  ? 'O ingresso será liberado automaticamente após a confirmação do pagamento.'
                  : 'Envie o comprovante no WhatsApp para confirmar seu ingresso.'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', color: C.mut, fontSize: 13 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: C.gold, animation: 'pulse 1.5s infinite', display: 'inline-block' }} />
              Aguardando confirmação do pagamento...
            </div>

            <div style={{ color: C.mut, fontSize: 11, marginTop: 20 }}>
              Pedido #{order.id.slice(0, 8).toUpperCase()}
            </div>
          </div>
        )}

        {/* STEP: Done — show tickets */}
        {step === 'done' && order && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>🎉</div>
            <h2 style={{ color: C.grn, fontSize: 22, fontWeight: 900, marginBottom: 6 }}>Ingresso confirmado!</h2>
            <p style={{ color: C.sub, fontSize: 14, marginBottom: 24 }}>
              Apresente o QR code na entrada. Salve essa tela!
            </p>

            {tickets.map((tk, i) => (
              <div key={tk.id} style={{ background: C.card, border: `1px solid ${C.grn}44`, borderRadius: 20, padding: 24, marginBottom: 16, textAlign: 'center' }}>
                <div style={{ color: C.grn, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                  🎫 Ingresso {tickets.length > 1 ? `${i + 1}/${tickets.length}` : ''}
                </div>
                <div style={{ color: C.txt, fontWeight: 800, fontSize: 16, marginBottom: 16 }}>{event.name}</div>
                <div style={{ background: '#fff', borderRadius: 12, padding: 12, display: 'inline-block', marginBottom: 12 }}>
                  <QRCode value={tk.token} size={180} />
                </div>
                <div style={{ color: C.mut, fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                  {tk.token.slice(0, 8).toUpperCase()}
                </div>
              </div>
            ))}

            {tickets.length === 0 && (
              <div style={{ background: C.card, borderRadius: 16, padding: 24, color: C.mut, fontSize: 14 }}>
                Seus ingressos estão sendo gerados...
              </div>
            )}

            {/* Link permanente: se fechar esta aba, o ingresso continua acessível */}
            {tickets.length > 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 16, marginBottom: 16, textAlign: 'left' as const }}>
                <div style={{ color: C.mut, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>LINK DO SEU INGRESSO</div>
                <div style={{ color: C.sub, fontSize: 12, wordBreak: 'break-all' as const, marginBottom: 10 }}>
                  {window.location.origin}/ingresso/{tickets[0].token}
                </div>
                <button
                  onClick={() => copyPix(`${window.location.origin}/ingresso/${tickets[0].token}`)}
                  style={{ width: '100%', background: C.acc + '22', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {copied ? '✅ Link copiado' : '🔗 Copiar link'}
                </button>
                <div style={{ color: C.mut, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                  Também enviamos por WhatsApp. Guarde o link — ele reabre seu ingresso quando quiser.
                </div>
              </div>
            )}

            <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 16, marginTop: 8, textAlign: 'left' }}>
              <div style={{ color: C.mut, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>RESUMO</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.sub, fontSize: 13 }}>Titular</span>
                <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{order.buyer_name}</span>
              </div>
              {form.cpf && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: C.sub, fontSize: 13 }}>CPF</span>
                  <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{maskCpf(form.cpf)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.sub, fontSize: 13 }}>Evento</span>
                <span style={{ color: C.txt, fontSize: 13, fontWeight: 600, textAlign: 'right' as const }}>{event.name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.sub, fontSize: 13 }}>Local</span>
                <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{event.houses?.name ?? ''}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: C.sub, fontSize: 13 }}>Ingresso</span>
                <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{selBatch?.name ?? (order as { batch_name?: string }).batch_name} × {order.quantity}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: C.sub, fontSize: 13 }}>Status</span>
                <span style={{ color: STATUS_ORDER[order.payment_status].color, fontSize: 13, fontWeight: 700 }}>
                  {STATUS_ORDER[order.payment_status].label}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
