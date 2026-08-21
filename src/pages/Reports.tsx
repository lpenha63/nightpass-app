import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Btn } from '../components/ui'
import { fd, fmtCurrency, payColor, payLabel, cn, ftel } from '../utils/format'
import { sendWADirect } from '../utils/whatsapp'
import { sT, type ToastState } from '../utils/toast'
import { Toast } from '../components/ui'
import type { House } from '../types'

// Teto das tabelas de ranking: 12 linhas visiveis, o resto rola por dentro.
// Sem isso a lista da equipe (49 pessoas) empurrava o restante do relatorio
// para fora da tela, e a de promoters cortava em 8 escondendo o resto de vez.
const LINHAS_VISIVEIS = 12
const ALTURA_LINHA = 35   // padding 8+8 + linha ~18 + borda
const ALTURA_LINHA_DRE = 64  // a linha do DRE traz a faixa de custos embaixo


interface Props { house: House }

type PeriodKey = 'month' | '30d' | '90d' | 'year' | 'custom'

interface WACIItem {
  id: string
  created_at: string
  amount_cents: number
  payment_method: string
  client_id?: string | null
  event_name?: string
  client_name?: string
  phone?: string
}

interface InviteEvent {
  id: string; name: string; event_date: string; flyer_url?: string
  price_male_list_cents?: number; price_female_list_cents?: number
}

interface PayStat { k: string; v: number }
interface MonthRev { ym: string; label: string; rev: number; n: number }
interface TopClient { id: string; name: string; count: number }
interface EvPnL {
  id: string; name: string; date: string
  rev_checkins: number; rev_tickets: number; rev_other: number
  cost_artist: number; cost_freelancers: number; cost_promoters: number
  cost_res_items: number; cost_production: number; cost_consumacao: number
  cost_expenses: number; cost_tasks: number
}
// Custo total do evento (mesma composição do budget da tela Eventos)
function pnlCost(e: EvPnL): number {
  return e.cost_artist + e.cost_freelancers + e.cost_promoters + e.cost_res_items
    + e.cost_production + e.cost_consumacao + e.cost_expenses + e.cost_tasks
}
// Receita total do evento (portaria + ingressos + receitas adicionadas manualmente)
function pnlRev(e: EvPnL): number {
  return e.rev_checkins + e.rev_tickets + e.rev_other
}
interface PromoterRank { id: string; name: string; guests: number; checked: number; cost: number; revenue: number; vip: number }
// Folha do dia: detalhe por pessoa quando o período é um único dia (fechamento do evento)
interface TeamDayRow {
  id: string; name: string; role?: string; event: string
  checkin?: string; checkout?: string; hours: number | null; fee: number; pix?: string; phone?: string
}
interface FreelancerRank {
  id: string; name: string; cost: number; events: number
  scaled: number   // vezes escalado no período
  present: number  // vezes que deu check-in
  hours: number    // horas trabalhadas (check-in → check-out)
  late: number     // chegou depois do horário previsto
  rating: number | null // nota média das avaliações
}
interface FinSummary { faturamento: number; revCheckins: number; revTickets: number; checkins: number; ticketMedio: number }
interface ClientStats { novos: number; distinct: number; recorrentes: number; recorrenciaPct: number }
interface OpsStats { bestDayLabel: string; bestDayN: number; peakHour: number; peakHourN: number; resTotal: number; resArrived: number }
interface DailyCI { day: string; label: string; n: number; rev: number }
interface EventCI { id: string; name: string; date: string; genre?: string; total: number; pagantes: number; cortesias: number; male: number; female: number; capacity: number; rev: number; reservas: number }
interface AcessoItem { name: string; phone: string; gender: string; time: string; pay: string; amount: number; event: string }
interface ListaGuestItem { name: string; phone: string; listName: string; isVip: boolean; confirmed: boolean; checkedIn: boolean; eventName: string }
interface ListaReservaItem { id: string; name: string; phone: string; peopleCount: number; status: string; location: string; expectedArrival: string; eventName: string }
type ReportTab = 'geral' | 'budget' | 'acessos' | 'eventos' | 'equipe'

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const reservaArrived = (s: string) => s === 'arrived' || s === 'confirmado' || s === 'confirmed'

// Canais de aquisição — "como conheceu a casa?" (pesquisa no cadastro do cliente)
const REFERRAL_META: Record<string, { label: string; icon: string; color: string }> = {
  instagram: { label: 'Instagram', icon: '📸', color: '#E1306C' },
  google: { label: 'Google', icon: '🔍', color: '#4285F4' },
  tiktok: { label: 'TikTok', icon: '🎵', color: '#22d3ee' },
  facebook: { label: 'Facebook', icon: '👍', color: '#1877F2' },
  grupo_vip: { label: 'Grupo VIP', icon: '⭐', color: '#f59e0b' },
  panfleto: { label: 'Panfleto', icon: '📄', color: '#8b5cf6' },
  indicacao: { label: 'Indicação', icon: '🗣️', color: '#10b981' },
  outro: { label: 'Outro', icon: '❓', color: '#94a3b8' },
  __none__: { label: 'Não informado', icon: '—', color: '#64748b' },
}
const refMeta = (k: string) => REFERRAL_META[k] ?? { label: k, icon: '•', color: '#94a3b8' }

function isoDay(d: Date) { return d.toISOString().slice(0, 10) }

// Busca paginada — o Supabase corta em 1000 linhas por padrão. Sem isso, períodos
// com mais de 1000 check-ins vinham truncados (subcontagem por evento/dia).
function checkinsQuery(houseId: string, startTs: string, endTs: string, from: number) {
  const PAGE = 1000
  return supabase.from('checkins')
    .select('id,amount_cents,payment_method,created_at,client_id,event_id,clients(full_name,gender,phone,referral_source),events(name)')
    .eq('house_id', houseId).gte('created_at', startTs).lte('created_at', endTs)
    .order('created_at', { ascending: true }).range(from, from + PAGE - 1)
}

async function fetchAllCheckins(houseId: string, startTs: string, endTs: string) {
  const PAGE = 1000
  const first = await checkinsQuery(houseId, startTs, endTs, 0)
  const rows = [...(first.data ?? [])]
  if (first.error) return rows
  for (let from = PAGE; rows.length === from; from += PAGE) {
    const { data, error } = await checkinsQuery(houseId, startTs, endTs, from)
    if (error || !data) break
    rows.push(...data)
  }
  return rows
}

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

// Período imediatamente anterior, de mesma duração, para comparação
function prevRangeFor(key: PeriodKey, cs: string, ce: string): { start: string; end: string } {
  const now = new Date()
  if (key === 'month') {
    const start = isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1))
    const end = isoDay(new Date(now.getFullYear(), now.getMonth(), 0))
    return { start, end }
  }
  if (key === '30d') { const e = new Date(); e.setDate(e.getDate() - 30); const s = new Date(); s.setDate(s.getDate() - 59); return { start: isoDay(s), end: isoDay(e) } }
  if (key === '90d') { const e = new Date(); e.setDate(e.getDate() - 90); const s = new Date(); s.setDate(s.getDate() - 179); return { start: isoDay(s), end: isoDay(e) } }
  if (key === 'year') { return { start: isoDay(new Date(now.getFullYear() - 1, 0, 1)), end: isoDay(new Date(now.getFullYear() - 1, 11, 31)) } }
  // custom: mesma duração imediatamente antes
  const s = new Date((cs || isoDay(now)) + 'T12:00'), e = new Date((ce || isoDay(now)) + 'T12:00')
  const dur = e.getTime() - s.getTime()
  const pe = new Date(s.getTime() - 86400000)
  const ps = new Date(pe.getTime() - dur)
  return { start: isoDay(ps), end: isoDay(pe) }
}

// Conjunto de "MM-DD" cobertos por um intervalo (para aniversariantes, ignora o ano)
function mmddSet(start: string, end: string): Set<string> {
  const set = new Set<string>()
  const s = new Date(start + 'T12:00'), e = new Date(end + 'T12:00')
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return set
  // limita a ~370 dias para segurança
  let cur = new Date(s), guard = 0
  while (cur <= e && guard < 370) {
    set.add(`${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`)
    cur = new Date(cur.getTime() + 86400000); guard++
  }
  return set
}

export function ReportsPage({ house }: Props) {
  const [reportTab, setReportTab] = useState<ReportTab>('geral')
  const [acessoDay, setAcessoDay] = useState('')
  const [acessoList, setAcessoList] = useState<AcessoItem[]>([])
  const [acessoLoading, setAcessoLoading] = useState(false)
  const [acessoSearch, setAcessoSearch] = useState('')
  const [acessoView, setAcessoView] = useState<'entradas' | 'listas'>('entradas')
  const [acessoShow, setAcessoShow] = useState(150)
  const [listaGuests, setListaGuests] = useState<ListaGuestItem[]>([])
  const [listaReservas, setListaReservas] = useState<ListaReservaItem[]>([])
  const [listasLoading, setListasLoading] = useState(false)
  const [listasSearch, setListasSearch] = useState('')
  const [budgetOpen, setBudgetOpen] = useState<string | null>(null)
  const [period, setPeriod] = useState<PeriodKey>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  // WhatsApp panel
  const [showWA, setShowWA] = useState(false)
  const [waCiList, setWaCiList] = useState<WACIItem[]>([])
  const [waSearch, setWaSearch] = useState('')
  const [waSelected, setWaSelected] = useState<Set<string>>(new Set())
  const [waMode, setWaMode] = useState<'gift' | 'invite' | 'list'>('gift')
  // Modo criar lista
  const [waListName, setWaListName] = useState('')
  const [waListIsVip, setWaListIsVip] = useState(false)
  const [waListPrice, setWaListPrice] = useState('')
  const [waListFriends, setWaListFriends] = useState(0)
  const [waListNotify, setWaListNotify] = useState(false)
  const [waListMsg, setWaListMsg] = useState('🌟 Olá {nome}! Você está na lista {lista} para *{evento}* — {data}! Apresente esta mensagem na portaria. 🎉')
  const [waMsg, setWaMsg] = useState('🎁 Olá {nome}! Obrigado por nos visitar. Apresente esta mensagem no bar e ganhe um brinde especial. 🍹')
  const [waImage, setWaImage] = useState('')
  const [waSending, setWaSending] = useState(false)
  const [waProgress, setWaProgress] = useState<{ sent: number; total: number } | null>(null)
  const [waInviteEvents, setWaInviteEvents] = useState<InviteEvent[]>([])
  const [waInviteEventId, setWaInviteEventId] = useState('')
  const [waFriends, setWaFriends] = useState(3)
  const [waFriendsOn, setWaFriendsOn] = useState(true)

  const [totalClients, setTotalClients] = useState(0)
  const [fin, setFin] = useState<FinSummary>({ faturamento: 0, revCheckins: 0, revTickets: 0, checkins: 0, ticketMedio: 0 })
  const [payStats, setPayStats] = useState<PayStat[]>([])
  const [monthly, setMonthly] = useState<MonthRev[]>([])
  const [evPnL, setEvPnL] = useState<EvPnL[]>([])
  const [promoterRank, setPromoterRank] = useState<PromoterRank[]>([])
  const [freelancerRank, setFreelancerRank] = useState<FreelancerRank[]>([])
  const [teamDay, setTeamDay] = useState<TeamDayRow[]>([])
  const [topClients, setTopClients] = useState<TopClient[]>([])
  const [clientStats, setClientStats] = useState<ClientStats>({ novos: 0, distinct: 0, recorrentes: 0, recorrenciaPct: 0 })
  // Total de reservas do periodo (bruto, nao o somatorio atribuido evento a evento):
  // reserva de um dia com dois eventos nao e atribuida, e sumiria da conta.
  const [reservasPeriodo, setReservasPeriodo] = useState(0)
  const [ops, setOps] = useState<OpsStats>({ bestDayLabel: '—', bestDayN: 0, peakHour: 0, peakHourN: 0, resTotal: 0, resArrived: 0 })
  const [dailyCI, setDailyCI] = useState<DailyCI[]>([])
  const [weekdayCompare, setWeekdayCompare] = useState<DailyCI[]>([])
  const [compareDow, setCompareDow] = useState<number>(new Date().getDay())
  const [eventCI, setEventCI] = useState<EventCI[]>([])
  const [prev, setPrev] = useState({ faturamento: 0, checkins: 0, novos: 0 })
  const [referralStats, setReferralStats] = useState<{ k: string; v: number }[]>([])
  const [eventReferral, setEventReferral] = useState<Record<string, { k: string; v: number }[]>>({})
  const [birthdays, setBirthdays] = useState<{ name: string; phone: string; date: string; mmdd: string }[]>([])

  const { start, end, label } = rangeFor(period, customStart, customEnd)
  // Limites no fuso de São Paulo (UTC-3, fixo). Sem o offset, strings naive são lidas
  // como UTC e cortam check-ins do fim da noite (ex.: dia custom vinha 100 em vez de 164).
  const startTs = start + 'T00:00:00-03'
  const endTs = end + 'T23:59:59-03'

  // Acessos: KPIs (só recalcula quando a lista muda) e a lista filtrada/ordenada (só quando lista ou busca muda).
  // Antes rodava filter/sort/reduce sobre milhares de check-ins a cada tecla/render.
  const acessoKpis = useMemo(() => {
    const total = acessoList.length
    const male = acessoList.filter(a => a.gender === 'masculino').length
    const female = acessoList.filter(a => a.gender === 'feminino').length
    const cortesias = acessoList.filter(a => a.pay === 'cortesia' || a.amount === 0).length
    const pagantes = total - cortesias
    const rev = acessoList.reduce((s, a) => s + a.amount, 0)
    return { total, male, female, cortesias, pagantes, rev }
  }, [acessoList])
  const acessoRows = useMemo(() => acessoList
    .filter(a => !acessoSearch.trim() || a.name.toLowerCase().includes(acessoSearch.trim().toLowerCase()))
    .slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [acessoList, acessoSearch])
  useEffect(() => { setAcessoShow(150) }, [acessoSearch, acessoList])

  async function load() {
    if (!house) return
    setLoading(true)

    // Base datasets for the period
    const [totalCliR, newCliR, evR, cinsAll, tkR, resR] = await Promise.all([
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('house_id', house.id),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('house_id', house.id).gte('created_at', startTs).lte('created_at', endTs),
      supabase.from('events').select('id,name,event_date,genre,artists,artist_fee_cents,consumption_cents,production_cost_cents,capacity')
        .eq('house_id', house.id).neq('status', 'cancelado').gte('event_date', start).lte('event_date', end).order('event_date', { ascending: false }),
      fetchAllCheckins(house.id, startTs, endTs),
      supabase.from('ticket_orders').select('amount_cents,quantity,event_id,created_at')
        .eq('house_id', house.id).eq('payment_status', 'paid').gte('created_at', startTs).lte('created_at', endTs),
      supabase.from('reservations').select('status,event_id,reservation_date')
        .eq('house_id', house.id).gte('reservation_date', start).lte('reservation_date', end),
    ])

    setTotalClients(totalCliR.count ?? 0)
    const events = evR.data ?? []
    const eventIds = events.map(e => e.id)
    const cins = cinsAll
    const tks = tkR.data ?? []
    const resv = resR.data ?? []
    setReservasPeriodo(resv.filter(r => (r.status ?? '') !== 'cancelled').length)

    // Populate WA list (deduplicated by client — keep latest checkin per client)
    const byClient: Record<string, WACIItem> = {}
    cins.forEach(c => {
      const cl = c.clients as { full_name?: string; gender?: string; phone?: string } | null
      const ev = c.events as { name?: string } | null
      const item: WACIItem = {
        id: (c as { id?: string }).id ?? (c.client_id ?? c.created_at),
        created_at: c.created_at,
        amount_cents: c.amount_cents ?? 0,
        payment_method: c.payment_method ?? '',
        client_id: c.client_id,
        event_name: ev?.name,
        client_name: cl?.full_name,
        phone: cl?.phone,
      }
      if (c.client_id) {
        if (!byClient[c.client_id] || c.created_at > byClient[c.client_id].created_at) byClient[c.client_id] = item
      } else {
        byClient[item.id] = item
      }
    })
    setWaCiList(Object.values(byClient).sort((a, b) => b.created_at.localeCompare(a.created_at)))

    // ── Financeiro ──
    // Cortesia é entrada grátis → não gera receita, mesmo que algum lançamento tenha valor
    const effAmt = (c: { payment_method?: string | null; amount_cents?: number | null }) => c.payment_method === 'cortesia' ? 0 : (c.amount_cents ?? 0)
    const revCheckins = cins.reduce((s, c) => s + effAmt(c), 0)
    const revTickets = tks.reduce((s, t) => s + (t.amount_cents ?? 0), 0)
    const faturamento = revCheckins + revTickets
    setFin({ faturamento, revCheckins, revTickets, checkins: cins.length, ticketMedio: cins.length ? Math.round(revCheckins / cins.length) : 0 })

    // Payment breakdown (period)
    const pm: Record<string, number> = {}
    cins.forEach(c => { const k = c.payment_method ?? 'outros'; pm[k] = (pm[k] ?? 0) + effAmt(c) })
    setPayStats(Object.entries(pm).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v))

    // Monthly evolution
    const byMonth: Record<string, { rev: number; n: number }> = {}
    cins.forEach(c => { const ym = c.created_at.slice(0, 7); if (!byMonth[ym]) byMonth[ym] = { rev: 0, n: 0 }; byMonth[ym].rev += effAmt(c); byMonth[ym].n++ })
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

    // ── Check-ins diários (dia operacional: antes das 8h conta como a noite anterior) ──
    const localDay = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const byDay: Record<string, { n: number; rev: number }> = {}
    cins.forEach(c => {
      const dt = new Date(c.created_at)
      const op = dt.getHours() < 8 ? new Date(dt.getTime() - 86400000) : dt
      const d = localDay(op)
      if (!byDay[d]) byDay[d] = { n: 0, rev: 0 }
      byDay[d].n++; byDay[d].rev += effAmt(c)
    })
    const daily: DailyCI[] = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({
      day: d, label: new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), n: v.n, rev: v.rev,
    }))
    setDailyCI(daily)

    // ── Check-ins por evento (público, pagantes × cortesias, gênero, ocupação) ──
    const evMap: Record<string, EventCI> = {}
    events.forEach(ev => { evMap[ev.id] = { id: ev.id, name: ev.name, date: ev.event_date, genre: (ev as { genre?: string }).genre ?? '', total: 0, pagantes: 0, cortesias: 0, male: 0, female: 0, capacity: (ev as { capacity?: number }).capacity ?? 0, rev: 0, reservas: 0 } })
    const livre: EventCI = { id: '__livre__', name: 'Entrada Livre / Bar', date: '', total: 0, pagantes: 0, cortesias: 0, male: 0, female: 0, capacity: 0, rev: 0, reservas: 0 }
    // Check-ins feitos sem selecionar o evento (event_id nulo) são atribuídos ao evento do
    // dia operacional, quando houver exatamente UM evento naquela data (senão ficam em "Entrada Livre")
    const evByDate: Record<string, string[]> = {}
    events.forEach(ev => { (evByDate[ev.event_date] ??= []).push(ev.id) })
    // Reservas por evento. Prioriza o vínculo; sem ele, casa pela data — e só quando
    // houver UM evento naquele dia, senão a reserva seria atribuída ao evento errado.
    // Mesma regra usada logo abaixo para o check-in sem evento selecionado.
    resv.forEach(r => {
      if ((r.status ?? '') === 'cancelled') return
      const porVinculo = r.event_id && evMap[r.event_id] ? r.event_id : null
      const doDia = evByDate[r.reservation_date]
      const eid = porVinculo ?? (doDia && doDia.length === 1 ? doDia[0] : null)
      if (eid && evMap[eid]) evMap[eid].reservas++
    })
    const opDate = (c: { created_at: string }) => {
      const dt = new Date(c.created_at)
      return localDay(dt.getHours() < 8 ? new Date(dt.getTime() - 86400000) : dt)
    }
    // Canal de aquisição por evento — clientes distintos que fizeram check-in, agrupados pela origem
    const evRef: Record<string, Record<string, Set<string>>> = {}
    cins.forEach(c => {
      let evId = c.event_id
      if (!evId) { const cand = evByDate[opDate(c)]; if (cand && cand.length === 1) evId = cand[0] }
      const m = evId ? evMap[evId] : livre
      if (!m) return
      m.total++; m.rev += effAmt(c)
      const cortesia = c.payment_method === 'cortesia' || (c.amount_cents ?? 0) === 0
      if (cortesia) m.cortesias++; else m.pagantes++
      const g = (c.clients as { gender?: string } | null)?.gender
      if (g === 'feminino') m.female++; else if (g === 'masculino') m.male++
      if (c.client_id) {
        const ref = (c.clients as { referral_source?: string } | null)?.referral_source || '__none__'
        ;((evRef[m.id] ??= {})[ref] ??= new Set()).add(c.client_id)
      }
    })
    const evCIList = [...Object.values(evMap), livre].filter(e => e.total > 0).sort((a, b) => b.total - a.total)
    setEventCI(evCIList)
    const evRefOut: Record<string, { k: string; v: number }[]> = {}
    Object.entries(evRef).forEach(([eid, chans]) => {
      evRefOut[eid] = Object.entries(chans).map(([k, set]) => ({ k, v: set.size })).sort((a, b) => b.v - a.v)
    })
    setEventReferral(evRefOut)

    // ── Comparativo com o período anterior (mesma duração) ──
    const pr = prevRangeFor(period, customStart, customEnd)
    const pStart = pr.start + 'T00:00:00-03', pEnd = pr.end + 'T23:59:59-03'
    const [pCiR, pTkR, pNewR] = await Promise.all([
      supabase.from('checkins').select('amount_cents,payment_method').eq('house_id', house.id).gte('created_at', pStart).lte('created_at', pEnd),
      supabase.from('ticket_orders').select('amount_cents').eq('house_id', house.id).eq('payment_status', 'paid').gte('created_at', pStart).lte('created_at', pEnd),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('house_id', house.id).gte('created_at', pStart).lte('created_at', pEnd),
    ])
    const pCins = pCiR.data ?? [], pTks = pTkR.data ?? []
    const pFat = pCins.reduce((s, c) => s + effAmt(c), 0) + pTks.reduce((s, t) => s + (t.amount_cents ?? 0), 0)
    setPrev({ faturamento: pFat, checkins: pCins.length, novos: pNewR.count ?? 0 })

    // ── Canais de aquisição (clientes cadastrados no período: "como conheceu a casa?") ──
    const refR = await supabase.from('clients').select('referral_source')
      .eq('house_id', house.id).gte('created_at', startTs).lte('created_at', endTs)
    const refCounts: Record<string, number> = {}
    ;(refR.data ?? []).forEach(c => { const k = (c as { referral_source?: string }).referral_source || '__none__'; refCounts[k] = (refCounts[k] ?? 0) + 1 })
    setReferralStats(Object.entries(refCounts).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v))

    // ── Aniversariantes do período (ignora o ano) ──
    const bdSet = mmddSet(start, end)
    const bdR = await supabase.from('clients').select('full_name,phone,birth_date').eq('house_id', house.id).not('birth_date', 'is', null)
    const bdays = (bdR.data ?? [])
      .map(c => {
        const bd = (c.birth_date ?? '').slice(0, 10)
        const mmdd = bd.slice(5, 10)
        return { name: c.full_name ?? '—', phone: c.phone ?? '', date: bd, mmdd }
      })
      .filter(b => b.mmdd && bdSet.has(b.mmdd))
      .sort((a, b) => a.mmdd.localeCompare(b.mmdd))
    setBirthdays(bdays)

    // ── Event-scoped: DRE, promoters, freelancers ──
    if (eventIds.length === 0) {
      setEvPnL([]); setPromoterRank([]); setFreelancerRank([]); setTeamDay([]); setLoading(false); return
    }

    const [frR, plR, riR, promosR, expR, tkTaskR] = await Promise.all([
      supabase.from('event_freelancers').select('event_id,custom_fee_cents,freelancer_id,role,checkin_at,checkout_at,entry_time,freelancers(full_name,daily_rate_cents,pix_key,phone)').in('event_id', eventIds),
      supabase.from('promoter_lists').select('id,name,promoter_id,event_id,fixed_fee_cents,min_entries,entry_fee_cents,consumacao_cents').in('event_id', eventIds),
      supabase.from('reservation_items').select('quantity,unit_cost_cents,reservations!inner(event_id)').in('reservations.event_id', eventIds),
      supabase.from('promoters').select('id,full_name').eq('house_id', house.id),
      supabase.from('event_expenses').select('event_id,amount_cents,kind').in('event_id', eventIds),
      supabase.from('event_tasks').select('event_id,estimated_cost_cents,actual_cost_cents').in('event_id', eventIds),
    ])
    const frs = frR.data ?? []
    const lists = plR.data ?? []
    const ris = riR.data ?? []
    // Despesas manuais (kind='expense') e receitas adicionadas (kind='revenue') por evento
    const expByEvent: Record<string, number> = {}
    const revOtherByEvent: Record<string, number> = {}
    ;(expR.data ?? []).forEach(e => {
      if (!e.event_id) return
      if (e.kind === 'revenue') revOtherByEvent[e.event_id] = (revOtherByEvent[e.event_id] ?? 0) + (e.amount_cents ?? 0)
      else expByEvent[e.event_id] = (expByEvent[e.event_id] ?? 0) + (e.amount_cents ?? 0)
    })
    const taskByEvent: Record<string, number> = {}
    ;(tkTaskR.data ?? []).forEach(t => { if (t.event_id) taskByEvent[t.event_id] = (taskByEvent[t.event_id] ?? 0) + ((t.actual_cost_cents ?? 0) || (t.estimated_cost_cents ?? 0)) })
    const promoNames: Record<string, string> = {}
    ;(promosR.data ?? []).forEach(p => { promoNames[p.id] = p.full_name })

    // Guests per list (one query)
    const listIds = lists.map(l => l.id)
    const guestsByList: Record<string, { total: number; checked: number; revenue: number; vip: number }> = {}
    if (listIds.length) {
      // valor por entrada: mapa (evento|cliente) → valor do check-in (cortesia = 0)
      const ciR = await supabase.from('checkins').select('event_id,client_id,amount_cents,payment_method').in('event_id', eventIds)
      const ciAmt: Record<string, number> = {}
      ;(ciR.data ?? []).forEach(c => { if (c.client_id) ciAmt[`${c.event_id}|${c.client_id}`] = c.payment_method === 'cortesia' ? 0 : (c.amount_cents ?? 0) })
      const gR = await supabase.from('promoter_list_guests').select('list_id,checked_in,client_id,event_id,is_vip').in('list_id', listIds)
      ;(gR.data ?? []).forEach(g => {
        const k = g.list_id as string
        if (!guestsByList[k]) guestsByList[k] = { total: 0, checked: 0, revenue: 0, vip: 0 }
        guestsByList[k].total++
        if (g.checked_in) {
          guestsByList[k].checked++
          if (g.is_vip) guestsByList[k].vip++
          if (g.client_id) guestsByList[k].revenue += ciAmt[`${g.event_id}|${g.client_id}`] ?? 0
        }
      })
    }

    // Freelancer cost per event + ranking
    // "Só quem compareceu": por evento, se houve algum check-in de equipe, conta só os presentes
    const evHasFrCheckin: Record<string, boolean> = {}
    frs.forEach(f => { if ((f as { checkin_at?: string }).checkin_at) evHasFrCheckin[f.event_id as string] = true })
    const frCostByEvent: Record<string, number> = {}
    const frRankMap: Record<string, FreelancerRank> = {}
    const blank = (id: string, name: string): FreelancerRank => ({ id, name, cost: 0, events: 0, scaled: 0, present: 0, hours: 0, late: 0, rating: null })
    frs.forEach(f => {
      const ff = f as { checkin_at?: string; checkout_at?: string; entry_time?: string; custom_fee_cents?: number }
      const fid = (f.freelancer_id as string) ?? 'x'
      const nome = (f.freelancers as { full_name?: string } | null)?.full_name ?? '—'
      if (!frRankMap[fid]) frRankMap[fid] = blank(fid, nome)
      const row = frRankMap[fid]
      // Escala e presença (independem da regra de custo)
      row.scaled++
      if (ff.checkin_at) {
        row.present++
        if (ff.checkout_at) row.hours += Math.max(0, (new Date(ff.checkout_at).getTime() - new Date(ff.checkin_at).getTime()) / 3600000)
        // Atraso: comparado ao horário previsto de entrada (entry_time 'HH:MM')
        if (ff.entry_time) {
          const ci = new Date(ff.checkin_at)
          const [eh, em] = ff.entry_time.split(':').map(Number)
          if (!isNaN(eh) && (ci.getHours() * 60 + ci.getMinutes()) > (eh * 60 + (em || 0)) + 10) row.late++
        }
      }
      // Custo: "só quem compareceu" (se o evento teve check-in de equipe)
      if (evHasFrCheckin[f.event_id as string] && !ff.checkin_at) return
      const daily = (f.freelancers as { daily_rate_cents?: number } | null)?.daily_rate_cents ?? 0
      const fee = ff.custom_fee_cents ?? daily
      frCostByEvent[f.event_id] = (frCostByEvent[f.event_id] ?? 0) + fee
      row.cost += fee; row.events++
    })
    // Folha do dia: detalhe por pessoa (entrada/saída/horas/valor/PIX) para fechar o pagamento
    const evName: Record<string, string> = {}
    events.forEach(e => { evName[e.id] = (e as { name?: string }).name ?? '—' })
    setTeamDay(frs.map(f => {
      const ff = f as { checkin_at?: string; checkout_at?: string; custom_fee_cents?: number; role?: string }
      const fr = f.freelancers as { full_name?: string; daily_rate_cents?: number; pix_key?: string; phone?: string } | null
      const naoVeio = evHasFrCheckin[f.event_id as string] && !ff.checkin_at
      return {
        id: (f.freelancer_id as string) ?? Math.random().toString(36),
        name: fr?.full_name ?? '—',
        role: ff.role ?? undefined,
        event: evName[f.event_id as string] ?? '—',
        checkin: ff.checkin_at, checkout: ff.checkout_at,
        hours: (ff.checkin_at && ff.checkout_at)
          ? (new Date(ff.checkout_at).getTime() - new Date(ff.checkin_at).getTime()) / 3600000 : null,
        fee: naoVeio ? 0 : (ff.custom_fee_cents ?? fr?.daily_rate_cents ?? 0),
        pix: fr?.pix_key ?? undefined,
        phone: fr?.phone ?? undefined,
      }
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))

    // Nota média das avaliações no período
    const { data: ratingsR } = await supabase.from('team_ratings')
      .select('freelancer_id,rating').eq('house_id', house.id).in('event_id', eventIds)
    const ratAcc: Record<string, { s: number; n: number }> = {}
    ;(ratingsR ?? []).forEach(r => {
      const fid = r.freelancer_id as string; const v = Number(r.rating)
      if (!fid || isNaN(v)) return
      if (!ratAcc[fid]) ratAcc[fid] = { s: 0, n: 0 }
      ratAcc[fid].s += v; ratAcc[fid].n++
    })
    Object.entries(ratAcc).forEach(([fid, a]) => { if (frRankMap[fid] && a.n > 0) frRankMap[fid].rating = a.s / a.n })
    setFreelancerRank(Object.values(frRankMap).sort((a, b) => b.cost - a.cost))

    // Promoter cost per event + ranking
    const promoCostByEvent: Record<string, number> = {}
    const promoRankMap: Record<string, PromoterRank> = {}
    lists.forEach(l => {
      const g = guestsByList[l.id] ?? { total: 0, checked: 0, revenue: 0, vip: 0 }
      const ent = Math.max(g.total, l.min_entries ?? 0)
      const cost = (l.fixed_fee_cents ?? 0) + ent * (l.entry_fee_cents ?? 0) + ent * (l.consumacao_cents ?? 0)
      promoCostByEvent[l.event_id] = (promoCostByEvent[l.event_id] ?? 0) + cost
      const pid = (l.promoter_id as string) ?? l.id
      if (!promoRankMap[pid]) promoRankMap[pid] = { id: pid, name: promoNames[pid] ?? l.name ?? '—', guests: 0, checked: 0, cost: 0, revenue: 0, vip: 0 }
      promoRankMap[pid].guests += g.total; promoRankMap[pid].checked += g.checked; promoRankMap[pid].cost += cost
      promoRankMap[pid].revenue += g.revenue; promoRankMap[pid].vip += g.vip
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
    cins.forEach(c => { if (c.event_id) ciRevByEvent[c.event_id] = (ciRevByEvent[c.event_id] ?? 0) + effAmt(c) })
    const tkRevByEvent: Record<string, number> = {}
    tks.forEach(t => { if (t.event_id) tkRevByEvent[t.event_id] = (tkRevByEvent[t.event_id] ?? 0) + (t.amount_cents ?? 0) })

    const pnl: EvPnL[] = events.map(ev => {
      // Cachê/consumação: usa o array artists[] (soma) quando existir; senão os campos legados
      const artists = ((ev as { artists?: Array<{ fee_cents?: number; consumption_cents?: number }> }).artists) ?? []
      const artistFee = artists.length ? artists.reduce((s, a) => s + (a.fee_cents ?? 0), 0) : (ev.artist_fee_cents ?? 0)
      const artistCons = artists.length ? artists.reduce((s, a) => s + (a.consumption_cents ?? 0), 0) : (ev.consumption_cents ?? 0)
      return {
        id: ev.id, name: ev.name, date: ev.event_date,
        rev_checkins: ciRevByEvent[ev.id] ?? 0,
        rev_tickets: tkRevByEvent[ev.id] ?? 0,
        rev_other: revOtherByEvent[ev.id] ?? 0,
        cost_artist: artistFee,
        cost_freelancers: frCostByEvent[ev.id] ?? 0,
        cost_promoters: promoCostByEvent[ev.id] ?? 0,
        cost_res_items: riCostByEvent[ev.id] ?? 0,
        cost_production: ev.production_cost_cents ?? 0,
        cost_consumacao: artistCons,
        cost_expenses: expByEvent[ev.id] ?? 0,
        cost_tasks: taskByEvent[ev.id] ?? 0,
      }
    })
    setEvPnL(pnl)
    setLoading(false)
  }

  useEffect(() => { load() }, [house.id, period, customStart, customEnd])

  // Comparativo por dia da semana (últimas 6 sextas, sábados, etc.) — independente do período selecionado
  useEffect(() => {
    if (!house.id) return
    const localDay = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const COMPARE_DAYS = 42
    supabase.rpc('checkins_daily', { p_house: house.id, p_days: COMPARE_DAYS })
      .then((rw: { data: Array<{ day: string; n: number; rev: number }> | null }) => {
        const byDay: Record<string, { n: number; rev: number }> = {}
        ;(rw.data ?? []).forEach(row => { byDay[row.day] = { n: row.n, rev: row.rev } })
        const arr: DailyCI[] = []
        for (let di = COMPARE_DAYS - 1; di >= 0; di--) {
          const dt = new Date(); dt.setDate(dt.getDate() - di)
          const ds = localDay(dt)
          arr.push({ day: ds, label: dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), n: byDay[ds]?.n ?? 0, rev: byDay[ds]?.rev ?? 0 })
        }
        setWeekdayCompare(arr)
      })
  }, [house.id])

  // ── Acessos: quem esteve na casa em um dia operacional (08:00 do dia → 07:59 do dia seguinte) ──
  async function loadAcessos(day: string) {
    if (!day) { setAcessoList([]); return }
    setAcessoLoading(true)
    const next = new Date(day + 'T12:00'); next.setDate(next.getDate() + 1)
    const startTs = day + 'T08:00:00'
    const endTs = isoDay(next) + 'T07:59:59'
    const { data } = await supabase.from('checkins')
      .select('created_at,amount_cents,payment_method,clients(full_name,phone,gender),events(name)')
      .eq('house_id', house.id).gte('created_at', startTs).lte('created_at', endTs)
      .order('created_at')
    const list: AcessoItem[] = (data ?? []).map(c => {
      const cl = c.clients as { full_name?: string; phone?: string; gender?: string } | null
      const ev = c.events as { name?: string } | null
      return {
        name: cl?.full_name ?? 'Visitante',
        phone: cl?.phone ?? '',
        gender: cl?.gender ?? '',
        time: new Date(c.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        pay: c.payment_method ?? '',
        amount: c.payment_method === 'cortesia' ? 0 : (c.amount_cents ?? 0),
        event: ev?.name ?? '',
      }
    })
    setAcessoList(list)
    setAcessoLoading(false)
  }

  // ── Listas & Reservas: convidados pré-cadastrados (listas de promoters/casa) e reservas de um dia ──
  async function loadListasDia(day: string) {
    if (!day) { setListaGuests([]); setListaReservas([]); return }
    setListasLoading(true)
    const [evR, resR] = await Promise.all([
      supabase.from('events').select('id,name,event_date').eq('house_id', house.id).eq('event_date', day),
      supabase.from('reservations').select('id,name,phone,people_count,status,location,expected_arrival,event_id,reservation_date,events(name)')
        .eq('house_id', house.id).eq('reservation_date', day).neq('status', 'cancelled')
        .order('expected_arrival'),
    ])
    const events = (evR.data ?? []) as Array<{ id: string; name: string; event_date: string }>
    const evNameById: Record<string, string> = {}
    events.forEach(e => { evNameById[e.id] = e.name })
    const eventIds = events.map(e => e.id)

    const reservas: ListaReservaItem[] = (resR.data ?? []).map(r => {
      const ev = r.events as { name?: string } | null
      return {
        id: r.id, name: r.name ?? '—', phone: r.phone ?? '', peopleCount: r.people_count ?? 0,
        status: r.status ?? '', location: r.location ?? '', expectedArrival: r.expected_arrival ?? '',
        eventName: ev?.name ?? (r.event_id ? (evNameById[r.event_id] ?? '') : ''),
      }
    })
    setListaReservas(reservas)

    let guests: ListaGuestItem[] = []
    if (eventIds.length > 0) {
      const { data: gData } = await supabase.from('promoter_list_guests')
        .select('full_name,phone,is_vip,checked_in,confirmed_at,event_id,promoter_lists(name,promoters(full_name))')
        .in('event_id', eventIds)
        .order('full_name')
      guests = ((gData ?? []) as Array<{ full_name: string; phone?: string; is_vip?: boolean; checked_in?: boolean; confirmed_at?: string; event_id?: string; promoter_lists?: { name?: string; promoters?: { full_name?: string } } | null }>).map(g => {
        const pl = g.promoter_lists
        const promoName = pl?.promoters?.full_name
        const isHouse = promoName === 'Lista da Casa'
        return {
          name: g.full_name, phone: g.phone ?? '',
          listName: isHouse ? 'Lista da Casa' : (promoName ?? pl?.name ?? 'Lista'),
          isVip: !!g.is_vip, confirmed: !!g.confirmed_at, checkedIn: !!g.checked_in,
          eventName: g.event_id ? (evNameById[g.event_id] ?? '') : '',
        }
      })
    }
    setListaGuests(guests)
    setListasLoading(false)
  }

  // Ao abrir a aba Acessos pela primeira vez, sugere hoje
  useEffect(() => {
    if (reportTab === 'acessos' && !acessoDay) {
      const today = isoDay(new Date())
      setAcessoDay(today); loadAcessos(today); loadListasDia(today)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportTab])

  function exportAcessosCSV() {
    if (acessoList.length === 0) return
    const header = ['Nome', 'Telefone', 'Genero', 'Hora', 'Pagamento', 'Valor', 'Evento']
    const rows = acessoList.map(a => [a.name, a.phone, a.gender, a.time, payLabel(a.pay), (a.amount / 100).toFixed(2).replace('.', ','), a.event])
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `acessos-${acessoDay}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  function openWAPanel() {
    setShowWA(true); setWaSearch(''); setWaSelected(new Set()); setWaImage('')
    supabase.from('events').select('id,name,event_date,flyer_url,price_male_list_cents,price_female_list_cents')
      .eq('house_id', house.id).gte('event_date', new Date().toISOString().slice(0, 10)).neq('status', 'cancelado')
      .order('event_date').limit(30)
      .then(r => {
        const evs = (r.data ?? []) as InviteEvent[]
        setWaInviteEvents(evs); setWaInviteEventId(evs[0]?.id ?? '')
      })
  }

  async function ensureHouseList(eventId: string): Promise<{ token: string; listId: string; promoterId: string } | null> {
    let promoterId: string | undefined
    const { data: pr } = await supabase.from('promoters').select('id').eq('house_id', house.id).eq('full_name', 'Lista da Casa').limit(1).maybeSingle()
    promoterId = pr?.id
    if (!promoterId) {
      const { data: np } = await supabase.from('promoters').insert({ house_id: house.id, full_name: 'Lista da Casa', phone: '', commission_pct: 0, fixed_fee_cents: 0, min_entries: 0, entry_fee_cents: 0, consumacao_cents: 0 }).select('id').single()
      promoterId = np?.id
    }
    if (!promoterId) return null
    const { data: list } = await supabase.from('promoter_lists').select('id,token').eq('house_id', house.id).eq('event_id', eventId).eq('promoter_id', promoterId).limit(1).maybeSingle()
    if (list) {
      if (list.token) return { token: list.token, listId: list.id, promoterId }
      const token = crypto.randomUUID()
      await supabase.from('promoter_lists').update({ token }).eq('id', list.id)
      return { token, listId: list.id, promoterId }
    }
    const token = crypto.randomUUID()
    const { data: newList } = await supabase.from('promoter_lists').insert({ house_id: house.id, event_id: eventId, promoter_id: promoterId, name: 'Lista da Casa', token, fixed_fee_cents: 0, min_entries: 0, entry_fee_cents: 0, consumacao_cents: 0 }).select('id').single()
    return newList ? { token, listId: newList.id, promoterId } : null
  }

  async function sendGiftBulk() {
    if (!waMsg.trim()) { sT(setToast, 'Escreva a mensagem do brinde', 'warn'); return }
    const recipients = waCiList.filter(ci => waSelected.has(ci.id) && ci.phone)
    if (recipients.length === 0) { sT(setToast, 'Selecione ao menos uma pessoa com telefone', 'warn'); return }
    const { data: cfg } = await supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1).single()
    const useEvolution = !!(cfg?.active && cfg?.api_url && cfg?.instance_name && cfg?.api_key)
    if (!useEvolution && waImage) { sT(setToast, 'Configure o WhatsApp para enviar imagens.', 'warn'); return }
    if (!confirm(`Enviar brinde para ${recipients.length} pessoa(s)?`)) return
    setWaSending(true); setWaProgress({ sent: 0, total: recipients.length })
    const { fmtWAPhone } = await import('../utils/whatsapp')
    let ok = 0
    for (const ci of recipients) {
      const name = ci.client_name ?? ''
      const msg = waMsg.replace(/\{nome\}/g, name.split(' ')[0]).replace(/\{casa\}/g, house.name || '')
      const fph = fmtWAPhone(ci.phone ?? '')
      if (useEvolution && fph) {
        try {
          const useMedia = !!waImage
          const mediaBase64 = waImage.includes(',') ? waImage.split(',')[1] : waImage
          const body = useMedia
            ? { number: fph, mediatype: 'image', media: mediaBase64, caption: msg }
            : { number: fph, text: msg, linkPreview: true }
          const resp = await fetch(`${cfg.api_url}/message/${useMedia ? 'sendMedia' : 'sendText'}/${cfg.instance_name}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.api_key }, body: JSON.stringify(body),
          })
          const res = await resp.json()
          const sent = !!(res?.key || res?.status === 'success' || res?.status === 'PENDING')
          if (sent) ok++
          await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: name, message_type: 'gift', message_body: msg, status: sent ? 'sent' : 'failed', error_msg: sent ? null : JSON.stringify(res), related_client_id: ci.client_id ?? null })
        } catch (e: any) {
          await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: name, message_type: 'gift', message_body: msg, status: 'failed', error_msg: e?.message ?? 'erro' })
        }
        await new Promise(r => setTimeout(r, 500))
      } else {
        window.open(`https://wa.me/55${cn(ci.phone ?? '')}?text=${encodeURIComponent(msg)}`, '_blank')
        ok++; await new Promise(r => setTimeout(r, 800))
      }
      setWaProgress(p => p ? { ...p, sent: p.sent + 1 } : p)
    }
    setWaSending(false); setWaProgress(null); setWaSelected(new Set())
    sT(setToast, `✅ ${ok} mensagem${ok !== 1 ? 's' : ''} enviada${ok !== 1 ? 's' : ''}!`, 'success')
  }

  async function sendInviteBulk() {
    const ev = waInviteEvents.find(e => e.id === waInviteEventId)
    if (!ev) { sT(setToast, 'Selecione o evento do convite', 'warn'); return }
    const recipients = waCiList.filter(ci => waSelected.has(ci.id) && ci.phone)
    if (recipients.length === 0) { sT(setToast, 'Selecione ao menos uma pessoa com telefone', 'warn'); return }
    const { data: cfg } = await supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1).single()
    if (!(cfg?.active && cfg?.api_url && cfg?.instance_name && cfg?.api_key)) { sT(setToast, 'Ative o WhatsApp em Configurações para enviar convites.', 'warn'); return }
    if (!confirm(`Enviar convite de "${ev.name}" para ${recipients.length} pessoa(s)?`)) return
    const rec = await ensureHouseList(ev.id)
    if (!rec) { sT(setToast, 'Não foi possível criar a lista da promoção.', 'error'); return }
    const effFriends = waFriendsOn ? (waFriends === 0 ? 9999 : waFriends) : 0
    const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    const valParts = [(ev.price_male_list_cents ?? 0) > 0 ? `♂ ${fmtCurrency(ev.price_male_list_cents ?? 0)}` : '', (ev.price_female_list_cents ?? 0) > 0 ? `♀ ${fmtCurrency(ev.price_female_list_cents ?? 0)}` : ''].filter(Boolean)
    const linhaVal = valParts.length ? `\n💵 Lista: ${valParts.join(' · ')}` : ''
    setWaSending(true); setWaProgress({ sent: 0, total: recipients.length })
    const { fmtWAPhone } = await import('../utils/whatsapp')
    let ok = 0
    for (const ci of recipients) {
      const name = ci.client_name ?? 'Visitante'
      const phoneDigits = (ci.phone ?? '').replace(/\D/g, '')
      const fph = fmtWAPhone(ci.phone ?? '')
      if (!fph) { setWaProgress(p => p ? { ...p, sent: p.sent + 1 } : p); continue }
      let token: string
      const { data: existing } = await supabase.from('promoter_list_guests')
        .select('id,invite_token').eq('list_id', rec.listId).eq('phone', phoneDigits).limit(1).maybeSingle()
      if (existing?.id) {
        token = existing.invite_token || crypto.randomUUID()
        await supabase.from('promoter_list_guests').update({ invite_token: token, max_plus_ones: effFriends }).eq('id', existing.id)
      } else {
        token = crypto.randomUUID()
        await supabase.from('promoter_list_guests').insert({
          list_id: rec.listId, house_id: house.id, event_id: ev.id, promoter_id: rec.promoterId,
          full_name: name, phone: phoneDigits || null, client_id: ci.client_id ?? null,
          list_type: 'promoter', is_vip: false, promoter_confirmed: false, invite_token: token, max_plus_ones: effFriends,
        })
      }
      const confirmLink = `${window.location.origin}/confirmar/${token}`
      const plusMsg = effFriends > 0 ? `\n\n👥 Pode trazer ${effFriends >= 9999 ? 'seus amigos' : `até ${effFriends} amigo(s)`} — eles confirmam pelo mesmo link!` : ''
      const msg = `🎉 Olá ${name.split(' ')[0]}! Você está na promoção de *${ev.name}* — ${dateStr}!${linhaVal}\n\n✅ Confirme sua presença com 1 clique e apresente o flyer na entrada:\n${confirmLink}${plusMsg}\n\nTe esperamos! 🔥`
      const useMedia = !!ev.flyer_url
      const body = useMedia ? { number: fph, mediatype: 'image', media: ev.flyer_url, caption: msg } : { number: fph, text: msg }
      try {
        const resp = await fetch(`${cfg.api_url}/message/${useMedia ? 'sendMedia' : 'sendText'}/${cfg.instance_name}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.api_key }, body: JSON.stringify(body),
        })
        const res = await resp.json()
        const sent = !!(res?.key || res?.status === 'success' || res?.status === 'PENDING')
        if (sent) ok++
        await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: name, message_type: 'promo_invite', message_body: msg, status: sent ? 'sent' : 'failed', error_msg: sent ? null : JSON.stringify(res), related_client_id: ci.client_id ?? null, related_event_id: ev.id })
      } catch (e: any) {
        await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: name, message_type: 'promo_invite', message_body: msg, status: 'failed', error_msg: e?.message ?? 'erro', related_event_id: ev.id })
      }
      setWaProgress(p => p ? { ...p, sent: p.sent + 1 } : p)
      await new Promise(r => setTimeout(r, 500))
    }
    setWaSending(false); setWaProgress(null); setWaSelected(new Set())
    sT(setToast, `✅ ${ok} convite${ok !== 1 ? 's' : ''} enviado${ok !== 1 ? 's' : ''}! Quem confirmar entra na lista da promoção.`, 'success')
  }

  function loadWAImage(file: File) {
    const reader = new FileReader()
    reader.onload = e => { const r = e.target?.result as string; if (r) setWaImage(r) }
    reader.readAsDataURL(file)
  }

  function toggleWASelected(id: string) {
    setWaSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function createListBulk() {
    const ev = waInviteEvents.find(e => e.id === waInviteEventId)
    if (!ev) { sT(setToast, 'Selecione o evento', 'warn'); return }
    const listName = waListName.trim() || `${waListIsVip ? 'VIP' : 'Promoção'} · ${label}`
    const recipients = waCiList.filter(ci => waSelected.has(ci.id))
    if (recipients.length === 0) { sT(setToast, 'Selecione ao menos uma pessoa', 'warn'); return }
    if (!confirm(`Criar lista "${listName}" com ${recipients.length} pessoa(s) no evento "${ev.name}"?`)) return

    // Cria promoter "Lista da Casa" e lista nomeada
    let promoterId: string | undefined
    const { data: pr } = await supabase.from('promoters').select('id').eq('house_id', house.id).eq('full_name', 'Lista da Casa').limit(1).maybeSingle()
    promoterId = pr?.id
    if (!promoterId) {
      const { data: np } = await supabase.from('promoters').insert({ house_id: house.id, full_name: 'Lista da Casa', phone: '', commission_pct: 0, fixed_fee_cents: 0, min_entries: 0, entry_fee_cents: 0, consumacao_cents: 0 }).select('id').single()
      promoterId = np?.id
    }
    if (!promoterId) { sT(setToast, 'Erro ao criar promoter base.', 'error'); return }

    const listPriceCents = Math.round((parseFloat(waListPrice.replace(',', '.')) || 0) * 100)
    const token = crypto.randomUUID()
    const { data: newList } = await supabase.from('promoter_lists').insert({
      house_id: house.id, event_id: ev.id, promoter_id: promoterId,
      name: listName, token, fixed_fee_cents: 0, min_entries: 0, entry_fee_cents: 0, consumacao_cents: 0,
    }).select('id').single()
    if (!newList) { sT(setToast, 'Erro ao criar lista.', 'error'); return }

    // Insere convidados
    const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    let cfg: Record<string, string> | null = null
    if (waListNotify) {
      const { data } = await supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1).single()
      cfg = data
    }
    const { fmtWAPhone } = await import('../utils/whatsapp')

    setWaSending(true); setWaProgress({ sent: 0, total: recipients.length })
    let added = 0, notified = 0
    for (const ci of recipients) {
      const name = ci.client_name ?? 'Visitante'
      const phoneDigits = (ci.phone ?? '').replace(/\D/g, '')
      const inviteToken = crypto.randomUUID()
      await supabase.from('promoter_list_guests').insert({
        list_id: newList.id, house_id: house.id, event_id: ev.id, promoter_id: promoterId,
        full_name: name, phone: phoneDigits || null, client_id: ci.client_id ?? null,
        list_type: 'promoter', is_vip: waListIsVip, promoter_confirmed: true,
        invite_token: inviteToken, max_plus_ones: waListFriends,
        list_value_cents: listPriceCents > 0 ? listPriceCents : null,
      })
      added++

      // Notificação WhatsApp
      if (waListNotify && ci.phone && cfg?.active && cfg?.api_url && cfg?.instance_name && cfg?.api_key) {
        const fph = fmtWAPhone(ci.phone)
        if (fph) {
          const confirmLink = `${window.location.origin}/confirmar/${inviteToken}`
          const msg = waListMsg
            .replace(/\{nome\}/g, name.split(' ')[0])
            .replace(/\{casa\}/g, house.name || '')
            .replace(/\{lista\}/g, listName)
            .replace(/\{evento\}/g, ev.name)
            .replace(/\{data\}/g, dateStr)
            + `\n\n🔗 Confirme: ${confirmLink}`
          const useMedia = !!ev.flyer_url
          const body = useMedia
            ? { number: fph, mediatype: 'image', media: ev.flyer_url, caption: msg }
            : { number: fph, text: msg }
          try {
            const resp = await fetch(`${cfg.api_url}/message/${useMedia ? 'sendMedia' : 'sendText'}/${cfg.instance_name}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.api_key }, body: JSON.stringify(body),
            })
            const res = await resp.json()
            if (res?.key || res?.status === 'success' || res?.status === 'PENDING') notified++
          } catch { /* continua */ }
          await new Promise(r => setTimeout(r, 400))
        }
      }
      setWaProgress(p => p ? { ...p, sent: p.sent + 1 } : p)
    }
    setWaSending(false); setWaProgress(null); setWaSelected(new Set())
    sT(setToast, `✅ Lista "${listName}" criada com ${added} pessoa${added !== 1 ? 's' : ''}${notified > 0 ? ` · ${notified} notificado${notified !== 1 ? 's' : ''} pelo WhatsApp` : ''}.`, 'success')
  }

  // ── Exports ──
  function exportPnLCSV() {
    const hdr = 'Evento,Data,Receita Portaria,Receita Ingressos,Receita Total,Cachê,Freelancers,Promoters,Opcionais,Produção,Consumação,Custo Total,Resultado'
    const lines = evPnL.map(e => {
      const rev = pnlRev(e)
      const cost = pnlCost(e)
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

  function exportEventCICSV() {
    const hdr = 'Evento,Data,Reservas,Total Check-ins,Pagantes,Cortesias,Masculino,Feminino,Capacidade,Ocupacao %,Receita'
    const lines = eventCI.map(e => {
      const occ = e.capacity > 0 ? Math.round(e.total / e.capacity * 100) : ''
      return [e.name, e.date, e.reservas, e.total, e.pagantes, e.cortesias, e.male, e.female, e.capacity || '', occ, (e.rev / 100).toFixed(2).replace('.', ',')]
        .map(v => typeof v === 'number' ? v : `"${String(v).replace(/"/g, '""')}"`).join(';')
    })
    download(`publico-por-evento-${start}-${end}.csv`, hdr + '\n' + lines.join('\n'), ';')
  }

  function exportBirthdaysCSV() {
    const hdr = 'Nome,Telefone,Nascimento,Dia'
    const lines = birthdays.map(b => [b.name, b.phone, b.date, b.mmdd.replace('-', '/')].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    download(`aniversariantes-${start}-${end}.csv`, hdr + '\n' + lines.join('\n'), ',')
  }

  function exportPayrollCSV() {
    const hhmm = (s?: string) => s ? new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
    const hdr = 'Colaborador,Funcao,Evento,Entrada,Saida,Horas,A pagar,PIX,Telefone'
    const lines = teamDay.map(f => [
      f.name, f.role ?? '', f.event, hhmm(f.checkin) || (f.checkin ? '' : 'FALTOU'), hhmm(f.checkout),
      f.hours != null ? f.hours.toFixed(1).replace('.', ',') : '',
      (f.fee / 100).toFixed(2).replace('.', ','), f.pix ?? '', f.phone ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    const total = teamDay.reduce((s, f) => s + f.fee, 0)
    lines.push(`"TOTAL";"";"";"";"";"";"${(total / 100).toFixed(2).replace('.', ',')}";"";""`)
    download(`folha-equipe-${start}.csv`, hdr + '\n' + lines.join('\n'), ';')
  }

  function exportTeamCSV() {
    const hdr = 'Colaborador,Escalado,Presencas,Faltas,Presenca %,Horas,Atrasos,Nota media,Custo'
    const lines = freelancerRank.map(f => {
      const pPct = f.scaled > 0 ? Math.round(f.present / f.scaled * 100) : 0
      return [f.name, f.scaled, f.present, f.scaled - f.present, pPct, f.hours.toFixed(1).replace('.', ','), f.late,
        f.rating != null ? f.rating.toFixed(1).replace('.', ',') : '', (f.cost / 100).toFixed(2).replace('.', ',')]
        .map(v => typeof v === 'number' ? v : `"${String(v).replace(/"/g, '""')}"`).join(';')
    })
    download(`equipe-${start}-${end}.csv`, hdr + '\n' + lines.join('\n'), ';')
  }

  function exportPromotersCSV() {
    const hdr = 'Promoter,Convidados,Entradas,Entradas VIP,Valor Entradas,Conversao %,Custo por Cabeca'
    const lines = promoterRank.map(p => {
      const pct = p.guests ? Math.round(p.checked / p.guests * 100) : 0
      const perHead = p.checked ? Math.round(p.cost / p.checked) : 0
      return [p.name, p.guests, p.checked, p.vip, (p.revenue / 100).toFixed(2).replace('.', ','), pct, (perHead / 100).toFixed(2).replace('.', ',')]
        .map(v => typeof v === 'number' ? v : `"${String(v).replace(/"/g, '""')}"`).join(';')
    })
    download(`promoters-${start}-${end}.csv`, hdr + '\n' + lines.join('\n'), ';')
  }

  function download(name: string, csv: string, _sep: string) {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = name
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // ── Derived ──
  const totRev = evPnL.reduce((s, e) => s + pnlRev(e), 0)
  const totCost = evPnL.reduce((s, e) => s + pnlCost(e), 0)
  const totProfit = totRev - totCost
  const avgMargin = totRev > 0 ? Math.round(totProfit / totRev * 100) : 0
  const monthMax = Math.max(...monthly.map(m => m.rev), 1)
  const dayMax = Math.max(...dailyCI.map(d => d.n), 1)
  const ciPagantes = eventCI.reduce((s, e) => s + e.pagantes, 0)
  const ciCortesias = eventCI.reduce((s, e) => s + e.cortesias, 0)
  const pctCortesias = (ciPagantes + ciCortesias) > 0 ? Math.round(ciCortesias / (ciPagantes + ciCortesias) * 100) : 0
  const pctDelta = (curr: number, prv: number): number | null => prv > 0 ? Math.round((curr - prv) / prv * 100) : null
  const totalPay = payStats.reduce((s, p) => s + p.v, 0)
  const topClientMax = Math.max(...topClients.map(c => c.count), 1)

  const periods: { k: PeriodKey; label: string }[] = [
    { k: 'month', label: 'Mês atual' }, { k: '30d', label: '30 dias' }, { k: '90d', label: '90 dias' }, { k: 'year', label: 'Ano' }, { k: 'custom', label: 'Personalizado' },
  ]

  const kpis: { label: string; value: string; color: string; d?: number | null; sub?: string }[] = [
    { label: 'Faturamento', value: fmtCurrency(fin.faturamento), color: C.grn, d: pctDelta(fin.faturamento, prev.faturamento) },
    { label: 'Check-ins', value: fin.checkins.toLocaleString('pt-BR'), color: C.acc, d: pctDelta(fin.checkins, prev.checkins) },
    { label: 'Ticket Médio', value: fmtCurrency(fin.ticketMedio), color: C.gold },
    { label: 'Eventos', value: evPnL.length.toLocaleString('pt-BR'), color: '#a78bfa', sub: reservasPeriodo > 0 ? `🪑 ${reservasPeriodo.toLocaleString('pt-BR')} reservas` : undefined },
    { label: 'Novos Clientes', value: clientStats.novos.toLocaleString('pt-BR'), color: '#f59e0b', d: pctDelta(clientStats.novos, prev.novos) },
    { label: 'Cortesias', value: `${pctCortesias}%`, color: '#fbbf24', sub: `${ciCortesias} de ${ciPagantes + ciCortesias}` },
  ]

  const sectionTitle = (t: string) => <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>{t}</div>

  // Relatório da equipe — usado no card do Geral e na aba dedicada 👷 Equipe
  const teamCard = (
    <Card>
      {sectionTitle('👷 Desempenho da Equipe')}
      {freelancerRank.length === 0
        ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem freelancers escalados no período.</div>
        : <>
          {(() => {
            const scaled = freelancerRank.reduce((s, f) => s + f.scaled, 0)
            const present = freelancerRank.reduce((s, f) => s + f.present, 0)
            const hours = freelancerRank.reduce((s, f) => s + f.hours, 0)
            const cost = freelancerRank.reduce((s, f) => s + f.cost, 0)
            const presPct = scaled > 0 ? Math.round(present / scaled * 100) : 0
            const cards = [
              { l: 'Presença', v: `${presPct}%`, c: presPct >= 90 ? C.grn : presPct >= 70 ? C.gold : C.red },
              { l: 'Faltas', v: String(scaled - present), c: scaled - present > 0 ? C.red : C.grn },
              { l: 'Horas', v: hours > 0 ? `${hours.toFixed(0)}h` : '—', c: C.acc },
              { l: 'Custo', v: fmtCurrency(cost), c: C.gold },
            ]
            return (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {cards.map((k, i) => (
                  <div key={i} style={{ flex: '1 1 80px', background: C.bg, border: `1px solid ${k.c}33`, borderRadius: 10, padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ color: k.c, fontSize: 16, fontWeight: 900 }}>{k.v}</div>
                    <div style={{ color: C.mut, fontSize: 10, fontWeight: 600, marginTop: 2 }}>{k.l}</div>
                  </div>
                ))}
              </div>
            )
          })()}
          <div className="r-scroll-x"><div style={{ minWidth: 480 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 58px 46px 48px 42px 84px', gap: 4, padding: '4px 6px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.04em' }}>
              <div>COLABORADOR</div>
              <div style={{ textAlign: 'right' }} title="Presenças / vezes escalado">PRES.</div>
              <div style={{ textAlign: 'right' }} title="Horas trabalhadas (entrada → saída)">HORAS</div>
              <div style={{ textAlign: 'right' }} title="Chegadas com mais de 10 min de atraso">ATRASO</div>
              <div style={{ textAlign: 'right' }} title="Nota média das avaliações">NOTA</div>
              <div style={{ textAlign: 'right' }} title="Custo no período (só dias em que compareceu)">CUSTO</div>
            </div>
            {/* Teto de 12 linhas: a lista inteira empurrava o resto do relatório para
                fora da tela. Rola por dentro em vez de esticar a página. */}
            <div className="r-scroll-y" style={{ maxHeight: LINHAS_VISIVEIS * ALTURA_LINHA, overflowY: 'auto' }}>
            {freelancerRank.map((f, i) => {
              const pPct = f.scaled > 0 ? Math.round(f.present / f.scaled * 100) : 0
              return (
                <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 58px 46px 48px 42px 84px', gap: 4, padding: '8px 6px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ color: C.mut, fontSize: 11, width: 16 }}>#{i + 1}</span>
                    <span style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  </div>
                  <div style={{ textAlign: 'right', color: pPct >= 90 ? C.grn : pPct >= 70 ? C.gold : C.red, fontWeight: 700 }}>{f.present}/{f.scaled}</div>
                  <div style={{ textAlign: 'right', color: C.sub }}>{f.hours > 0 ? `${f.hours.toFixed(0)}h` : '—'}</div>
                  <div style={{ textAlign: 'right', color: f.late > 0 ? C.red : C.mut, fontWeight: f.late > 0 ? 700 : 400 }}>{f.late || '—'}</div>
                  <div style={{ textAlign: 'right', color: f.rating != null ? (f.rating >= 4 ? C.grn : f.rating >= 3 ? C.gold : C.red) : C.mut, fontWeight: 700 }}>{f.rating != null ? `⭐${f.rating.toFixed(1)}` : '—'}</div>
                  <div style={{ textAlign: 'right', color: C.acc, fontWeight: 700 }}>{fmtCurrency(f.cost)}</div>
                </div>
              )
            })}
            </div>
            {freelancerRank.length > LINHAS_VISIVEIS && (
              <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', padding: '6px 0 0' }}>
                ↕ role para ver os {freelancerRank.length} da equipe
              </div>
            )}
          </div></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}` }}>
            <span style={{ color: C.mut, fontSize: 13 }}>Total equipe</span>
            <span style={{ color: C.acc, fontSize: 15, fontWeight: 900 }}>{fmtCurrency(freelancerRank.reduce((s, f) => s + f.cost, 0))}</span>
          </div>
        </>
      }
    </Card>
  )

  return (
    <div style={{ paddingBottom: 40 }}>
      <Toast toast={toast} />
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
            <span style={{ color: C.mut, fontSize: 13, fontWeight: 700 }}>📅 Dia do evento:</span>
            <input type="date" value={customStart} onChange={e => { setCustomStart(e.target.value); setCustomEnd(e.target.value) }} style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }} />
          </div>
        )}
        {/* Imprime a aba atual já com o período selecionado (CSS @media print limpa a tela) */}
        <button onClick={() => window.print()} title="Imprimir / salvar em PDF o relatório desta aba"
          style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: 10, border: `1px solid ${C.brd}`, background: 'transparent', color: C.sub, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          🖨️ Imprimir
        </button>
      </div>

      {/* Cabeçalho que só aparece na impressão */}
      <div className="print-only print-head">
        <div style={{ fontSize: 18, fontWeight: 900 }}>
          {house.name || 'NightPass'} — {reportTab === 'equipe' ? 'Relatório da Equipe' : reportTab === 'budget' ? 'Budget por Evento' : reportTab === 'acessos' ? 'Relatório de Acessos' : reportTab === 'eventos' ? 'Relatório por Evento' : 'Relatório Geral'}
        </div>
        <div style={{ fontSize: 12 }}>Período: {label} ({new Date(start + 'T12:00').toLocaleDateString('pt-BR')} a {new Date(end + 'T12:00').toLocaleDateString('pt-BR')}) · Emitido em {new Date().toLocaleString('pt-BR')}</div>
      </div>

      {/* Seletor de relatório (abas) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {([['geral', '📊 Geral'], ['budget', '💰 Budget'], ['acessos', '🚪 Acessos'], ['eventos', '🎭 Por Evento'], ['equipe', '👷 Equipe']] as const).map(([t, lbl]) => (
          <button key={t} onClick={() => setReportTab(t)}
            style={{ padding: '9px 18px', borderRadius: 10, border: `1px solid ${reportTab === t ? C.acc : C.brd}`, background: reportTab === t ? C.acc + '22' : 'transparent', color: reportTab === t ? C.acc : C.mut, fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
            {lbl}
          </button>
        ))}
      </div>

      {reportTab === 'geral' && (<>
      {/* Export dropdown (agrupa os CSVs num só botão p/ não poluir a tela) */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {(() => {
          const items: Array<{ label: string; onClick: () => void }> = [
            { label: exporting ? '⏳ Exportando…' : '📥 Check-ins (CSV)', onClick: exportCSV },
            { label: '👥 Clientes (CSV)', onClick: exportClients },
            ...(eventCI.length > 0 ? [{ label: '👥 Público por evento (CSV)', onClick: exportEventCICSV }] : []),
            ...(promoterRank.length > 0 ? [{ label: '📣 Promoters (CSV)', onClick: exportPromotersCSV }] : []),
            ...(freelancerRank.length > 0 ? [{ label: '👷 Equipe (CSV)', onClick: exportTeamCSV }] : []),
            ...(evPnL.length > 0 ? [{ label: '💼 DRE por evento (CSV)', onClick: exportPnLCSV }] : []),
            { label: '🖨️ Imprimir / PDF', onClick: () => window.print() },
          ]
          return (
            <div style={{ position: 'relative' }}>
              <Btn onClick={() => setExportOpen(o => !o)} disabled={exporting}>📤 Exportar {exportOpen ? '▲' : '▼'}</Btn>
              {exportOpen && (<>
                <div onClick={() => setExportOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 41, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 6, minWidth: 230, boxShadow: '0 14px 36px rgba(0,0,0,0.35)', display: 'grid', gap: 2 }}>
                  {items.map((it, i) => (
                    <button key={i} onClick={() => { setExportOpen(false); it.onClick() }}
                      style={{ textAlign: 'left', background: 'none', border: 'none', borderRadius: 8, padding: '9px 12px', color: C.txt, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget.style.background = C.acc + '15')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      {it.label}
                    </button>
                  ))}
                </div>
              </>)}
            </div>
          )
        })()}
        {waCiList.length > 0 && (
          <button onClick={openWAPanel}
            style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid #25D36644', background: '#25D36618', color: '#25D366', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
            🎯 Campanhas ({waCiList.filter(c => c.phone).length})
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 20 }}>
        {kpis.map((k, i) => (
          <div key={i} className="card-3d" style={{ background: 'var(--c-kpi-grad)', border: '1px solid rgba(59,130,246,0.12)', borderTop: `3px solid ${k.color}`, borderRadius: 16, padding: '16px 18px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), 0 4px 8px rgba(0,0,0,0.35), 0 16px 32px rgba(0,0,0,0.5)', transform: 'translateY(-3px)' }}>
            <div style={{ color: C.mut, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{k.label}</div>
            <div className="dre-kpi-val" style={{ color: k.color, fontSize: 24, fontWeight: 900, letterSpacing: '-0.02em' }}>{k.value}</div>
            {k.d !== null && k.d !== undefined && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 5, fontSize: 11, fontWeight: 700, color: k.d > 0 ? C.grn : k.d < 0 ? C.red : C.mut }}>
                {k.d > 0 ? '▲' : k.d < 0 ? '▼' : '■'} {Math.abs(k.d)}% <span style={{ color: C.mut, fontWeight: 500 }}>vs anterior</span>
              </div>
            )}
            {k.sub && <div style={{ color: C.mut, fontSize: 10, marginTop: 5 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Evolução mensal + Formas de pagamento */}
      <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
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

      {/* Canais de aquisição */}
      {(() => {
        const totalRef = referralStats.reduce((s, r) => s + r.v, 0)
        const informados = referralStats.filter(r => r.k !== '__none__').reduce((s, r) => s + r.v, 0)
        return (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: C.txt }}>📣 Canais de aquisição</div>
                <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>Como os clientes novos conheceram a casa — {label}</div>
              </div>
              {totalRef > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: C.acc, fontSize: 20, fontWeight: 900 }}>{totalRef}</div>
                  <div style={{ color: C.mut, fontSize: 10 }}>novos cadastros{informados < totalRef ? ` · ${informados} c/ resposta` : ''}</div>
                </div>
              )}
            </div>
            {totalRef === 0
              ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Nenhum cliente novo cadastrado no período.</div>
              : referralStats.map((rs, i) => {
                const m = refMeta(rs.k)
                const pct = Math.round(rs.v / (totalRef || 1) * 100)
                return (
                  <div key={i} style={{ marginBottom: 11 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 14 }}>{m.icon}</span>
                        <span style={{ color: C.sub, fontSize: 13 }}>{m.label}</span>
                      </div>
                      <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{rs.v} <span style={{ color: C.mut, fontSize: 11 }}>· {pct}%</span></span>
                    </div>
                    <div style={{ background: C.brd, borderRadius: 4, height: 4, overflow: 'hidden' }}>
                      <div style={{ background: m.color, height: '100%', width: `${pct}%`, transition: 'width .5s', borderRadius: 4 }} />
                    </div>
                  </div>
                )
              })
            }
          </Card>
        )
      })()}

      {/* Check-ins diários */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.txt }}>🚪 Check-ins por dia</div>
            <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>Movimento da portaria — {label}</div>
          </div>
          {dailyCI.length > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: C.acc, fontSize: 20, fontWeight: 900 }}>{Math.round(fin.checkins / dailyCI.length)}</div>
              <div style={{ color: C.mut, fontSize: 10 }}>média/dia</div>
            </div>
          )}
        </div>
        {dailyCI.length === 0
          ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Sem check-ins no período.</div>
          : <div className="r-scroll-x"><div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150, minWidth: dailyCI.length * 26 }}>
              {dailyCI.map((d, i) => (
                <div key={i} title={`${d.label}: ${d.n} check-ins · ${fmtCurrency(d.rev)}`} style={{ flex: 1, minWidth: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, marginBottom: 3 }}>{d.n}</div>
                  <div style={{ width: '100%', maxWidth: 30, background: d.n >= dayMax ? 'linear-gradient(180deg,#10b981,#059669)' : 'linear-gradient(180deg,#3b82f6,#1e3a8a)', borderRadius: 5, height: `${Math.max(4, (d.n / dayMax) * 100)}%`, transition: 'height .4s' }} />
                  <div style={{ fontSize: 9, color: C.mut, marginTop: 5, whiteSpace: 'nowrap' }}>{d.label}</div>
                </div>
              ))}
            </div></div>
        }
      </Card>

      {/* Comparativo por dia da semana (ex.: últimas 4 sextas-feiras) */}
      {weekdayCompare.length > 0 && (() => {
        const WDSING = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
        const WDPLUR = ['domingos', 'segundas-feiras', 'terças-feiras', 'quartas-feiras', 'quintas-feiras', 'sextas-feiras', 'sábados']
        const todayDow = new Date().getDay()
        const sameDow = weekdayCompare.filter(d => new Date(d.day + 'T12:00').getDay() === compareDow).slice(-6)
        const maxN = Math.max(...sameDow.map(d => d.n), 1)
        const nowD = new Date()
        const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`
        return (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 2 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.txt }}>🔁 Comparativo — {WDPLUR[compareDow]}</div>
              <select value={compareDow} onChange={e => setCompareDow(Number(e.target.value))}
                style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '5px 10px', color: C.txt, fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
                {WDSING.map((w, i) => <option key={i} value={i}>{w}{i === todayDow ? ' (hoje)' : ''}</option>)}
              </select>
            </div>
            {sameDow.length < 2 ? (
              <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Ainda não há histórico suficiente para {WDPLUR[compareDow]}.</div>
            ) : (
              <>
                <div style={{ color: C.mut, fontSize: 12, marginTop: 2, marginBottom: 14 }}>Fluxo de pessoas e ticket médio nos últimos {sameDow.length} {WDPLUR[compareDow]}</div>
                <div className="r-scroll-x" style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'flex', gap: 10, minWidth: sameDow.length * 84 }}>
                    {sameDow.map((d, i) => {
                      const isToday = d.day === todayStr
                      const avgTicket = d.n > 0 ? d.rev / d.n : 0
                      return (
                        <div key={i} style={{ flex: '1 0 74px', minWidth: 74, textAlign: 'center', background: isToday ? C.acc + '14' : 'transparent', border: isToday ? `1px solid ${C.acc}44` : '1px solid transparent', borderRadius: 12, padding: '10px 4px' }}>
                          <div style={{ fontSize: 11, color: isToday ? C.acc : C.mut, fontWeight: isToday ? 800 : 600, marginBottom: 8 }}>
                            {isToday ? 'Hoje' : d.label}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', height: 56 }}>
                            <div style={{ width: '60%', background: isToday ? C.acc : (d.n > 0 ? '#94a3b8' : C.brd), borderRadius: 4, height: Math.max(4, (d.n / maxN) * 56), transition: 'height .3s' }} />
                          </div>
                          <div style={{ fontSize: 16, color: isToday ? C.acc : C.txt, fontWeight: 900, marginTop: 6 }}>{d.n}</div>
                          <div style={{ fontSize: 10, color: C.mut, marginBottom: 4 }}>pessoas</div>
                          <div style={{ fontSize: 12, color: C.grn, fontWeight: 700 }}>{fmtCurrency(avgTicket)}</div>
                          <div style={{ fontSize: 9, color: C.mut }}>ticket médio</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {(() => {
                  const totalN = sameDow.reduce((s, d) => s + d.n, 0)
                  const totalR = sameDow.reduce((s, d) => s + d.rev, 0)
                  const avgN = totalN / sameDow.length
                  const avgTicketAll = totalN > 0 ? totalR / totalN : 0
                  const others = sameDow.filter(d => d.day !== todayStr)
                  const avgNOthers = others.length ? others.reduce((s, d) => s + d.n, 0) / others.length : null
                  const todayEntry = sameDow.find(d => d.day === todayStr)
                  const half = Math.ceil(sameDow.length / 2)
                  const avgFirstHalf = sameDow.slice(0, half).reduce((s, d) => s + d.n, 0) / half
                  const avgSecondHalf = sameDow.slice(half).reduce((s, d) => s + d.n, 0) / (sameDow.length - half)
                  const trend = avgSecondHalf > avgFirstHalf * 1.08 ? 'up' : avgSecondHalf < avgFirstHalf * 0.92 ? 'down' : 'stable'
                  const trendLabel = trend === 'up' ? '📈 tendência de alta' : trend === 'down' ? '📉 tendência de queda' : '➡️ estável'
                  const trendColor = trend === 'up' ? C.grn : trend === 'down' ? C.red : C.mut
                  const diffPct = todayEntry && avgNOthers && avgNOthers > 0 ? Math.round((todayEntry.n - avgNOthers) / avgNOthers * 100) : null
                  return (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.brd}`, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
                      <span style={{ color: C.mut }}>Média: <strong style={{ color: C.txt }}>{Math.round(avgN)} pessoas</strong> · <strong style={{ color: C.grn }}>{fmtCurrency(avgTicketAll)}</strong></span>
                      {diffPct !== null && (
                        <span style={{ color: diffPct >= 0 ? C.grn : C.red, fontWeight: 700 }}>
                          {diffPct >= 0 ? '▲' : '▼'} Hoje {Math.abs(diffPct)}% {diffPct >= 0 ? 'acima' : 'abaixo'} da média
                        </span>
                      )}
                      <span style={{ color: trendColor, fontWeight: 700 }}>{trendLabel}</span>
                    </div>
                  )
                })()}
              </>
            )}
          </Card>
        )
      })()}

      {/* Check-ins por evento (público) */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.txt }}>👥 Público por Evento</div>
            <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>Presença, pagantes × cortesias e gênero — {label}</div>
          </div>
          {eventCI.length > 0 && (
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: C.grn, fontSize: 18, fontWeight: 900 }}>{ciPagantes.toLocaleString('pt-BR')}</div>
                <div style={{ color: C.mut, fontSize: 10 }}>pagantes</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: C.gold, fontSize: 18, fontWeight: 900 }}>{ciCortesias.toLocaleString('pt-BR')}</div>
                <div style={{ color: C.mut, fontSize: 10 }}>cortesias</div>
              </div>
            </div>
          )}
        </div>
        {eventCI.length === 0
          ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem check-ins no período.</div>
          : <div className="r-scroll-x"><div style={{ minWidth: 665 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px 70px 70px 90px 80px', gap: 4, padding: '4px 8px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em' }}>
              <div>EVENTO</div>
              <div style={{ textAlign: 'right' }} title="Reservas do evento (não canceladas)">RESERVAS</div>
              <div style={{ textAlign: 'right' }}>TOTAL</div><div style={{ textAlign: 'right' }}>PAG./CORT.</div><div style={{ textAlign: 'right' }}>♂ / ♀</div><div style={{ textAlign: 'right' }}>OCUPAÇÃO</div>
            </div>
            <div className="r-scroll-y" style={{ maxHeight: LINHAS_VISIVEIS * ALTURA_LINHA, overflowY: 'auto' }}>
            {eventCI.map(e => {
              const occ = e.capacity > 0 ? Math.round(e.total / e.capacity * 100) : 0
              return (
                <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1fr 62px 70px 70px 90px 80px', gap: 4, padding: '9px 8px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                    {e.date && <div style={{ color: C.mut, fontSize: 11 }}>{fd(e.date)}</div>}
                  </div>
                  <div style={{ textAlign: 'right', color: e.reservas > 0 ? C.gold : C.mut, fontWeight: 700 }}>{e.reservas || '—'}</div>
                  <div style={{ textAlign: 'right', color: C.acc, fontWeight: 800 }}>{e.total}</div>
                  <div style={{ textAlign: 'right', fontSize: 12 }}>
                    <span style={{ color: C.grn, fontWeight: 700 }}>{e.pagantes}</span>
                    <span style={{ color: C.mut }}> / </span>
                    <span style={{ color: C.gold }}>{e.cortesias}</span>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 12 }}>
                    <span style={{ color: C.acc }}>{e.male}</span>
                    <span style={{ color: C.mut }}> / </span>
                    <span style={{ color: '#f472b6' }}>{e.female}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {e.capacity > 0
                      ? <span style={{ background: (occ >= 80 ? C.grn : occ >= 50 ? C.gold : C.red) + '22', color: occ >= 80 ? C.grn : occ >= 50 ? C.gold : C.red, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{occ}%</span>
                      : <span style={{ color: C.mut, fontSize: 11 }}>—</span>}
                  </div>
                </div>
              )
            })}
            </div>
            {eventCI.length > LINHAS_VISIVEIS && (
              <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', padding: '6px 0 0' }}>
                ↕ role para ver os {eventCI.length} eventos
              </div>
            )}
          </div></div>
        }
      </Card>

      {/* DRE por evento */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.txt }}>💼 DRE por Evento</div>
          <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>Receita vs. Custo vs. Resultado — {label}</div>
        </div>

        {evPnL.length === 0
          ? <div style={{ color: C.mut, textAlign: 'center', padding: '24px 0', fontSize: 13 }}>Nenhum evento no período selecionado.</div>
          : <>
            <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Receita Total', value: fmtCurrency(totRev), color: C.grn },
                { label: 'Custo Total', value: fmtCurrency(totCost), color: C.red },
                { label: 'Resultado', value: fmtCurrency(totProfit), color: totProfit >= 0 ? C.grn : C.red },
                { label: 'Margem Média', value: `${avgMargin}%`, color: avgMargin >= 0 ? C.grn : C.red },
              ].map((k, i) => (
                <div key={i} style={{ background: C.bg, border: `1px solid ${k.color}33`, borderTop: `3px solid ${k.color}`, borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
                  <div style={{ color: C.mut, fontSize: 11, fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>{k.label.toUpperCase()}</div>
                  <div className="dre-kpi-val" style={{ color: k.color, fontSize: 20, fontWeight: 900 }}>{k.value}</div>
                </div>
              ))}
            </div>

            <div className="r-scroll-x"><div style={{ minWidth: 540 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 70px', gap: 4, padding: '6px 8px', background: C.bg, borderRadius: 8, marginBottom: 6 }}>
              {['Evento', 'Receita', 'Custos', 'Resultado', 'Margem'].map((h, i) => (
                <div key={i} style={{ color: C.mut, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textAlign: i > 0 ? 'right' : 'left' }}>{h}</div>
              ))}
            </div>

            <div className="r-scroll-y" style={{ maxHeight: LINHAS_VISIVEIS * ALTURA_LINHA_DRE, overflowY: 'auto' }}>
            {evPnL.map(e => {
              const rev = pnlRev(e)
              const cost = pnlCost(e)
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
                    {e.cost_expenses > 0 && <span style={{ color: '#ef4444' }}>🧾 {fmtCurrency(e.cost_expenses)}</span>}
                    {e.cost_tasks > 0 && <span style={{ color: '#22d3ee' }}>✅ {fmtCurrency(e.cost_tasks)}</span>}
                    {e.rev_tickets > 0 && <span style={{ color: C.grn }}>🎫 {fmtCurrency(e.rev_tickets)}</span>}
                    {e.rev_other > 0 && <span style={{ color: C.grn }}>➕ {fmtCurrency(e.rev_other)}</span>}
                  </div>
                </div>
              )
            })}
            </div>
            {evPnL.length > LINHAS_VISIVEIS && (
              <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', padding: '6px 0 0' }}>
                ↕ role para ver os {evPnL.length} eventos
              </div>
            )}
            </div></div>
          </>
        }
      </Card>

      {/* Promoters + Equipe */}
      <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card>
          {sectionTitle('📣 Desempenho de Promoters')}
          {promoterRank.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem listas de promoter no período.</div>
            : <>
              <div className="r-scroll-x"><div style={{ minWidth: 560 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 50px 50px 42px 80px 44px 74px', gap: 4, padding: '4px 6px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.04em' }}>
                <div>PROMOTER</div>
                <div style={{ textAlign: 'right' }} title="Convidados na lista">CONV.</div>
                <div style={{ textAlign: 'right' }} title="Entradas (check-ins) da lista">ENTR.</div>
                <div style={{ textAlign: 'right' }} title="Entradas VIP da lista">VIP</div>
                <div style={{ textAlign: 'right' }} title="Valor das entradas da lista">R$ ENTR.</div>
                <div style={{ textAlign: 'right' }} title="Conversão (entradas ÷ convidados)">%</div>
                <div style={{ textAlign: 'right' }} title="Custo por cabeça">R$/CAB</div>
              </div>
              {/* Antes cortava em 8 e o resto sumia. Agora todos ficam alcançáveis,
                  com o mesmo teto de 12 linhas visíveis. */}
              <div className="r-scroll-y" style={{ maxHeight: LINHAS_VISIVEIS * ALTURA_LINHA, overflowY: 'auto' }}>
              {promoterRank.map((p, i) => {
                const pct = p.guests ? Math.round(p.checked / p.guests * 100) : 0
                const perHead = p.checked ? Math.round(p.cost / p.checked) : 0
                return (
                  <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 50px 50px 42px 80px 44px 74px', gap: 4, padding: '8px 6px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ color: C.mut, fontSize: 11, width: 16 }}>#{i + 1}</span>
                      <span style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    </div>
                    <div style={{ textAlign: 'right', color: C.txt, fontWeight: 700 }}>{p.guests}</div>
                    <div style={{ textAlign: 'right', color: C.grn, fontWeight: 700 }}>{p.checked}</div>
                    <div style={{ textAlign: 'right', color: p.vip > 0 ? C.gold : C.mut, fontWeight: 700 }}>{p.vip || '—'}</div>
                    <div style={{ textAlign: 'right', color: C.sub, fontWeight: 600 }}>{p.revenue > 0 ? fmtCurrency(p.revenue) : '—'}</div>
                    <div style={{ textAlign: 'right', color: pct >= 60 ? C.grn : pct >= 30 ? C.gold : C.red, fontWeight: 700 }}>{pct}%</div>
                    <div style={{ textAlign: 'right', color: C.sub }}>{perHead > 0 ? fmtCurrency(perHead) : '—'}</div>
                  </div>
                )
              })}
              </div>
              {promoterRank.length > LINHAS_VISIVEIS && (
                <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', padding: '6px 0 0' }}>
                  ↕ role para ver os {promoterRank.length} promoters
                </div>
              )}
              </div></div>
            </>
          }
        </Card>

        {teamCard}
      </div>

      {/* Clientes + Operacional */}
      <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          {sectionTitle('🏆 Clientes')}
          <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
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
          <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
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

      {/* Aniversariantes do período */}
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.txt }}>🎂 Aniversariantes</div>
            <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>Clientes que fazem aniversário no período — {label}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#f472b6', fontSize: 20, fontWeight: 900 }}>{birthdays.length}</div>
              <div style={{ color: C.mut, fontSize: 10 }}>no período</div>
            </div>
            {birthdays.length > 0 && <Btn onClick={exportBirthdaysCSV} variant="secondary" small>📥 CSV</Btn>}
          </div>
        </div>
        {birthdays.length === 0
          ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum aniversariante no período.</div>
          : <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              {birthdays.slice(0, 30).map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px' }}>
                  <div style={{ width: 40, flexShrink: 0, textAlign: 'center', background: '#f472b618', border: '1px solid #f472b633', borderRadius: 8, padding: '4px 0' }}>
                    <div style={{ color: '#f472b6', fontSize: 14, fontWeight: 900, lineHeight: 1 }}>{b.mmdd.slice(3)}</div>
                    <div style={{ color: C.mut, fontSize: 9 }}>{['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(b.mmdd.slice(0, 2))]}</div>
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: C.txt, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                    {b.phone && <div style={{ color: C.mut, fontSize: 11 }}>{b.phone}</div>}
                  </div>
                </div>
              ))}
            </div>
        }
        {birthdays.length > 30 && <div style={{ color: C.mut, fontSize: 11, marginTop: 10, textAlign: 'center' }}>+{birthdays.length - 30} — use o CSV para a lista completa</div>}
      </Card>
      </>)}

      {/* ══════════ BUDGET ══════════ */}
      {/* ── ABA EQUIPE ── */}
      {reportTab === 'equipe' && (<>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          {start === end && teamDay.length > 0 && <Btn onClick={exportPayrollCSV} variant="secondary" small>📥 Folha do dia (CSV)</Btn>}
          {freelancerRank.length > 0 && <Btn onClick={exportTeamCSV} variant="secondary" small>📥 Equipe (CSV)</Btn>}
        </div>

        {/* Folha de pagamento do dia — só quando o período é uma data específica */}
        {start === end && (
          <Card style={{ marginBottom: 16 }}>
            {sectionTitle('💸 Folha do dia — entrada, saída e PIX')}
            {teamDay.length === 0
              ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Ninguém escalado nesta data.</div>
              : <>
                <div className="r-scroll-x"><div style={{ minWidth: 620 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 58px 58px 50px 84px 1.1fr', gap: 4, padding: '4px 6px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.04em' }}>
                    <div>COLABORADOR</div>
                    <div style={{ textAlign: 'center' }}>ENTRADA</div>
                    <div style={{ textAlign: 'center' }}>SAÍDA</div>
                    <div style={{ textAlign: 'center' }}>HORAS</div>
                    <div style={{ textAlign: 'right' }}>A PAGAR</div>
                    <div>PIX</div>
                  </div>
                  {teamDay.map((f, i) => {
                    const hhmm = (s?: string) => s ? new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
                    const faltou = !f.checkin
                    return (
                      <div key={f.id + i} style={{ display: 'grid', gridTemplateColumns: '1fr 58px 58px 50px 84px 1.1fr', gap: 4, padding: '9px 6px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13, opacity: faltou ? 0.55 : 1 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                          {f.role && <div style={{ color: C.mut, fontSize: 10 }}>{f.role}</div>}
                        </div>
                        <div style={{ textAlign: 'center', color: faltou ? C.red : C.grn, fontWeight: 700 }}>{hhmm(f.checkin) ?? 'faltou'}</div>
                        <div style={{ textAlign: 'center', color: C.gold, fontWeight: 700 }}>{hhmm(f.checkout) ?? '—'}</div>
                        <div style={{ textAlign: 'center', color: C.acc, fontWeight: 700 }}>{f.hours != null ? `${f.hours.toFixed(1)}h` : '—'}</div>
                        <div style={{ textAlign: 'right', color: f.fee > 0 ? C.txt : C.mut, fontWeight: 800 }}>{f.fee > 0 ? fmtCurrency(f.fee) : '—'}</div>
                        <div style={{ minWidth: 0, color: f.pix ? C.sub : C.mut, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={f.pix ?? 'PIX não cadastrado'}>{f.pix ?? '⚠️ sem PIX'}</div>
                      </div>
                    )
                  })}
                </div></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.brd}` }}>
                  <span style={{ color: C.mut, fontSize: 13 }}>
                    Total a pagar · {teamDay.filter(f => f.fee > 0).length} de {teamDay.length} compareceram
                  </span>
                  <span style={{ color: C.grn, fontSize: 16, fontWeight: 900 }}>{fmtCurrency(teamDay.reduce((s, f) => s + f.fee, 0))}</span>
                </div>
                {teamDay.some(f => !f.pix && f.fee > 0) && (
                  <div style={{ color: C.gold, fontSize: 11, marginTop: 8 }}>
                    ⚠️ {teamDay.filter(f => !f.pix && f.fee > 0).length} colaborador(es) a pagar sem PIX cadastrado — complete em Equipe.
                  </div>
                )}
              </>
            }
          </Card>
        )}

        {teamCard}
        <div style={{ color: C.mut, fontSize: 11, marginTop: 10, lineHeight: 1.6 }}>
          <strong style={{ color: C.sub }}>Como ler:</strong> <b>PRES.</b> = presenças/vezes escalado (check-in da equipe na Portaria) ·
          <b> HORAS</b> = entrada → saída · <b>ATRASO</b> = chegadas +10 min após o horário previsto ·
          <b> NOTA</b> = média das avaliações · <b>CUSTO</b> = só os dias em que compareceu (mesma regra do budget).
        </div>
      </>)}

      {reportTab === 'budget' && (() => {
        const budgetRows = evPnL
        const bRev = budgetRows.reduce((s, e) => s + pnlRev(e), 0)
        const bCost = budgetRows.reduce((s, e) => s + pnlCost(e), 0)
        const bProfit = bRev - bCost
        const bMargin = bRev > 0 ? Math.round(bProfit / bRev * 100) : 0
        return (
        <>
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {evPnL.length > 0 && <Btn onClick={exportPnLCSV} variant="secondary">💼 Exportar DRE CSV</Btn>}
          <Btn onClick={() => window.print()} variant="secondary">🖨️ Imprimir / PDF</Btn>
        </div>
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.txt, marginBottom: 4 }}>💰 Budget por Evento (DRE)</div>
          <div style={{ color: C.mut, fontSize: 12, marginBottom: 14 }}>Receita, custos e resultado de cada evento — {label} · toque num evento para ver o detalhamento</div>
          {budgetRows.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Sem eventos com movimento no período.</div>
            : <>
              <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
                {[
                  { label: 'Receita Total', value: fmtCurrency(bRev), color: C.grn },
                  { label: 'Custo Total', value: fmtCurrency(bCost), color: C.red },
                  { label: 'Resultado', value: fmtCurrency(bProfit), color: bProfit >= 0 ? C.grn : C.red },
                  { label: 'Margem Média', value: `${bMargin}%`, color: bMargin >= 0 ? C.grn : C.red },
                ].map((k, i) => (
                  <div key={i} style={{ background: C.bg, border: `1px solid ${k.color}33`, borderTop: `3px solid ${k.color}`, borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
                    <div style={{ color: C.mut, fontSize: 11, fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>{k.label.toUpperCase()}</div>
                    <div className="dre-kpi-val" style={{ color: k.color, fontSize: 20, fontWeight: 900 }}>{k.value}</div>
                  </div>
                ))}
              </div>
              <div className="r-scroll-x"><div style={{ minWidth: 540 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 70px', gap: 4, padding: '6px 8px', background: C.bg, borderRadius: 8, marginBottom: 6 }}>
                  {['Evento', 'Receita', 'Custos', 'Resultado', 'Margem'].map((h, i) => (
                    <div key={i} style={{ color: C.mut, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textAlign: i > 0 ? 'right' : 'left' }}>{h}</div>
                  ))}
                </div>
                {budgetRows.map(e => {
                  const rev = pnlRev(e)
                  const cost = pnlCost(e)
                  const profit = rev - cost
                  const margin = rev > 0 ? Math.round((profit / rev) * 100) : 0
                  const isProfit = profit >= 0
                  const open = budgetOpen === e.id
                  return (
                    <div key={e.id} style={{ borderBottom: `1px solid ${C.brd}`, background: open ? 'rgba(59,130,246,0.05)' : 'transparent', borderRadius: open ? 8 : 0 }}>
                      <div onClick={() => setBudgetOpen(open ? null : e.id)}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px 70px', gap: 4, padding: '10px 8px', alignItems: 'center', cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ color: C.mut, fontSize: 11, transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: C.txt, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                            <div style={{ color: C.mut, fontSize: 11 }}>{fd(e.date)}</div>
                          </div>
                        </div>
                        <div style={{ color: C.grn, fontWeight: 600, fontSize: 13, textAlign: 'right' }}>{fmtCurrency(rev)}</div>
                        <div style={{ color: C.red, fontWeight: 600, fontSize: 13, textAlign: 'right' }}>{fmtCurrency(cost)}</div>
                        <div style={{ color: isProfit ? C.grn : C.red, fontWeight: 800, fontSize: 13, textAlign: 'right' }}>{isProfit ? '+' : ''}{fmtCurrency(profit)}</div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ background: (isProfit ? C.grn : C.red) + '22', color: isProfit ? C.grn : C.red, borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{margin}%</span>
                        </div>
                      </div>
                      {!open
                        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 8px 8px 22px', fontSize: 11 }}>
                            {e.cost_artist > 0 && <span style={{ color: C.gold }}>🎤 {fmtCurrency(e.cost_artist)}</span>}
                            {e.cost_freelancers > 0 && <span style={{ color: C.acc }}>👷 {fmtCurrency(e.cost_freelancers)}</span>}
                            {e.cost_promoters > 0 && <span style={{ color: '#a78bfa' }}>📋 {fmtCurrency(e.cost_promoters)}</span>}
                            {e.cost_res_items > 0 && <span style={{ color: C.gold }}>🪑 {fmtCurrency(e.cost_res_items)}</span>}
                            {e.cost_production > 0 && <span style={{ color: '#8b5cf6' }}>🔧 {fmtCurrency(e.cost_production)}</span>}
                            {e.cost_consumacao > 0 && <span style={{ color: '#f59e0b' }}>🍺 {fmtCurrency(e.cost_consumacao)}</span>}
                            {e.rev_tickets > 0 && <span style={{ color: C.grn }}>🎫 {fmtCurrency(e.rev_tickets)}</span>}
                    {e.rev_other > 0 && <span style={{ color: C.grn }}>➕ {fmtCurrency(e.rev_other)}</span>}
                          </div>
                        : <div style={{ padding: '4px 8px 14px 22px' }}>
                            <div style={{ fontSize: 11, color: C.grn, fontWeight: 700, letterSpacing: '0.05em', margin: '6px 0 4px' }}>RECEITAS</div>
                            {([['🚪 Portaria (check-ins)', e.rev_checkins], ['🎫 Ingressos antecipados', e.rev_tickets], ['➕ Receitas adicionadas', e.rev_other]] as const).filter(([, v]) => v > 0).map(([lbl, val], i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', color: C.sub }}>
                                <span>{lbl}</span><span style={{ color: C.grn, fontWeight: 600 }}>{fmtCurrency(val)}</span>
                              </div>
                            ))}
                            <div style={{ fontSize: 11, color: C.red, fontWeight: 700, letterSpacing: '0.05em', margin: '10px 0 4px' }}>CUSTOS</div>
                            {([['🎤 Artistas / atrações', e.cost_artist], ['👷 Equipe / freelancers', e.cost_freelancers], ['📋 Promoters', e.cost_promoters], ['🪑 Itens de reservas', e.cost_res_items], ['🔧 Produção', e.cost_production], ['🍺 Consumação', e.cost_consumacao]] as const).filter(([, v]) => v > 0).map(([lbl, val], i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', color: C.sub }}>
                                <span>{lbl}</span><span style={{ color: C.red, fontWeight: 600 }}>{fmtCurrency(val)}</span>
                              </div>
                            ))}
                            {cost === 0 && <div style={{ fontSize: 12, color: C.mut, padding: '3px 0' }}>Sem custos lançados.</div>}
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '8px 0 0', marginTop: 8, borderTop: `1px solid ${C.brd}`, fontWeight: 800 }}>
                              <span style={{ color: C.txt }}>Resultado</span>
                              <span style={{ color: isProfit ? C.grn : C.red }}>{isProfit ? '+' : ''}{fmtCurrency(profit)} · {margin}%</span>
                            </div>
                          </div>
                      }
                    </div>
                  )
                })}
              </div></div>
            </>
          }
        </Card>
        </>
        )
      })()}

      {/* ══════════ ACESSOS ══════════ */}
      {reportTab === 'acessos' && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.txt }}>🚪 Acessos do dia</div>
              <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>Clientes que estiveram na casa na data escolhida (noite operacional: 08h → 08h do dia seguinte)</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="search" value={acessoView === 'entradas' ? acessoSearch : listasSearch}
                onChange={e => acessoView === 'entradas' ? setAcessoSearch(e.target.value) : setListasSearch(e.target.value)}
                placeholder="🔍 Buscar por nome…"
                style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit', minWidth: 180 }} />
              <input type="date" value={acessoDay}
                onChange={e => { const d = e.target.value; if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) { setAcessoDay(d); loadAcessos(d); loadListasDia(d) } }}
                style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
              {acessoView === 'entradas' && acessoList.length > 0 && <Btn onClick={exportAcessosCSV} variant="secondary" small>📥 CSV</Btn>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {([['entradas', '🚪 Quem entrou'], ['listas', '📋 Listas & Reservas']] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setAcessoView(v)}
                style={{ padding: '7px 14px', borderRadius: 10, border: `1px solid ${acessoView === v ? C.acc : C.brd}`, background: acessoView === v ? C.acc + '22' : 'transparent', color: acessoView === v ? C.acc : C.mut, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                {lbl}
              </button>
            ))}
          </div>

          {acessoView === 'listas' ? (
            !acessoDay
              ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Escolha uma data para consultar listas e reservas.</div>
              : listasLoading
                ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Carregando…</div>
                : (listaGuests.length === 0 && listaReservas.length === 0)
                  ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Nenhuma lista ou reserva cadastrada para essa data.</div>
                  : (() => {
                      const q = listasSearch.trim().toLowerCase()
                      const resView = listaReservas.filter(r => !q || r.name.toLowerCase().includes(q))
                      const guestView = listaGuests.filter(g => !q || g.name.toLowerCase().includes(q))
                      const resExpected = resView.reduce((s, r) => s + (r.peopleCount || 0), 0)
                      const resArrived = resView.filter(r => r.status === 'arrived' || r.status === 'confirmado').length
                      const guestGroups: { listName: string; items: ListaGuestItem[] }[] = []
                      guestView.forEach(g => {
                        let grp = guestGroups.find(x => x.listName === g.listName)
                        if (!grp) { grp = { listName: g.listName, items: [] }; guestGroups.push(grp) }
                        grp.items.push(g)
                      })
                      guestGroups.sort((a, b) => (a.listName === 'Lista da Casa' ? -1 : b.listName === 'Lista da Casa' ? 1 : a.listName.localeCompare(b.listName, 'pt-BR')))
                      const guestArrivedTotal = guestView.filter(g => g.checkedIn).length
                      return (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: C.txt }}>🪑 Reservas ({resView.length})</div>
                            {resView.length > 0 && (
                              <span style={{ display: 'flex', gap: 6 }}>
                                <span style={{ background: C.acc + '18', color: C.acc, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>👥 {resExpected} esperados</span>
                                <span style={{ background: C.grn + '18', color: C.grn, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>✅ {resArrived} chegaram</span>
                              </span>
                            )}
                          </div>
                          {resView.length === 0
                            ? <div style={{ color: C.mut, fontSize: 13, padding: '8px 0 20px' }}>Nenhuma reserva nessa data.</div>
                            : <div className="r-scroll-x" style={{ marginBottom: 20 }}><div style={{ minWidth: 560 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px 100px 110px', gap: 4, padding: '4px 8px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em' }}>
                                  <div>NOME</div><div>TELEFONE</div><div style={{ textAlign: 'center' }}>PESSOAS</div><div>EVENTO</div><div style={{ textAlign: 'right' }}>STATUS</div>
                                </div>
                                {resView.map(r => (
                                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px 100px 110px', gap: 4, padding: '8px 8px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13 }}>
                                    <div style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                                    <div style={{ color: C.mut, fontSize: 12 }}>{r.phone ? ftel(r.phone) : '—'}</div>
                                    <div style={{ textAlign: 'center', color: C.sub }}>{r.peopleCount}</div>
                                    <div style={{ color: C.mut, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.eventName || '—'}</div>
                                    <div style={{ textAlign: 'right' }}>
                                      <span style={{ background: (r.status === 'arrived' || r.status === 'confirmado' ? C.grn : C.gold) + '22', color: r.status === 'arrived' || r.status === 'confirmado' ? C.grn : C.gold, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                                        {r.status === 'arrived' || r.status === 'confirmado' ? '✅ Chegou' : '⏳ Aguardando'}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div></div>
                          }
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, color: C.txt }}>👤 Listas — Casa & Promoters ({guestView.length})</div>
                            {guestView.length > 0 && (
                              <span style={{ display: 'flex', gap: 6 }}>
                                <span style={{ background: C.acc + '18', color: C.acc, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>👥 {guestView.length} esperados</span>
                                <span style={{ background: C.grn + '18', color: C.grn, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>✅ {guestArrivedTotal} entraram</span>
                              </span>
                            )}
                          </div>
                          {guestView.length === 0
                            ? <div style={{ color: C.mut, fontSize: 13, padding: '8px 0' }}>Nenhum convidado em lista nessa data.</div>
                            : guestGroups.map(grp => {
                                const arrived = grp.items.filter(g => g.checkedIn).length
                                return (
                                  <div key={grp.listName} style={{ marginBottom: 16 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: C.bg, borderRadius: 8, padding: '6px 10px', marginBottom: 4 }}>
                                      <span style={{ color: grp.listName === 'Lista da Casa' ? C.grn : '#a78bfa', fontWeight: 700, fontSize: 13 }}>{grp.listName === 'Lista da Casa' ? '🏠' : '📣'} {grp.listName}</span>
                                      <span style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}>👥 {grp.items.length} esperados · <span style={{ color: C.grn }}>✅ {arrived} entraram</span></span>
                                    </div>
                                    <div className="r-scroll-x"><div style={{ minWidth: 560 }}>
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 110px', gap: 4, padding: '4px 8px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em' }}>
                                        <div>NOME</div><div>TELEFONE</div><div style={{ textAlign: 'right' }}>STATUS</div>
                                      </div>
                                      {grp.items.map((g, i) => (
                                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 110px', gap: 4, padding: '8px 8px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13 }}>
                                          <div style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.isVip && '⭐ '}{g.name}</div>
                                          <div style={{ color: C.mut, fontSize: 12 }}>{g.phone ? ftel(g.phone) : '—'}</div>
                                          <div style={{ textAlign: 'right' }}>
                                            <span style={{ background: (g.checkedIn ? C.grn : g.confirmed ? C.acc : C.mut) + '22', color: g.checkedIn ? C.grn : g.confirmed ? C.acc : C.mut, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                                              {g.checkedIn ? '✅ Entrou' : g.confirmed ? '☑️ Confirmado' : '⏳ Pendente'}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div></div>
                                  </div>
                                )
                              })
                          }
                        </>
                      )
                    })()
          ) : !acessoDay
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Escolha uma data para ver quem esteve na casa.</div>
            : acessoLoading
              ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Carregando…</div>
              : acessoList.length === 0
                ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Ninguém registrado nessa data.</div>
                : <>
                  <div className="r-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
                    {(() => {
                      const { total, male, female, cortesias, pagantes, rev } = acessoKpis
                      return [
                        { label: 'Total na casa', value: String(total), color: C.acc },
                        { label: '♂ Masc / ♀ Fem', value: `${male} / ${female}`, color: '#60a5fa' },
                        { label: 'Pagantes / Cortesias', value: `${pagantes} / ${cortesias}`, color: '#fbbf24' },
                        { label: 'Receita portaria', value: fmtCurrency(rev), color: C.grn },
                        { label: 'Ticket médio', value: fmtCurrency(pagantes ? Math.round(rev / pagantes) : 0), color: C.gold },
                      ]
                    })().map((k, i) => (
                      <div key={i} style={{ background: C.bg, border: `1px solid ${k.color}33`, borderTop: `3px solid ${k.color}`, borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
                        <div style={{ color: C.mut, fontSize: 10, fontWeight: 700, marginBottom: 5, letterSpacing: '0.04em' }}>{k.label.toUpperCase()}</div>
                        <div style={{ color: k.color, fontSize: 18, fontWeight: 900 }}>{k.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="r-scroll-x"><div style={{ minWidth: 560 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px 100px 90px', gap: 4, padding: '4px 8px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em' }}>
                      <div>CLIENTE (A→Z)</div><div>TELEFONE</div><div style={{ textAlign: 'center' }}>HORA</div><div>EVENTO</div><div style={{ textAlign: 'right' }}>VALOR</div>
                    </div>
                    {(() => {
                      const view = acessoRows
                      if (view.length === 0) return <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum nome corresponde à busca.</div>
                      return <>{view.slice(0, acessoShow).map((a, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 70px 100px 90px', gap: 4, padding: '8px 8px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span>{a.gender === 'feminino' ? '👩' : a.gender === 'masculino' ? '👨' : '🧑'}</span>
                            <span style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                          </div>
                          <div style={{ color: C.mut, fontSize: 12 }}>{a.phone || '—'}</div>
                          <div style={{ textAlign: 'center', color: C.sub }}>{a.time}</div>
                          <div style={{ color: C.mut, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.event || '—'}</div>
                          <div style={{ textAlign: 'right', color: a.amount > 0 ? C.grn : C.mut, fontWeight: 700 }}>{a.amount > 0 ? fmtCurrency(a.amount) : (a.pay === 'cortesia' ? 'Cortesia' : '—')}</div>
                        </div>
                      ))}{view.length > acessoShow && (
                        <button onClick={() => setAcessoShow(n => n + 150)} style={{ width: '100%', marginTop: 8, background: C.acc + '14', border: `1px solid ${C.acc}33`, borderRadius: 8, padding: '9px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          ▼ Mostrar mais ({view.length - acessoShow} restantes)
                        </button>
                      )}</>
                    })()}
                  </div></div>
                </>
          }
        </Card>
      )}

      {/* ══════════ POR EVENTO (gênero) ══════════ */}
      {reportTab === 'eventos' && (() => {
        const byGenre: Record<string, { genre: string; eventos: number; publico: number; renda: number }> = {}
        eventCI.filter(e => e.id !== '__livre__').forEach(e => {
          const g = (e.genre && e.genre.trim()) ? e.genre.trim() : 'Sem gênero'
          if (!byGenre[g]) byGenre[g] = { genre: g, eventos: 0, publico: 0, renda: 0 }
          byGenre[g].eventos++; byGenre[g].publico += e.total; byGenre[g].renda += e.rev
        })
        const genreList = Object.values(byGenre).sort((a, b) => b.publico - a.publico || b.renda - a.renda)
        const genreMaxPub = Math.max(...genreList.map(g => g.publico), 1)
        const evByPublic = eventCI.filter(e => e.id !== '__livre__').slice().sort((a, b) => b.total - a.total)
        const evByRev = eventCI.filter(e => e.id !== '__livre__').slice().sort((a, b) => b.rev - a.rev)
        return (
          <>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.txt, marginBottom: 4 }}>🎭 Por Tipo de Evento (gênero)</div>
              <div style={{ color: C.mut, fontSize: 12, marginBottom: 14 }}>Público e renda somados por categoria — {label}</div>
              {genreList.length === 0
                ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Sem eventos com movimento no período.</div>
                : <div className="r-scroll-x"><div style={{ minWidth: 520 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 1fr 110px', gap: 8, padding: '4px 8px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em' }}>
                      <div>GÊNERO</div><div style={{ textAlign: 'right' }}>EVENTOS</div><div>PÚBLICO</div><div style={{ textAlign: 'right' }}>RENDA</div>
                    </div>
                    {genreList.map((g, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 1fr 110px', gap: 8, padding: '10px 8px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13 }}>
                        <div style={{ color: C.txt, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ color: C.mut, fontSize: 11 }}>#{i + 1}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🎵 {g.genre}</span>
                        </div>
                        <div style={{ textAlign: 'right', color: C.sub, fontWeight: 600 }}>{g.eventos}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, background: C.brd, borderRadius: 4, height: 6, overflow: 'hidden' }}>
                            <div style={{ background: C.acc, height: '100%', width: `${(g.publico / genreMaxPub) * 100}%`, borderRadius: 4 }} />
                          </div>
                          <span style={{ color: C.acc, fontWeight: 700, fontSize: 12, width: 44, textAlign: 'right' }}>👥 {g.publico}</span>
                        </div>
                        <div style={{ textAlign: 'right', color: C.grn, fontWeight: 800 }}>{fmtCurrency(g.renda)}</div>
                      </div>
                    ))}
                  </div></div>
              }
            </Card>

            {/* Canais de aquisição por evento */}
            <Card style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.txt, marginBottom: 4 }}>📣 Canais por evento</div>
              <div style={{ color: C.mut, fontSize: 12, marginBottom: 14 }}>De onde veio o público de cada evento (origem dos clientes que fizeram check-in) — {label}</div>
              {(() => {
                const evList = eventCI.filter(e => (eventReferral[e.id] ?? []).some(r => r.k !== '__none__'))
                if (evList.length === 0) return <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '36px 0' }}>Ainda sem dados de origem nos eventos do período. Os canais aparecem conforme os clientes novos vão sendo cadastrados com a pesquisa "como conheceu a casa?".</div>
                return evList.map(e => {
                  const chans = eventReferral[e.id] ?? []
                  const tot = chans.reduce((s, r) => s + r.v, 0)
                  const informado = chans.filter(r => r.k !== '__none__').reduce((s, r) => s + r.v, 0)
                  return (
                    <div key={e.id} style={{ padding: '10px 0', borderBottom: `1px solid ${C.brd}22` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>{e.name}</span>
                          {e.date && <span style={{ color: C.mut, fontSize: 11, marginLeft: 6 }}>{fd(e.date)}</span>}
                        </div>
                        <span style={{ color: C.mut, fontSize: 11, whiteSpace: 'nowrap' }}>👥 {e.total} · {informado} c/ origem</span>
                      </div>
                      {/* Barra empilhada por canal */}
                      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: C.brd, marginBottom: 6 }}>
                        {chans.map((r, i) => (
                          <div key={i} title={`${refMeta(r.k).label}: ${r.v} (${Math.round(r.v / (tot || 1) * 100)}%)`}
                            style={{ width: `${r.v / (tot || 1) * 100}%`, background: refMeta(r.k).color }} />
                        ))}
                      </div>
                      {/* Legenda em chips */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {chans.map((r, i) => {
                          const m = refMeta(r.k)
                          return (
                            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: r.k === '__none__' ? C.mut : C.sub }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, background: m.color, display: 'inline-block' }} />
                              {m.icon} {m.label} <strong style={{ color: C.txt }}>{r.v}</strong> <span style={{ color: C.mut }}>· {Math.round(r.v / (tot || 1) * 100)}%</span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              })()}
            </Card>

            <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <Card>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>🏆 Maior público</div>
                {evByPublic.length === 0
                  ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem dados.</div>
                  : evByPublic.slice(0, 8).map((e, i) => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.brd}22` }}>
                      <span style={{ color: C.mut, fontSize: 12, width: 18 }}>#{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: C.txt, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                        <div style={{ color: C.mut, fontSize: 11 }}>{fd(e.date)}{e.genre ? ` · ${e.genre}` : ''}</div>
                      </div>
                      <span style={{ color: C.acc, fontWeight: 800, fontSize: 14 }}>👥 {e.total}</span>
                    </div>
                  ))
                }
              </Card>
              <Card>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>💵 Maior renda</div>
                {evByRev.length === 0
                  ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem dados.</div>
                  : evByRev.slice(0, 8).map((e, i) => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${C.brd}22` }}>
                      <span style={{ color: C.mut, fontSize: 12, width: 18 }}>#{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: C.txt, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                        <div style={{ color: C.mut, fontSize: 11 }}>{fd(e.date)}{e.genre ? ` · ${e.genre}` : ''}</div>
                      </div>
                      <span style={{ color: C.grn, fontWeight: 800, fontSize: 14 }}>{fmtCurrency(e.rev)}</span>
                    </div>
                  ))
                }
              </Card>
            </div>
          </>
        )
      })()}

      {/* Modal WhatsApp do período */}
      {showWA && (
        <>
          <div onClick={() => setShowWA(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2001, background: C.card, borderRadius: 20, padding: 20, width: 'min(94vw,520px)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            {/* Cabeçalho */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.txt }}>📲 WhatsApp · {label}</div>
              <button onClick={() => setShowWA(false)} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ color: C.mut, fontSize: 12, marginBottom: 12 }}>
              {waCiList.filter(c => c.phone).length} cliente{waCiList.filter(c => c.phone).length !== 1 ? 's' : ''} com telefone — período {label}
            </div>

            {/* Modo */}
            <div style={{ display: 'flex', gap: 4, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 4, marginBottom: 12 }}>
              {([['gift', '🎁 Brinde'], ['invite', '🎫 Convite'], ['list', '📋 Criar Lista']] as const).map(([m, lbl]) => (
                <button key={m} onClick={() => setWaMode(m)}
                  style={{ flex: 1, padding: '7px 4px', borderRadius: 8, border: 'none', background: waMode === m ? C.acc + '22' : 'transparent', color: waMode === m ? C.acc : C.mut, fontSize: 11.5, fontWeight: waMode === m ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  {lbl}
                </button>
              ))}
            </div>

            {/* Configuração do modo convite */}
            {waMode === 'invite' && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>EVENTO DA PROMOÇÃO</label>
                {waInviteEvents.length === 0
                  ? <div style={{ color: C.gold, fontSize: 12, padding: '8px 0' }}>⚠️ Nenhum evento futuro cadastrado. Crie o evento (com flyer e preço de lista) na aba Eventos.</div>
                  : <>
                    <select value={waInviteEventId} onChange={e => setWaInviteEventId(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '9px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 8 }}>
                      {waInviteEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.name} — {new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</option>)}
                    </select>
                    {(() => {
                      const ev = waInviteEvents.find(e => e.id === waInviteEventId)
                      return (
                        <div style={{ fontSize: 11, color: C.mut, lineHeight: 1.6, marginBottom: 8 }}>
                          <div>{ev?.flyer_url ? '🖼️ Flyer do evento será anexado' : '⚠️ Evento sem flyer — só texto será enviado'}</div>
                          <div>{((ev?.price_male_list_cents ?? 0) > 0 || (ev?.price_female_list_cents ?? 0) > 0) ? '💸 Confirmados pagam o preço de lista na portaria' : '⚠️ Evento sem preço de lista — defina em Eventos para aplicar desconto'}</div>
                        </div>
                      )
                    })()}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.sub, cursor: 'pointer' }}>
                      <input type="checkbox" checked={waFriendsOn} onChange={e => setWaFriendsOn(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.acc }} />
                      Permitir convidar amigos
                      {waFriendsOn && (
                        <input type="number" min={0} value={waFriends} onChange={e => setWaFriends(parseInt(e.target.value) || 0)}
                          style={{ width: 56, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '4px 8px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} title="0 = ilimitado" />
                      )}
                      {waFriendsOn && <span style={{ fontSize: 10, color: C.mut }}>{waFriends === 0 ? 'ilimitado' : `até ${waFriends}`}</span>}
                    </label>
                  </>}
              </div>
            )}

            {/* Configuração do modo criar lista */}
            {waMode === 'list' && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>EVENTO</label>
                {waInviteEvents.length === 0
                  ? <div style={{ color: C.gold, fontSize: 12, padding: '8px 0' }}>⚠️ Nenhum evento futuro cadastrado.</div>
                  : <select value={waInviteEventId} onChange={e => setWaInviteEventId(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '9px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 10 }}>
                      {waInviteEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.name} — {new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</option>)}
                    </select>
                }
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>NOME DA LISTA</label>
                <input value={waListName} onChange={e => setWaListName(e.target.value)}
                  placeholder={`VIP · ${label}`}
                  style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 10 }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>VALOR NA PORTARIA (R$)</label>
                    <input value={waListPrice} onChange={e => setWaListPrice(e.target.value)} placeholder="0,00 = grátis / cortesia"
                      style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>ACOMPANHANTES</label>
                    <input type="number" min={0} value={waListFriends} onChange={e => setWaListFriends(parseInt(e.target.value) || 0)}
                      style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }} />
                    <div style={{ color: C.mut, fontSize: 10, marginTop: 3 }}>0 = sem acompanhante</div>
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.sub, cursor: 'pointer', marginBottom: 8 }}>
                  <input type="checkbox" checked={waListIsVip} onChange={e => setWaListIsVip(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.gold }} />
                  <span style={{ color: C.gold, fontWeight: 600 }}>⭐ Marcar como VIP</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.sub, cursor: 'pointer', marginBottom: 8 }}>
                  <input type="checkbox" checked={waListNotify} onChange={e => setWaListNotify(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.acc }} />
                  Notificar pelo WhatsApp ao criar
                </label>
                {waListNotify && (
                  <>
                    <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>MENSAGEM DE NOTIFICAÇÃO</label>
                    <textarea value={waListMsg} onChange={e => setWaListMsg(e.target.value)} rows={2}
                      style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px', color: C.txt, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }} />
                    <div style={{ color: C.mut, fontSize: 10, marginTop: 3 }}>Use {'{nome}'}, {'{lista}'}, {'{evento}'}, {'{data}'}, {'{casa}'}</div>
                  </>
                )}
              </div>
            )}

            {/* Mensagem + imagem (só brinde) */}
            {waMode === 'gift' && (<>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>MENSAGEM DO BRINDE / VOUCHER</label>
                <textarea value={waMsg} onChange={e => setWaMsg(e.target.value)} rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
                <div style={{ color: C.mut, fontSize: 10, marginTop: 3 }}>Use {'{nome}'} e {'{casa}'} — serão substituídos automaticamente.</div>
              </div>
              <div style={{ marginBottom: 10 }}>
                {waImage ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img loading="lazy" decoding="async" src={waImage} alt="anexo" style={{ maxHeight: 90, borderRadius: 8, border: `1px solid ${C.brd}`, display: 'block' }} />
                    <button onClick={() => setWaImage('')}
                      style={{ position: 'absolute', top: 4, right: 4, background: '#0009', border: 'none', borderRadius: '50%', width: 24, height: 24, color: '#fff', fontSize: 13, cursor: 'pointer' }}>✕</button>
                  </div>
                ) : (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px dashed ${C.brd}`, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: C.mut }}>
                    📎 Anexar imagem / voucher (opcional)
                    <input type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) loadWAImage(f); e.target.value = '' }} />
                  </label>
                )}
              </div>
            </>)}

            {/* Busca + selecionar todos */}
            <input value={waSearch} onChange={e => setWaSearch(e.target.value)} placeholder="🔍 Filtrar por nome..."
              style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '9px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 8 }} />
            {waCiList.length > 0 && (() => {
              const selectable = waMode === 'list' ? waCiList : waCiList.filter(ci => ci.phone)
              const allSel = selectable.length > 0 && selectable.every(ci => waSelected.has(ci.id))
              return (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <button onClick={() => setWaSelected(allSel ? new Set() : new Set(selectable.map(ci => ci.id)))}
                    style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {allSel ? '☑️ Desmarcar todos' : '⬜ Selecionar todos'}
                  </button>
                  <span style={{ color: C.mut, fontSize: 12 }}>{waSelected.size} selecionado{waSelected.size !== 1 ? 's' : ''}</span>
                </div>
              )
            })()}

            {/* Lista */}
            <div style={{ overflowY: 'auto', flex: 1, margin: '0 -4px', padding: '0 4px' }}>
              {(() => {
                const q = waSearch.trim().toLowerCase()
                const filtered = waCiList.filter(ci => !q || (ci.client_name ?? '').toLowerCase().includes(q) || (ci.phone ?? '').includes(q))
                if (filtered.length === 0) return <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum cliente encontrado.</div>
                return filtered.map((ci, i) => {
                  const name = ci.client_name ?? 'Visitante'
                  const phone = ci.phone ?? ''
                  const day = new Date(ci.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                  const sel = waSelected.has(ci.id)
                  return (
                    <div key={ci.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < filtered.length - 1 ? `1px solid ${C.brd}33` : 'none' }}>
                      {(phone || waMode === 'list')
                        ? <input type="checkbox" checked={sel} onChange={() => toggleWASelected(ci.id)}
                            style={{ width: 18, height: 18, flexShrink: 0, accentColor: waMode === 'list' ? C.gold : '#25D366', cursor: 'pointer' }} />
                        : <span style={{ width: 18, flexShrink: 0 }} />}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: C.txt, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {name}{waListIsVip && waMode === 'list' && sel ? ' ⭐' : ''}
                        </div>
                        <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
                          📅 {day}{ci.event_name ? ` · ${ci.event_name}` : ''} · {fmtCurrency(ci.amount_cents)}{!phone ? ' · sem tel.' : ''}
                        </div>
                      </div>
                      {phone && waMode === 'gift'
                        ? <button onClick={() => sendWADirect(house.id, phone, waMsg.replace(/\{nome\}/g, name.split(' ')[0]).replace(/\{casa\}/g, house.name || ''), { type: 'gift', mediaUrl: waImage ? (waImage.includes(',') ? waImage.split(',')[1] : waImage) : undefined })}
                            style={{ flexShrink: 0, background: '#25D36622', border: '1px solid #25D36655', borderRadius: 8, padding: '5px 10px', color: '#25D366', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                            <i className="bi bi-whatsapp" />
                          </button>
                        : null}
                    </div>
                  )
                })
              })()}
            </div>

            {/* Progresso + botão envio */}
            {waProgress && (
              <div style={{ margin: '10px 0 6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.mut, marginBottom: 4 }}>
                  <span>Enviando…</span><span>{waProgress.sent}/{waProgress.total}</span>
                </div>
                <div style={{ background: C.brd, borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: '#25D366', borderRadius: 4, height: 6, width: `${(waProgress.sent / waProgress.total) * 100}%`, transition: 'width 0.3s' }} />
                </div>
              </div>
            )}
            {waMode === 'gift' && waSelected.size > 0 && (
              <button onClick={sendGiftBulk} disabled={waSending}
                style={{ marginTop: 12, width: '100%', background: waSending ? '#25D36644' : '#25D366', border: 'none', borderRadius: 12, padding: '13px', color: '#062e16', fontSize: 14, fontWeight: 800, cursor: waSending ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <i className="bi bi-whatsapp" /> {waSending ? 'Enviando…' : `Enviar brinde para ${waSelected.size} selecionado${waSelected.size !== 1 ? 's' : ''}`}
              </button>
            )}
            {waMode === 'invite' && waSelected.size > 0 && (
              <button onClick={sendInviteBulk} disabled={waSending}
                style={{ marginTop: 12, width: '100%', background: waSending ? C.acc + '44' : C.acc, border: 'none', borderRadius: 12, padding: '13px', color: '#fff', fontSize: 14, fontWeight: 800, cursor: waSending ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                🎫 {waSending ? 'Enviando…' : `Enviar convite para ${waSelected.size} selecionado${waSelected.size !== 1 ? 's' : ''}`}
              </button>
            )}
            {waMode === 'list' && waSelected.size > 0 && (
              <button onClick={createListBulk} disabled={waSending}
                style={{ marginTop: 12, width: '100%', background: waSending ? C.gold + '44' : `linear-gradient(135deg,${C.gold},#d97706)`, border: 'none', borderRadius: 12, padding: '13px', color: '#1a0a00', fontSize: 14, fontWeight: 800, cursor: waSending ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                📋 {waSending ? 'Criando lista…' : `Criar lista com ${waSelected.size} pessoa${waSelected.size !== 1 ? 's' : ''}${waListIsVip ? ' ⭐ VIP' : ''}`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
