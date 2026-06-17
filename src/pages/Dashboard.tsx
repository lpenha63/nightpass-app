import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Toast, Btn } from '../components/ui'
import { cn, fmtCurrency, payColor, payLabel } from '../utils/format'
import { sT, type ToastState } from '../utils/toast'
import { sendWA, sendWADirect } from '../utils/whatsapp'
import type { House } from '../types'

// Casa noturna em horário local (não UTC): até as 6h da manhã ainda conta como a
// "noite"/dia de negócio anterior. Corrige o evento do dia e a contagem de check-ins.
function bizRefDate(): Date {
  const now = new Date()
  const d = new Date(now)
  if (now.getHours() < 6) d.setDate(d.getDate() - 1)
  return d
}
function bizTodayStr(): string {
  const d = bizRefDate()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function bizDayStartISO(): string {
  const d = bizRefDate()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString()
}

interface Props {
  house: House
  user: { id: string; email: string }
  role: string
}

interface Stats {
  clients: number
  events: number
  todayCount: number
  todayRev: number
  reservations: number
  newClients: number
}

interface PayStat { k: string; v: number }
interface WeekDay { d: string; n: number; r: number }
interface HourData { h: number; n: number }
interface RecentCI {
  id: string
  created_at: string
  amount_cents: number
  payment_method: string
  clients?: { full_name: string } | { full_name: string }[]
  events?: { name: string } | { name: string }[]
}
interface DashRes {
  id: string
  name: string
  status: string
  expected_arrival?: string
  people_count?: number
  location?: string
  amount_cents?: number
}
interface TodayEvent {
  id: string
  name: string
  event_date: string
  start_time?: string
  capacity?: number
  artist_fee_cents?: number
  consumption_cents?: number
  production_cost_cents?: number
}
interface EventMetrics {
  checkins: number
  capacity: number
  expectedPeople: number
  resPeople: number
  listGuests: number
  ticketsSold: number
  ticketsPending: number
  ticketsPendingValue: number
  freelancersPending: number
  checklistPending: number
  revenue: number
  cost: number
  result: number
}
interface CashDay { door: number; tickets: number; reservations: number; total: number }
interface Birthday { id: string; full_name: string; phone?: string }

const KPIS = (s: Stats, cash: number) => [
  { icon: '👥', label: 'Clientes', value: s.clients.toLocaleString('pt-BR'), color: C.acc },
  { icon: '🆕', label: 'Novos Hoje', value: s.newClients.toLocaleString('pt-BR'), color: '#22d3ee' },
  { icon: '🎉', label: 'Eventos Ativos', value: s.events.toLocaleString('pt-BR'), color: C.mut },
  { icon: '✅', label: 'Check-ins Hoje', value: s.todayCount.toLocaleString('pt-BR'), color: C.grn },
  { icon: '💰', label: 'Caixa Hoje', value: fmtCurrency(cash), color: C.gold },
  { icon: '🪑', label: 'Reservas Hoje', value: s.reservations.toLocaleString('pt-BR'), color: '#a78bfa' },
]

const PAY_METHODS = ['pix', 'cartao', 'dinheiro', 'cortesia', 'credito', 'debito']
const reservaArrived = (status: string) => status === 'arrived' || status === 'confirmado' || status === 'confirmed'

export function DashboardPage({ house, user }: Props) {
  const [stats, setStats] = useState<Stats>({ clients: 0, events: 0, todayCount: 0, todayRev: 0, reservations: 0, newClients: 0 })
  const [hourly, setHourly] = useState<HourData[]>([])
  const [payStats, setPayStats] = useState<PayStat[]>([])
  const [recent, setRecent] = useState<RecentCI[]>([])
  const [weekData, setWeekData] = useState<WeekDay[]>([])
  const [dashRes, setDashRes] = useState<DashRes[]>([])
  const [todayEvent, setTodayEvent] = useState<TodayEvent | null>(null)
  const [evMetrics, setEvMetrics] = useState<EventMetrics | null>(null)
  const [cash, setCash] = useState<CashDay>({ door: 0, tickets: 0, reservations: 0, total: 0 })
  const [birthdays, setBirthdays] = useState<Birthday[]>([])
  const [toast, setToast] = useState<ToastState | null>(null)

  // Quick check-in state
  const [ciSrch, setCiSrch] = useState('')
  const [ciRes, setCiRes] = useState<Record<string, unknown> | null>(null)
  const [ciLoad, setCiLoad] = useState(false)
  const [ciEvs, setCiEvs] = useState<Array<{ id: string; name: string; event_date: string }>>([])
  const [ciSelEv, setCiSelEv] = useState('')
  const [ciPay, setCiPay] = useState('')
  const [ciPayMethod, setCiPayMethod] = useState('dinheiro')

  const chartRef = useRef<HTMLCanvasElement>(null)

  async function load() {
    const today = bizTodayStr()
    const dayStart = bizDayStartISO()

    const [clientsC, newClientsC, eventsC, ciR, evR] = await Promise.all([
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('house_id', house.id),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('house_id', house.id).gte('created_at', dayStart),
      supabase.from('events').select('id', { count: 'exact', head: true }).eq('house_id', house.id).neq('status', 'cancelado'),
      supabase.from('checkins').select('id,amount_cents,created_at,payment_method,event_id').eq('house_id', house.id).gte('created_at', dayStart),
      supabase.from('events').select('id,name,event_date,start_time,capacity,artist_fee_cents,consumption_cents,production_cost_cents')
        .eq('house_id', house.id).eq('event_date', today).neq('status', 'cancelado').order('start_time').limit(1),
    ])

    const cins = ciR.data ?? []
    const todayDoorRev = cins.reduce((s, c) => s + (c.amount_cents ?? 0), 0)

    // Hourly distribution (20h → 06h)
    const hours: Record<number, number> = {}
    cins.forEach(c => { const hh = new Date(c.created_at).getHours(); hours[hh] = (hours[hh] ?? 0) + 1 })
    const ha: HourData[] = []
    for (let i = 20; i <= 23; i++) ha.push({ h: i, n: hours[i] ?? 0 })
    for (let i = 0; i <= 6; i++) ha.push({ h: i, n: hours[i] ?? 0 })
    setHourly(ha)

    // Payment breakdown — TODAY only
    const pm: Record<string, number> = {}
    cins.forEach(c => { const k = c.payment_method ?? 'outros'; pm[k] = (pm[k] ?? 0) + (c.amount_cents ?? 0) })
    setPayStats(Object.entries(pm).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v))

    const ev = (evR.data ?? [])[0] as TodayEvent | undefined ?? null
    setTodayEvent(ev)

    // Cash of the day: door + online tickets paid today + reservation consumption today
    const [tkPaidTodayR, rrR] = await Promise.all([
      supabase.from('ticket_orders').select('amount_cents').eq('house_id', house.id).eq('payment_status', 'paid').gte('created_at', dayStart),
      supabase.from('reservations').select('id,name,status,expected_arrival,people_count,location,amount_cents')
        .eq('house_id', house.id).eq('reservation_date', today).order('expected_arrival'),
    ])
    const ticketsRevToday = (tkPaidTodayR.data ?? []).reduce((s, t) => s + (t.amount_cents ?? 0), 0)
    const rd = (rrR.data ?? []) as DashRes[]
    setDashRes(rd)
    const resConsumToday = rd.reduce((s, r) => s + (r.amount_cents ?? 0), 0)
    const cashTotal = todayDoorRev + ticketsRevToday + resConsumToday
    setCash({ door: todayDoorRev, tickets: ticketsRevToday, reservations: resConsumToday, total: cashTotal })

    setStats({ clients: clientsC.count ?? 0, events: eventsC.count ?? 0, todayCount: cins.length, todayRev: cashTotal, reservations: rd.length, newClients: newClientsC.count ?? 0 })

    // Tonight event metrics (occupancy + P&L + pendings)
    if (ev) {
      const [evCi, evTkPaid, evTkPend, evFr, evPl, evRi, evCl, evGuests] = await Promise.all([
        supabase.from('checkins').select('amount_cents', { count: 'exact' }).eq('event_id', ev.id),
        supabase.from('ticket_orders').select('amount_cents,quantity').eq('event_id', ev.id).eq('payment_status', 'paid'),
        supabase.from('ticket_orders').select('amount_cents,quantity').eq('event_id', ev.id).eq('payment_status', 'pending'),
        supabase.from('event_freelancers').select('confirmed, freelancers(daily_rate_cents), custom_fee_cents').eq('event_id', ev.id),
        supabase.from('promoter_lists').select('id,fixed_fee_cents,min_entries,entry_fee_cents,consumacao_cents').eq('event_id', ev.id),
        supabase.from('reservation_items').select('quantity,unit_cost_cents,reservations!inner(event_id)').eq('reservations.event_id', ev.id),
        supabase.from('event_checklist_items').select('done').eq('event_id', ev.id),
        supabase.from('promoter_list_guests').select('id', { count: 'exact', head: true }).eq('event_id', ev.id),
      ])

      const revCheckins = (evCi.data ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0)
      const revTickets = (evTkPaid.data ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0)
      const ticketsSold = (evTkPaid.data ?? []).reduce((s, r) => s + (r.quantity ?? 0), 0)
      const ticketsPending = (evTkPend.data ?? []).reduce((s, r) => s + (r.quantity ?? 0), 0)
      const ticketsPendingValue = (evTkPend.data ?? []).reduce((s, r) => s + (r.amount_cents ?? 0), 0)

      const costFreelancers = (evFr.data ?? []).reduce((s, r) => {
        const custom = (r as { custom_fee_cents?: number }).custom_fee_cents
        const daily = (r.freelancers as { daily_rate_cents?: number } | null)?.daily_rate_cents ?? 0
        return s + (custom ?? daily)
      }, 0)
      const freelancersPending = (evFr.data ?? []).filter(r => !r.confirmed).length

      let costPromoters = 0
      for (const l of (evPl.data ?? [])) {
        const { count } = await supabase.from('promoter_list_guests').select('id', { count: 'exact', head: true }).eq('list_id', l.id)
        const ent = Math.max(count ?? 0, l.min_entries ?? 0)
        costPromoters += (l.fixed_fee_cents ?? 0) + ent * (l.entry_fee_cents ?? 0) + ent * (l.consumacao_cents ?? 0)
      }

      const costResItems = (evRi.data ?? []).reduce((s, r) => s + (r.quantity ?? 1) * (r.unit_cost_cents ?? 0), 0)
      const checklistPending = (evCl.data ?? []).filter(c => !c.done).length

      const revenue = revCheckins + revTickets
      const cost = (ev.artist_fee_cents ?? 0) + costFreelancers + costPromoters + costResItems + (ev.production_cost_cents ?? 0) + (ev.consumption_cents ?? 0)

      const resPeople = rd.reduce((s, r) => s + (r.people_count ?? 0), 0)
      const listGuests = evGuests.count ?? 0

      setEvMetrics({
        checkins: evCi.count ?? 0,
        capacity: ev.capacity ?? 0,
        expectedPeople: resPeople + listGuests,
        resPeople, listGuests,
        ticketsSold, ticketsPending, ticketsPendingValue,
        freelancersPending, checklistPending,
        revenue, cost, result: revenue - cost,
      })
    } else {
      setEvMetrics(null)
    }

    // Recent check-ins
    supabase.from('checkins').select('id,created_at,amount_cents,payment_method,clients(full_name),events(name)')
      .eq('house_id', house.id).order('created_at', { ascending: false }).limit(8)
      .then(r => setRecent(r.data ?? []))

    // 30-day chart
    const d30 = new Date(); d30.setDate(d30.getDate() - 29)
    supabase.from('checkins').select('created_at,amount_cents').eq('house_id', house.id)
      .gte('created_at', d30.toISOString().slice(0, 10) + 'T00:00:00')
      .then(rw => {
        const byDay: Record<string, { n: number; r: number }> = {}
        ;(rw.data ?? []).forEach(c => {
          const day = c.created_at.slice(0, 10)
          if (!byDay[day]) byDay[day] = { n: 0, r: 0 }
          byDay[day].n++; byDay[day].r += (c.amount_cents ?? 0)
        })
        const arr: WeekDay[] = []
        for (let di = 29; di >= 0; di--) {
          const dt = new Date(); dt.setDate(dt.getDate() - di)
          const ds = dt.toISOString().slice(0, 10)
          arr.push({ d: ds, n: byDay[ds]?.n ?? 0, r: byDay[ds]?.r ?? 0 })
        }
        setWeekData(arr)
      })

    // Birthdays today (clients whose birth month/day matches today)
    supabase.from('clients').select('id,full_name,phone,birth_date').eq('house_id', house.id).not('birth_date', 'is', null)
      .then(r => {
        const now = new Date()
        const bd = (r.data ?? []).filter(c => {
          if (!c.birth_date) return false
          const d = new Date(c.birth_date + 'T00:00:00')
          return d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
        }).map(c => ({ id: c.id, full_name: c.full_name, phone: c.phone }))
        setBirthdays(bd as Birthday[])
      })
  }

  function loadCIEvs() {
    supabase.from('events').select('id,name,event_date').eq('house_id', house.id)
      .neq('status', 'cancelado').order('event_date', { ascending: false })
      .then(r => {
        if (r.data) {
          setCiEvs(r.data)
          const today = bizTodayStr()
          const todayEv = r.data.find(ev => ev.event_date?.slice(0, 10) === today)
          if (todayEv) setCiSelEv(todayEv.id)
          else if (r.data.length > 0) setCiSelEv(r.data[0].id)
        }
      })
  }

  useEffect(() => {
    load()
    loadCIEvs()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [house.id])

  // Draw 30-day bar chart on canvas
  useEffect(() => {
    const canvas = chartRef.current
    if (!canvas || !weekData.length) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.clientWidth || 600
    const H = 80
    canvas.width = W; canvas.height = H
    const max = Math.max(...weekData.map(d => d.n), 1)
    const bw = W / weekData.length - 2
    ctx.clearRect(0, 0, W, H)
    const today = new Date().toISOString().slice(0, 10)
    weekData.forEach((d, i) => {
      const bh = Math.max(2, (d.n / max) * (H - 16))
      const x = i * (bw + 2)
      const y = H - bh - 8
      ctx.fillStyle = d.d === today ? '#3b82f6' : '#1e2736'
      ctx.beginPath()
      ctx.roundRect(x, y, bw, bh, 3)
      ctx.fill()
    })
  }, [weekData])

  function doCI() {
    if (!ciSrch.trim()) return
    setCiLoad(true); setCiRes(null)
    const q = cn(ciSrch), isCPF = q.length === 11
    const isPhone = q.length >= 10 && q.length <= 11 && !isCPF
    const pr = isCPF
      ? supabase.from('clients').select('*').eq('house_id', house.id).eq('cpf', q).single()
      : isPhone
        ? supabase.from('clients').select('*').eq('house_id', house.id).eq('phone', q).single()
        : supabase.from('clients').select('*').eq('house_id', house.id).ilike('full_name', `%${ciSrch}%`).limit(1).single()
    pr.then(r => {
      setCiLoad(false)
      if (r.data) setCiRes(r.data)
      else sT(setToast, 'Cliente não encontrado', 'error')
    })
  }

  function confirmCI() {
    if (!ciRes) return
    if (!ciSelEv) { sT(setToast, 'Selecione um evento', 'error'); return }
    const cents = Math.round((parseFloat(ciPay) || 0) * 100)
    const client = ciRes as { id: string; full_name: string; phone?: string }
    supabase.from('checkins').insert({
      house_id: house.id, client_id: client.id, event_id: ciSelEv,
      payment_method: ciPayMethod, amount_cents: cents,
      operator_user_id: user.id, source: 'door', checkin_type: 'portaria',
    }).then(r => {
      if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }
      sT(setToast, `✓ Check-in: ${client.full_name}`, 'success')
      sendWA(house.id, 'checkin_confirm', client.phone ?? '', client.full_name, {}, client.id, ciSelEv)
      setCiRes(null); setCiSrch(''); setCiPay(''); load()
    })
  }

  const kpis = KPIS(stats, cash.total)
  const totalPay = payStats.reduce((s, p) => s + p.v, 0)
  const weekMax = Math.max(...weekData.map(d => d.n), 1)
  const hourMax = Math.max(...hourly.map(h => h.n), 1)
  const occPct = evMetrics && evMetrics.capacity > 0 ? Math.min(100, Math.round(evMetrics.checkins / evMetrics.capacity * 100)) : 0
  const arrivedCount = dashRes.filter(r => reservaArrived(r.status)).length

  return (
    <div className="pb-24 md:pb-10 max-w-[1400px] mx-auto">
      <Toast toast={toast} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-black text-txt tracking-tight truncate">{house.name || 'Dashboard'}</h1>
          <p className="text-mut text-sm capitalize">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>

      {/* ── Evento de hoje ── */}
      {todayEvent ? (
        <div className="rounded-2xl bg-card border border-brd p-4 md:p-5 mb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gold mb-1">🔥 Evento de hoje</div>
              <div className="text-xl md:text-2xl font-black text-txt leading-tight">{todayEvent.name}</div>
              <div className="text-mut text-[13px] mt-1">
                {todayEvent.start_time ? `🕒 ${todayEvent.start_time.slice(0, 5)}` : ''}
                {todayEvent.capacity ? `  ·  Capacidade ${todayEvent.capacity}` : ''}
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {[
                { v: evMetrics?.expectedPeople ?? 0, l: 'Previstas', c: 'text-gold' },
                { v: evMetrics?.checkins ?? 0, l: 'Check-ins', c: 'text-grn' },
                { v: `${arrivedCount}/${dashRes.length}`, l: 'Reservas', c: 'text-purp' },
                { v: evMetrics?.ticketsSold ?? 0, l: 'Ingressos', c: 'text-acc' },
              ].map((m, i) => (
                <div key={i} className="text-center">
                  <div className={`text-2xl font-black leading-none ${m.c}`}>{m.v}</div>
                  <div className="text-[10px] uppercase tracking-wide text-mut mt-1">{m.l}</div>
                </div>
              ))}
            </div>
          </div>
          {todayEvent.capacity ? (
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-mut mb-1">
                <span>Lotação</span>
                <span className="font-bold" style={{ color: occPct >= 90 ? C.red : occPct >= 60 ? C.gold : C.grn }}>{evMetrics?.checkins ?? 0} / {todayEvent.capacity} ({occPct}%)</span>
              </div>
              <div className="h-2 rounded-full bg-brd overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${occPct}%`, background: occPct >= 90 ? C.red : occPct >= 60 ? C.gold : C.grn }} />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl bg-card border border-brd p-4 mb-4 text-center text-mut text-sm">🌙 Nenhum evento programado para hoje</div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mb-4">
        {kpis.map((kpi, i) => (
          <div key={i} className="rounded-2xl bg-card border border-brd p-3" style={{ borderTop: `2px solid ${kpi.color}` }}>
            <span className="text-lg leading-none">{kpi.icon}</span>
            <div className="text-txt text-[22px] font-black leading-none mt-2 tabular-nums">{kpi.value}</div>
            <div className="text-mut text-[11px] mt-1 truncate">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* ── Caixa do dia + Resultado da noite ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Caixa do dia */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 16 }}>💵 Caixa do dia</div>
          {[
            { label: '🚪 Portaria (check-ins)', val: cash.door, color: C.grn },
            { label: '🎟️ Ingressos online', val: cash.tickets, color: C.acc },
            { label: '🪑 Consumação (reservas)', val: cash.reservations, color: '#a78bfa' },
          ].map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.brd}22`, fontSize: 13 }}>
              <span style={{ color: C.sub }}>{row.label}</span>
              <span style={{ color: row.color, fontWeight: 700 }}>{fmtCurrency(row.val)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
            <span style={{ color: C.mut, fontSize: 13 }}>Total do dia</span>
            <span style={{ color: C.gold, fontSize: 20, fontWeight: 900 }}>{fmtCurrency(cash.total)}</span>
          </div>
        </div>

        {/* Resultado da noite */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 16 }}>📊 Resultado da noite</div>
          {!todayEvent || !evMetrics ? (
            <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem evento hoje para apurar resultado.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.brd}22`, fontSize: 13 }}>
                <span style={{ color: C.sub }}>📥 Receita (portaria + ingressos)</span>
                <span style={{ color: C.grn, fontWeight: 700 }}>{fmtCurrency(evMetrics.revenue)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.brd}22`, fontSize: 13 }}>
                <span style={{ color: C.sub }}>📤 Custos (cachê, equipe, produção…)</span>
                <span style={{ color: '#f59e0b', fontWeight: 700 }}>{fmtCurrency(evMetrics.cost)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.brd}` }}>
                <span style={{ color: C.mut, fontSize: 13 }}>{evMetrics.result >= 0 ? '🟢 Lucro' : '🔴 Prejuízo'}</span>
                <span style={{ color: evMetrics.result >= 0 ? C.grn : C.red, fontSize: 20, fontWeight: 900 }}>{fmtCurrency(evMetrics.result)}</span>
              </div>
              <div style={{ fontSize: 11, color: C.mut, marginTop: 8 }}>* Receita parcial (atualiza durante a noite). Custos conforme cadastro do evento.</div>
            </>
          )}
        </div>
      </div>

      {/* ── Charts: 30 dias + Curva por hora ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 16 }}>📈 Check-ins — 30 dias</div>
          <canvas ref={chartRef} style={{ width: '100%', height: 80 }} />
          <div style={{ display: 'flex', gap: 4, marginTop: 8, overflowX: 'auto' }}>
            {weekData.slice(-7).map((d, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ background: d.n > 0 ? C.acc : C.brd, borderRadius: 4, height: Math.max(4, (d.n / weekMax) * 48), marginBottom: 4, transition: 'height .3s' }} />
                <div style={{ fontSize: 10, color: C.mut }}>{new Date(d.d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' })}</div>
                <div style={{ fontSize: 11, color: C.txt, fontWeight: 600 }}>{d.n}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Curva por hora */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 16 }}>⏱️ Fluxo da porta (por hora)</div>
          {stats.todayCount === 0 ? (
            <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Sem check-ins hoje ainda.</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 96 }}>
              {hourly.map((h, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ fontSize: 9, color: C.txt, fontWeight: 600, marginBottom: 2 }}>{h.n > 0 ? h.n : ''}</div>
                  <div style={{ width: '100%', background: h.n > 0 ? 'linear-gradient(180deg,#3b82f6,#1e3a8a)' : C.brd, borderRadius: 3, height: `${Math.max(3, (h.n / hourMax) * 70)}%`, transition: 'height .3s' }} />
                  <div style={{ fontSize: 9, color: C.mut, marginTop: 3 }}>{h.h}h</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Pendências + Aniversariantes ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Pendências */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>⚠️ Pendências do evento</div>
          {!evMetrics ? (
            <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem evento hoje.</div>
          ) : (() => {
            const items = [
              { ok: evMetrics.freelancersPending === 0, icon: '👥', label: 'Freelancers não confirmados', val: evMetrics.freelancersPending },
              { ok: evMetrics.ticketsPending === 0, icon: '🎟️', label: 'Ingressos com pagamento pendente', val: evMetrics.ticketsPending, extra: evMetrics.ticketsPending > 0 ? fmtCurrency(evMetrics.ticketsPendingValue) : '' },
              { ok: evMetrics.checklistPending === 0, icon: '✅', label: 'Itens de checklist em aberto', val: evMetrics.checklistPending },
            ]
            return items.map((it, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < items.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                <span style={{ fontSize: 16 }}>{it.icon}</span>
                <span style={{ flex: 1, fontSize: 13, color: it.ok ? C.mut : C.txt }}>{it.label}</span>
                {it.extra && <span style={{ fontSize: 11, color: C.gold }}>{it.extra}</span>}
                <span style={{ background: it.ok ? C.grn + '22' : C.gold + '22', color: it.ok ? C.grn : C.gold, border: `1px solid ${it.ok ? C.grn : C.gold}44`, borderRadius: 6, padding: '2px 9px', fontSize: 12, fontWeight: 700, minWidth: 28, textAlign: 'center' }}>
                  {it.ok ? '✓' : it.val}
                </span>
              </div>
            ))
          })()}
        </div>

        {/* Aniversariantes hoje */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>🎂 Aniversariantes de hoje</div>
          {birthdays.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum aniversariante hoje.</div>
            : birthdays.slice(0, 6).map((b, i) => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < Math.min(birthdays.length, 6) - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🎈</span>
                  <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{b.full_name}</span>
                </div>
                {b.phone && (
                  <button onClick={() => sendWADirect(house.id, b.phone ?? '', `🎂 Feliz aniversário, ${b.full_name.split(' ')[0]}! 🎉`, { type: 'birthday_wish' })}
                    style={{ background: '#25d36622', border: '1px solid #25d36644', borderRadius: 8, padding: '4px 10px', color: '#25d366', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>💬</button>
                )}
              </div>
            ))
          }
          {birthdays.length > 6 && <div style={{ fontSize: 11, color: C.mut, marginTop: 8 }}>+{birthdays.length - 6} aniversariantes</div>}
        </div>
      </div>

      {/* ── Bottom: pagamento + reservas + recentes + check-in rápido ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Payment breakdown (today) */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 16 }}>💳 Formas de pagamento (hoje)</div>
          {payStats.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem pagamentos hoje.</div>
            : payStats.slice(0, 5).map((ps, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: payColor(ps.k) }} />
                    <span style={{ color: C.sub, fontSize: 13 }}>{payLabel(ps.k)}</span>
                  </div>
                  <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{fmtCurrency(ps.v)}</span>
                </div>
                <div style={{ background: C.brd, borderRadius: 4, height: 4, overflow: 'hidden' }}>
                  <div style={{ background: payColor(ps.k), height: '100%', width: `${(ps.v / (totalPay || 1)) * 100}%`, transition: 'width .5s', borderRadius: 4 }} />
                </div>
              </div>
            ))
          }
        </div>

        {/* Today's reservations */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>🪑 Reservas do dia ({arrivedCount}/{dashRes.length})</div>
          {dashRes.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem reservas hoje</div>
            : dashRes.slice(0, 5).map((r, i) => {
              const arrived = reservaArrived(r.status)
              return (
                <div key={r.id || i} style={{ padding: '9px 0', borderBottom: i < Math.min(dashRes.length, 5) - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                    <span style={{ background: arrived ? C.grn + '22' : C.gold + '22', color: arrived ? C.grn : C.gold, border: `1px solid ${arrived ? C.grn : C.gold}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                      {arrived ? '✅ Chegou' : '⏳ Aguardando'}
                    </span>
                  </div>
                  <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
                    {r.expected_arrival ? `${r.expected_arrival.slice(0, 5)} · ` : ''}{r.people_count ?? 0} pessoas{r.location ? ` · 📍 ${r.location}` : ''}
                  </div>
                </div>
              )
            })
          }
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent check-ins */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>🔵 Últimos Check-ins</div>
          {recent.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum check-in hoje</div>
            : recent.map((ci, i) => (
              <div key={ci.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < recent.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                <div>
                  <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>
                    {(ci.clients as { full_name?: string })?.full_name ?? 'Visitante'}
                  </div>
                  <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
                    há {Math.floor((Date.now() - new Date(ci.created_at).getTime()) / 60000)} min · {fmtCurrency(ci.amount_cents)}
                  </div>
                </div>
                <span style={{ background: payColor(ci.payment_method) + '22', color: payColor(ci.payment_method), border: `1px solid ${payColor(ci.payment_method)}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                  {payLabel(ci.payment_method)}
                </span>
              </div>
            ))
          }
        </div>

        {/* Quick check-in */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>⚡ Check-in Rápido</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={ciSrch}
              onChange={e => setCiSrch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doCI()}
              placeholder="CPF, celular ou nome"
              style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 13, minHeight: 40, fontFamily: 'inherit' }}
            />
            <Btn onClick={doCI} disabled={ciLoad} small>🔍</Btn>
          </div>
          {ciRes && (() => {
            const c = ciRes as { id: string; full_name: string; phone?: string }
            return (
              <div>
                <div style={{ background: C.bg, borderRadius: 10, padding: '10px 14px', marginBottom: 10 }}>
                  <div style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>{c.full_name}</div>
                </div>
                <select value={ciSelEv} onChange={e => setCiSelEv(e.target.value)}
                  style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, marginBottom: 8, minHeight: 40, fontFamily: 'inherit' }}>
                  {ciEvs.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input value={ciPay} onChange={e => setCiPay(e.target.value)} placeholder="R$ valor"
                    style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, minHeight: 40, fontFamily: 'inherit' }} />
                  <select value={ciPayMethod} onChange={e => setCiPayMethod(e.target.value)}
                    style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, minHeight: 40, fontFamily: 'inherit' }}>
                    {PAY_METHODS.map(m => <option key={m} value={m}>{payLabel(m)}</option>)}
                  </select>
                </div>
                <Btn onClick={confirmCI} style={{ width: '100%' }}>✅ Confirmar Check-in</Btn>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
