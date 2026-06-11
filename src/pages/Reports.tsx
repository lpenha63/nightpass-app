import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Btn } from '../components/ui'
import { fd, fmtCurrency, payColor, payLabel } from '../utils/format'
import type { House } from '../types'

interface Props { house: House }

type PeriodKey = 'month' | '30d' | '90d' | 'year' | 'custom'

interface PayStat { k: string; v: number }
interface MonthRev { ym: string; label: string; rev: number; n: number }
interface TopClient { id: string; name: string; count: number }
interface EvPnL {
  id: string; name: string; date: string
  rev_checkins: number; rev_tickets: number
  cost_artist: number; cost_freelancers: number; cost_promoters: number
  cost_res_items: number; cost_production: number; cost_consumacao: number
}
interface PromoterRank { id: string; name: string; guests: number; checked: number; cost: number }
interface FreelancerRank { id: string; name: string; cost: number; events: number }
interface FinSummary { faturamento: number; revCheckins: number; revTickets: number; checkins: number; ticketMedio: number }
interface ClientStats { novos: number; distinct: number; recorrentes: number; recorrenciaPct: number }
interface OpsStats { bestDayLabel: string; bestDayN: number; peakHour: number; peakHourN: number; resTotal: number; resArrived: number }

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const reservaArrived = (s: string) => s === 'arrived' || s === 'confirmado' || s === 'confirmed'

function isoDay(d: Date) { return d.toISOString().slice(0, 10) }

function rangeFor(key: PeriodKey, cs: string, ce: string): { start: string; end: string; label: string } {
  const now = new Date()
  const end = isoDay(now)
  if (key === 'month') {
    const start = isoDay(new Date(now.getFullYear(), now.getMonth(), 1))
    return { start, end, label: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) }
  }
  if (key === '30d') { const d = new Date(); d.setDate(d.getDate() - 29); return { start: isoDay(d), end, label: 'Últimos 30 dias' } }
  if (key === '90d') { const d = new Date(); d.setDate(d.getDate() - 89); return { start: isoDay(d), end, label: 'Últimos 90 dias' } }
  if (key === 'year') { const start = isoDay(new Date(now.getFullYear(), 0, 1)); return { start, end, label: String(now.getFullYear()) } }
  return { start: cs || end, end: ce || end, label: 'Personalizado' }
}

export function ReportsPage({ house }: Props) {
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [totalClients, setTotalClients] = useState(0)
  const [fin, setFin] = useState<FinSummary>({ faturamento: 0, revCheckins: 0, revTickets: 0, checkins: 0, ticketMedio: 0 })
  const [payStats, setPayStats] = useState<PayStat[]>([])
  const [monthly, setMonthly] = useState<MonthRev[]>([])
  const [evPnL, setEvPnL] = useState<EvPnL[]>([])
  const [promoterRank, setPromoterRank] = useState<PromoterRank[]>([])
  const [freelancerRank, setFreelancerRank] = useState<FreelancerRank[]>([])
  const [topClients, setTopClients] = useState<TopClient[]>([])
  const [clientStats, setClientStats] = useState<ClientStats>({ novos: 0, distinct: 0, recorrentes: 0, recorrenciaPct: 0 })
  const [ops, setOps] = useState<OpsStats>({ bestDayLabel: '—', bestDayN: 0, peakHour: 0, peakHourN: 0, resTotal: 0, resArrived: 0 })

  const { start, end, label } = rangeFor(period, customStart, customEnd)
  const startTs = start + 'T00:00:00'
  const endTs = end + 'T23:59:59'

  async function load() {
    if (!house) return
    setLoading(true)

    // Base datasets for the period
    const [totalCliR, newCliR, evR, ciR, tkR, resR] = await Promise.all([
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('house_id', house.id),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('house_id', house.id).gte('created_at', startTs).lte('created_at', endTs),
      supabase.from('events').select('id,name,event_date,artist_fee_cents,consumption_cents,production_cost_cents')
        .eq('house_id', house.id).neq('status', 'cancelado').gte('event_date', start).lte('event_date', end).order('event_date', { ascending: false }),
      supabase.from('checkins').select('amount_cents,payment_method,created_at,client_id,event_id,clients(full_name)')
        .eq('house_id', house.id).gte('created_at', startTs).lte('created_at', endTs),
      supabase.from('ticket_orders').select('amount_cents,quantity,event_id,created_at')
        .eq('house_id', house.id).eq('payment_status', 'paid').gte('created_at', startTs).lte('created_at', endTs),
      supabase.from('reservations').select('status,event_id,reservation_date')
        .eq('house_id', house.id).gte('reservation_date', start).lte('reservation_date', end),
    ])

    setTotalClients(totalCliR.count ?? 0)
    const events = evR.data ?? []
    const eventIds = events.map(e => e.id)
    const cins = ciR.data ?? []
    const tks = tkR.data ?? []
    const resv = resR.data ?? []

    // ── Financeiro ──
    const revCheckins = cins.reduce((s, c) => s + (c.amount_cents ?? 0), 0)
    const revTickets = tks.reduce((s, t) => s + (t.amount_cents ?? 0), 0)
    const faturamento = revCheckins + revTickets
    setFin({ faturamento, revCheckins, revTickets, checkins: cins.length, ticketMedio: cins.length ? Math.round(revCheckins / cins.length) : 0 })

    // Payment breakdown (period)
    const pm: Record<string, number> = {}
    cins.forEach(c => { const k = c.payment_method ?? 'outros'; pm[k] = (pm[k] ?? 0) + (c.amount_cents ?? 0) })
    setPayStats(Object.entries(pm).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v))

    // Monthly evolution
    const byMonth: Record<string, { rev: number; n: number }> = {}
    cins.forEach(c => { const ym = c.created_at.slice(0, 7); if (!byMonth[ym]) byMonth[ym] = { rev: 0, n: 0 }; byMonth[ym].rev += (c.amount_cents ?? 0); byMonth[ym].n++ })
    tks.forEach(t => { const ym = (t.created_at ?? '').slice(0, 7); if (!ym) return; if (!byMonth[ym]) byMonth[ym] = { rev: 0, n: 0 }; byMonth[ym].rev += (t.amount_cents ?? 0) })
    const months: MonthRev[] = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).map(([ym, v]) => ({
      ym, label: new Date(ym + '-02T12:00').toLocaleDateString('pt-BR', { month: 'short' }), rev: v.rev, n: v.n,
    }))
    setMonthly(months)

    // Top clients (from period check-ins)
    const cmap: Record<string, TopClient> = {}
    cins.forEach(c => {
      if (!c.client_id) return
      if (!cmap[c.client_id]) cmap[c.client_id] = { id: c.client_id, name: (c.clients as { full_name?: string })?.full_name ?? '?', count: 0 }
      cmap[c.client_id].count++
    })
    const clientArr = Object.values(cmap)
    setTopClients(clientArr.sort((a, b) => b.count - a.count).slice(0, 10))

    // Client stats
    const distinct = clientArr.length
    const recorrentes = clientArr.filter(c => c.count >= 2).length
    setClientStats({ novos: newCliR.count ?? 0, distinct, recorrentes, recorrenciaPct: distinct ? Math.round(recorrentes / distinct * 100) : 0 })

    // ── Operacional ──
    const dayCount: Record<number, number> = {}
    const hourCount: Record<number, number> = {}
    cins.forEach(c => { const d = new Date(c.created_at); dayCount[d.getDay()] = (dayCount[d.getDay()] ?? 0) + 1; hourCount[d.getHours()] = (hourCount[d.getHours()] ?? 0) + 1 })
    let bestDay = -1, bestDayN = 0
    Object.entries(dayCount).forEach(([d, n]) => { if (n > bestDayN) { bestDayN = n; bestDay = Number(d) } })
    let peakHour = -1, peakHourN = 0
    Object.entries(hourCount).forEach(([h, n]) => { if (n > peakHourN) { peakHourN = n; peakHour = Number(h) } })
    const resArrived = resv.filter(r => reservaArrived(r.status)).length
    setOps({ bestDayLabel: bestDay >= 0 ? WD[bestDay] : '—', bestDayN, peakHour, peakHourN, resTotal: resv.length, resArrived })

    // ── Event-scoped: DRE, promoters, freelancers ──
    if (eventIds.length === 0) {
      setEvPnL([]); setPromoterRank([]); setFreelancerRank([]); setLoading(false); return
    }

    const [frR, plR, riR, promosR] = await Promise.all([
      supabase.from('event_freelancers').select('event_id,custom_fee_cents,freelancer_id,freelancers(full_name,daily_rate_cents)').in('event_id', eventIds),
      supabase.from('promoter_lists').select('id,name,promoter_id,event_id,fixed_fee_cents,min_entries,entry_fee_cents,consumacao_cents').in('event_id', eventIds),
      supabase.from('reservation_items').select('quantity,unit_cost_cents,reservations!inner(event_id)').in('reservations.event_id', eventIds),
      supabase.from('promoters').select('id,full_name').eq('house_id', house.id),
    ])
    const frs = frR.data ?? []
    const lists = plR.data ?? []
    const ris = riR.data ?? []
    const promoNames: Record<string, string> = {}
    ;(promosR.data ?? []).forEach(p => { promoNames[p.id] = p.full_name })

    // Guests per list (one query)
    const listIds = lists.map(l => l.id)
    let guestsByList: Record<string, { total: number; checked: number }> = {}
    if (listIds.length) {
      const gR = await supabase.from('promoter_list_guests').select('list_id,checked_in').in('list_id', listIds)
      ;(gR.data ?? []).forEach(g => {
        const k = g.list_id as string
        if (!guestsByList[k]) guestsByList[k] = { total: 0, checked: 0 }
        guestsByList[k].total++
        if (g.checked_in) guestsByList[k].checked++
      })
    }

    // Freelancer cost per event + ranking
    const frCostByEvent: Record<string, number> = {}
    const frRankMap: Record<string, FreelancerRank> = {}
    frs.forEach(f => {
      const daily = (f.freelancers as { daily_rate_cents?: number } | null)?.daily_rate_cents ?? 0
      const fee = (f as { custom_fee_cents?: number }).custom_fee_cents ?? daily
      frCostByEvent[f.event_id] = (frCostByEvent[f.event_id] ?? 0) + fee
      const fid = (f.freelancer_id as string) ?? 'x'
      if (!frRankMap[fid]) frRankMap[fid] = { id: fid, name: (f.freelancers as { full_name?: string } | null)?.full_name ?? '—', cost: 0, events: 0 }
      frRankMap[fid].cost += fee; frRankMap[fid].events++
    })
    setFreelancerRank(Object.values(frRankMap).sort((a, b) => b.cost - a.cost))

    // Promoter cost per event + ranking
    const promoCostByEvent: Record<string, number> = {}
    const promoRankMap: Record<string, PromoterRank> = {}
    lists.forEach(l => {
      const g = guestsByList[l.id] ?? { total: 0, checked: 0 }
      const ent = Math.max(g.total, l.min_entries ?? 0)
      const cost = (l.fixed_fee_cents ?? 0) + ent * (l.entry_fee_cents ?? 0) + ent * (l.consumacao_cents ?? 0)
      promoCostByEvent[l.event_id] = (promoCostByEvent[l.event_id] ?? 0) + cost
      const pid = (l.promoter_id as string) ?? l.id
      if (!promoRankMap[pid]) promoRankMap[pid] = { id: pid, name: promoNames[pid] ?? l.name ?? '—', guests: 0, checked: 0, cost: 0 }
      promoRankMap[pid].guests += g.total; promoRankMap[pid].checked += g.checked; promoRankMap[pid].cost += cost
    })
    setPromoterRank(Object.values(promoRankMap).sort((a, b) => b.guests - a.guests))

    // Res items cost per event
    const riCostByEvent: Record<string, number> = {}
    ris.forEach(r => {
      const eid = (r.reservations as { event_id?: string } | null)?.event_id
      if (!eid) return
      riCostByEvent[eid] = (riCostByEvent[eid] ?? 0) + (r.quantity ?? 1) * (r.unit_cost_cents ?? 0)
    })

    // Checkin/ticket revenue per event
    const ciRevByEvent: Record<string, number> = {}
    cins.forEach(c => { if (c.event_id) ciRevByEvent[c.event_id] = (ciRevByEvent[c.event_id] ?? 0) + (c.amount_cents ?? 0) })
    const tkRevByEvent: Record<string, number> = {}
    tks.forEach(t => { if (t.event_id) tkRevByEvent[t.event_id] = (tkRevByEvent[t.event_id] ?? 0) + (t.amount_cents ?? 0) })

    const pnl: EvPnL[] = events.map(ev => ({
      id: ev.id, name: ev.name, date: ev.event_date,
      rev_checkins: ciRevByEvent[ev.id] ?? 0,
      rev_tickets: tkRevByEvent[ev.id] ?? 0,
      cost_artist: ev.artist_fee_cents ?? 0,
      cost_freelancers: frCostByEvent[ev.id] ?? 0,
      cost_promoters: promoCostByEvent[ev.id] ?? 0,
      cost_res_items: riCostByEvent[ev.id] ?? 0,
      cost_production: ev.production_cost_cents ?? 0,
      cost_consumacao: ev.consumption_cents ?? 0,
    }))
    setEvPnL(pnl)
    setLoading(false)
  }

  useEffect(() => { load() }, [house.id, period, customStart, customEnd])

  // ── Exports ──
  function exportPnLCSV() {
    const hdr = 'Evento,Data,Receita Portaria,Receita Ingressos,Receita Total,Cachê,Freelancers,Promoters,Opcionais,Produção,Consumação,Custo Total,Resultado'
    const lines = evPnL.map(e => {
      const rev = e.rev_checkins + e.rev_tickets
      const cost = e.cost_artist + e.cost_freelancers + e.cost_promoters + e.cost_res_items + e.cost_production + e.cost_consumacao
      return [e.name, e.date, e.rev_checkins / 100, e.rev_tickets / 100, rev / 100, e.cost_artist / 100, e.cost_freelancers / 100, e.cost_promoters / 100, e.cost_res_items / 100, e.cost_production / 100, e.cost_consumacao / 100, cost / 100, (rev - cost) / 100]
        .map(v => typeof v === 'number' ? v.toFixed(2).replace('.', ',') : `"${v}"`).join(';')
    })
    download(`pnl-${start}-${end}.csv`, hdr + '\n' + lines.join('\n'), ';')
  }

  function exportCSV() {
    setExporting(true)
    supabase.from('checkins').select('created_at,amount_cents,payment_method,clients(full_name,phone,cpf),events(name)')
      .eq('house_id', house.id).gte('created_at', startTs).lte('created_at', endTs).order('created_at', { ascending: false })
      .then(r => {
        setExporting(false)
        const hdr = 'Data,Cliente,CPF,Telefone,Evento,Valor,Pagamento'
        const lines = (r.data ?? []).map(ci => {
          const cl = ci.clients as { full_name?: string; cpf?: string; phone?: string } | undefined
          const ev = ci.events as { name?: string } | undefined
          return [ci.created_at?.slice(0, 16).replace('T', ' '), cl?.full_name ?? '', cl?.cpf ?? '', cl?.phone ?? '', ev?.name ?? '', ((ci.amount_cents ?? 0) / 100).toFixed(2).replace('.', ','), ci.payment_method ?? '']
            .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
        })
        download(`checkins-${start}-${end}.csv`, hdr + '\n' + lines.join('\n'), ',')
      })
  }

  function exportClients() {
    setExporting(true)
    supabase.from('clients').select('full_name,cpf,phone,birth_date,status,created_at').eq('house_id', house.id).order('full_name')
      .then(r => {
        setExporting(false)
        const hdr = 'Nome,CPF,Telefone,Nascimento,Status,Cadastro'
        const lines = (r.data ?? []).map(c => [c.full_name, c.cpf ?? '', c.phone ?? '', c.birth_date ?? '', c.status, c.created_at?.slice(0, 10)].map(v => `"${v}"`).join(','))
        download('clientes.csv', hdr + '\n' + lines.join('\n'), ',')
      })
  }

  function download(name: string, csv: string, _sep: string) {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── Derived ──
  const totRev = evPnL.reduce((s, e) => s + e.rev_checkins + e.rev_tickets, 0)
  const totCost = evPnL.reduce((s, e) => s + e.cost_artist + e.cost_freelancers + e.cost_promoters + e.cost_res_items + e.cost_production + e.cost_consumacao, 0)
  const totProfit = totRev - totCost
  const avgMargin = totRev > 0 ? Math.round(totProfit / totRev * 100) : 0
  const monthMax = Math.max(...monthly.map(m => m.rev), 1)
  const totalPay = payStats.reduce((s, p) => s + p.v, 0)
  const topClientMax = Math.max(...topClients.map(c => c.count), 1)

  const periods: { k: PeriodKey; label: string }[] = [
    { k: 'month', label: 'Mês atual' }, { k: '30d', label: '30 dias' }, { k: '90d', label: '90 dias' }, { k: 'year', label: 'Ano' }, { k: 'custom', label: 'Personalizado' },
  ]

  const kpis = [
    { label: 'Faturamento', value: fmtCurrency(fin.faturamento), color: C.grn },
    { label: 'Check-ins', value: fin.checkins.toLocaleString('pt-BR'), color: C.acc },
    { label: 'Ticket Médio', value: fmtCurrency(fin.ticketMedio), color: C.gold },
    { label: 'Eventos', value: evPnL.length.toLocaleString('pt-BR'), color: '#a78bfa' },
    { label: 'Novos Clientes', value: clientStats.novos.toLocaleString('pt-BR'), color: '#f59e0b' },
  ]

  const sectionTitle = (t: string) => <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>{t}</div>

  return (
    <div style={{ paddingBottom: 40 }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: C.txt, marginBottom: 4 }}>📊 Relatórios</h1>
      <p style={{ color: C.mut, fontSize: 14, marginBottom: 16 }}>Análise de desempenho · <span style={{ color: C.sub, fontWeight: 600, textTransform: 'capitalize' }}>{label}</span> {loading && <span style={{ color: C.mut }}>· atualizando…</span>}</p>

      {/* Period filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {periods.map(p => (
          <button key={p.k} onClick={() => setPeriod(p.k)}
            style={{ padding: '7px 14px', borderRadius: 10, border: `1px solid ${period === p.k ? C.acc : C.brd}`, background: period === p.k ? C.acc + '22' : 'transparent', color: period === p.k ? C.acc : C.mut, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }} />
            <span style={{ color: C.mut }}>→</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }} />
          </div>
        )}
      </div>

      {/* Export buttons */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <Btn onClick={exportCSV} disabled={exporting}>{exporting ? 'Exportando...' : '📥 Check-ins CSV'}</Btn>
        <Btn onClick={exportClients} disabled={exporting} variant="secondary">👥 Clientes CSV</Btn>
        {evPnL.length > 0 && <Btn onClick={exportPnLCSV} variant="secondary">💼 DRE CSV</Btn>}
        <Btn onClick={() => window.print()} variant="secondary">🖨️ Imprimir / PDF</Btn>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        {kpis.map((k, i) => (
          <div key={i} className="card-3d" style={{ background: 'linear-gradient(160deg,rgba(20,28,46,0.98),rgba(10,14,26,0.99))', border: '1px solid rgba(59,130,246,0.12)', borderTop: `3px solid ${k.color}`, borderRadius: 16, padding: '16px 18px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), 0 4px 8px rgba(0,0,0,0.35), 0 16px 32px rgba(0,0,0,0.5)', transform: 'translateY(-3px)' }}>
            <div style={{ color: C.mut, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{k.label}</div>
            <div style={{ color: k.color, fontSize: 26, fontWeight: 900, letterSpacing: '-0.02em' }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Evolução mensal + Formas de pagamento */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card>
          {sectionTitle('📈 Evolução do faturamento')}
          {monthly.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Sem dados no período.</div>
            : <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
              {monthly.map((m, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, marginBottom: 3 }}>{(m.rev / 100) >= 1000 ? `${Math.round(m.rev / 100000)}k` : Math.round(m.rev / 100)}</div>
                  <div style={{ width: '100%', maxWidth: 46, background: 'linear-gradient(180deg,#3b82f6,#1e3a8a)', borderRadius: 6, height: `${Math.max(4, (m.rev / monthMax) * 100)}%`, transition: 'height .4s' }} />
                  <div style={{ fontSize: 10, color: C.mut, marginTop: 5, textTransform: 'capitalize' }}>{m.label}</div>
                </div>
              ))}
            </div>
          }
        </Card>

        <Card>
          {sectionTitle('💳 Formas de pagamento')}
          {payStats.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Sem pagamentos no período.</div>
            : payStats.slice(0, 6).map((ps, i) => (
              <div key={i} style={{ marginBottom: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: payColor(ps.k) }} />
                    <span style={{ color: C.sub, fontSize: 13 }}>{payLabel(ps.k)}</span>
                  </div>
                  <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{fmtCurrency(ps.v)} <span style={{ color: C.mut, fontSize: 11 }}>· {Math.round(ps.v / (totalPay || 1) * 100)}%</span></span>
                </div>
                <div style={{ background: C.brd, borderRadius: 4, height: 4, overflow: 'hidden' }}>
                  <div style={{ background: payColor(ps.k), height: '100%', width: `${(ps.v / (totalPay || 1)) * 100}%`, transition: 'width .5s', borderRadius: 4 }} />
                </div>
              </div>
            ))
          }
        </Card>
      </div>

      {/* DRE por evento */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.txt }}>💼 DRE por Evento</div>
          <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>Receita vs. Custo vs. Resultado — {label}</div>
        </div>

        {evPnL.length === 0
          ? <div style={{ color: C.mut, textAlign: 'center', padding: '24px 0', fontSize: 13 }}>Nenhum evento no período selecionado.</div>
          : <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Receita Total', value: fmtCurrency(totRev), color: C.grn },
                { label: 'Custo Total', value: fmtCurrency(totCost), color: C.red },
                { label: 'Resultado', value: fmtCurrency(totProfit), color: totProfit >= 0 ? C.grn : C.red },
                { label: 'Margem Média', value: `${avgMargin}%`, color: avgMargin >= 0 ? C.grn : C.red },
              ].map((k, i) => (
                <div key={i} style={{ background: C.bg, border: `1px solid ${k.color}33`, borderTop: `3px solid ${k.color}`, borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
                  <div style={{ color: C.mut, fontSize: 11, fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>{k.label.toUpperCase()}</div>
                  <div style={{ color: k.color, fontSize: 20, fontWeight: 900 }}>{k.value}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 70px', gap: 4, padding: '6px 8px', background: C.bg, borderRadius: 8, marginBottom: 6 }}>
              {['Evento', 'Receita', 'Custos', 'Resultado', 'Margem'].map((h, i) => (
                <div key={i} style={{ color: C.mut, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textAlign: i > 0 ? 'right' : 'left' }}>{h}</div>
              ))}
            </div>

            {evPnL.map(e => {
              const rev = e.rev_checkins + e.rev_tickets
              const cost = e.cost_artist + e.cost_freelancers + e.cost_promoters + e.cost_res_items + e.cost_production + e.cost_consumacao
              const profit = rev - cost
              const margin = rev > 0 ? Math.round((profit / rev) * 100) : 0
              const isProfit = profit >= 0
              return (
                <div key={e.id} style={{ borderBottom: `1px solid ${C.brd}` }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 70px', gap: 4, padding: '10px 8px', alignItems: 'center' }}>
                    <div>
                      <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{e.name}</div>
                      <div style={{ color: C.mut, fontSize: 11 }}>{fd(e.date)}</div>
                    </div>
                    <div style={{ color: C.grn, fontWeight: 600, fontSize: 13, textAlign: 'right' }}>{fmtCurrency(rev)}</div>
                    <div style={{ color: C.red, fontWeight: 600, fontSize: 13, textAlign: 'right' }}>{fmtCurrency(cost)}</div>
                    <div style={{ color: isProfit ? C.grn : C.red, fontWeight: 800, fontSize: 13, textAlign: 'right' }}>{isProfit ? '+' : ''}{fmtCurrency(profit)}</div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ background: (isProfit ? C.grn : C.red) + '22', color: isProfit ? C.grn : C.red, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{margin}%</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 8px 8px', fontSize: 11 }}>
                    {e.cost_artist > 0 && <span style={{ color: C.gold }}>🎤 {fmtCurrency(e.cost_artist)}</span>}
                    {e.cost_freelancers > 0 && <span style={{ color: C.acc }}>👷 {fmtCurrency(e.cost_freelancers)}</span>}
                    {e.cost_promoters > 0 && <span style={{ color: '#a78bfa' }}>📋 {fmtCurrency(e.cost_promoters)}</span>}
                    {e.cost_res_items > 0 && <span style={{ color: C.gold }}>🪑 {fmtCurrency(e.cost_res_items)}</span>}
                    {e.cost_production > 0 && <span style={{ color: '#8b5cf6' }}>🔧 {fmtCurrency(e.cost_production)}</span>}
                    {e.cost_consumacao > 0 && <span style={{ color: '#f59e0b' }}>🍺 {fmtCurrency(e.cost_consumacao)}</span>}
                    {e.rev_tickets > 0 && <span style={{ color: C.grn }}>🎟️ {fmtCurrency(e.rev_tickets)}</span>}
                  </div>
                </div>
              )
            })}
          </>
        }
      </Card>

      {/* Promoters + Equipe */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card>
          {sectionTitle('📣 Desempenho de Promoters')}
          {promoterRank.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem listas de promoter no período.</div>
            : <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px 90px', gap: 4, padding: '4px 6px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em' }}>
                <div>PROMOTER</div><div style={{ textAlign: 'right' }}>CONV.</div><div style={{ textAlign: 'right' }}>COMPAR.</div><div style={{ textAlign: 'right' }}>R$/CABEÇA</div>
              </div>
              {promoterRank.slice(0, 8).map((p, i) => {
                const pct = p.guests ? Math.round(p.checked / p.guests * 100) : 0
                const perHead = p.checked ? Math.round(p.cost / p.checked) : 0
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 70px 90px', gap: 4, padding: '8px 6px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ color: C.mut, fontSize: 11, width: 16 }}>#{i + 1}</span>
                      <span style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    </div>
                    <div style={{ textAlign: 'right', color: C.txt, fontWeight: 700 }}>{p.guests}</div>
                    <div style={{ textAlign: 'right', color: pct >= 60 ? C.grn : pct >= 30 ? C.gold : C.red, fontWeight: 700 }}>{pct}%</div>
                    <div style={{ textAlign: 'right', color: C.sub }}>{perHead > 0 ? fmtCurrency(perHead) : '—'}</div>
                  </div>
                )
              })}
            </>
          }
        </Card>

        <Card>
          {sectionTitle('👷 Custo por Freelancer')}
          {freelancerRank.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem freelancers escalados no período.</div>
            : <>
              {freelancerRank.slice(0, 9).map((f, i) => (
                <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.brd}22` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.mut, fontSize: 11, width: 16 }}>#{i + 1}</span>
                    <div>
                      <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                      <div style={{ color: C.mut, fontSize: 11 }}>{f.events} evento{f.events > 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <span style={{ color: C.acc, fontWeight: 700, fontSize: 13 }}>{fmtCurrency(f.cost)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}` }}>
                <span style={{ color: C.mut, fontSize: 13 }}>Total equipe</span>
                <span style={{ color: C.acc, fontSize: 15, fontWeight: 900 }}>{fmtCurrency(freelancerRank.reduce((s, f) => s + f.cost, 0))}</span>
              </div>
            </>
          }
        </Card>
      </div>

      {/* Clientes + Operacional */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          {sectionTitle('🏆 Clientes')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'Novos', val: clientStats.novos.toLocaleString('pt-BR'), color: '#f59e0b' },
              { label: 'Ativos', val: clientStats.distinct.toLocaleString('pt-BR'), color: C.acc },
              { label: 'Recorrência', val: `${clientStats.recorrenciaPct}%`, color: C.grn },
            ].map((b, i) => (
              <div key={i} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                <div style={{ color: b.color, fontSize: 18, fontWeight: 900 }}>{b.val}</div>
                <div style={{ color: C.mut, fontSize: 10, marginTop: 2 }}>{b.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 6 }}>TOP CLIENTES (PERÍODO)</div>
          {topClients.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, padding: '12px 0' }}>Sem check-ins no período.</div>
            : topClients.slice(0, 6).map((c, i) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <span style={{ color: C.mut, fontSize: 12, width: 18 }}>#{i + 1}</span>
                <span style={{ flex: 1, color: C.txt, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <div style={{ width: 80, background: C.brd, borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: C.grn, height: '100%', width: `${(c.count / topClientMax) * 100}%`, borderRadius: 4 }} />
                </div>
                <span style={{ color: C.grn, fontWeight: 700, fontSize: 12, width: 56, textAlign: 'right' }}>{c.count} visitas</span>
              </div>
            ))
          }
          <div style={{ fontSize: 11, color: C.mut, marginTop: 10 }}>Base total: {totalClients.toLocaleString('pt-BR')} clientes</div>
        </Card>

        <Card>
          {sectionTitle('⚙️ Operacional')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ color: C.mut, fontSize: 11, marginBottom: 4 }}>📅 Melhor dia</div>
              <div style={{ color: C.txt, fontSize: 18, fontWeight: 900 }}>{ops.bestDayLabel}</div>
              <div style={{ color: C.mut, fontSize: 11 }}>{ops.bestDayN} check-ins</div>
            </div>
            <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ color: C.mut, fontSize: 11, marginBottom: 4 }}>⏰ Horário de pico</div>
              <div style={{ color: C.txt, fontSize: 18, fontWeight: 900 }}>{ops.peakHour >= 0 ? `${ops.peakHour}h` : '—'}</div>
              <div style={{ color: C.mut, fontSize: 11 }}>{ops.peakHourN} check-ins</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 8 }}>RESERVAS DO PERÍODO</div>
          {ops.resTotal === 0
            ? <div style={{ color: C.mut, fontSize: 13, padding: '8px 0' }}>Sem reservas no período.</div>
            : (() => {
              const noShow = ops.resTotal - ops.resArrived
              const pct = Math.round(ops.resArrived / ops.resTotal * 100)
              return (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                    <span style={{ color: C.sub }}>Comparecimento</span>
                    <span style={{ color: pct >= 70 ? C.grn : pct >= 40 ? C.gold : C.red, fontWeight: 700 }}>{ops.resArrived}/{ops.resTotal} ({pct}%)</span>
                  </div>
                  <div style={{ height: 8, background: C.brd, borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#059669,#10b981)', borderRadius: 6 }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.grn }}>✅ Compareceram: {ops.resArrived}</span>
                    <span style={{ color: C.red }}>❌ No-show: {noShow}</span>
                  </div>
                </div>
              )
            })()
          }
        </Card>
      </div>
    </div>
  )
}
