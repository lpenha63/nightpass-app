import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { diaOperacional, inicioDoDia, viradaDa, VIRADA_PADRAO } from '../utils/diaOperacional'
import { painelUnidadesLigado } from '../hooks/useSession'
import { C } from '../constants/theme'
import { Toast, ScrollBox } from '../components/ui'
import { cn, fmtCurrency, payColor, payLabel } from '../utils/format'
import { sT, type ToastState } from '../utils/toast'
import { esperadoDaReserva } from '../utils/reservas'
import { areaMeta, DEFAULT_AREAS, type WorkArea } from '../constants/areas'
import { sendWADirect } from '../utils/whatsapp'
import type { House } from '../types'

// Casa noturna em horário local (não UTC): até as 6h da manhã ainda conta como a
// "noite"/dia de negócio anterior. Corrige o evento do dia e a contagem de check-ins.
// A virada vem da casa (6h em balada, 0h em comércio diurno). O módulo guarda a regra;
// aqui ela é só lida — antes cada tela repetia o "< 6" por conta própria.
let viradaDaCasa = VIRADA_PADRAO
function bizRefDate(): Date {
  return diaOperacional(viradaDaCasa)
}
function bizTodayStr(): string {
  const d = bizRefDate()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function bizDayStartISO(): string {
  // Comeca na HORA DA VIRADA, nao a meia-noite: com virada 6h, o dia de trabalho de
  // 20/08 vai das 06h do dia 20 as 06h do dia 21. Comecando a meia-noite, a
  // madrugada do dia 20 (que pertence a noite do 19) entrava na conta de hoje.
  return inicioDoDia(viradaDaCasa).toISOString()
}

interface UnidadeResumo {
  house_id: string; house_name: string; logo_url: string | null
  eventos_futuros: number
  proximo_id: string | null; proximo_nome: string | null; proximo_data: string | null
  proximo_reservas: number; proximo_pessoas: number; proximo_lista: number
  checkins_hoje: number; faturamento_hoje_cents: number
}

interface Props {
  house: House
  user: { id: string; email: string }
  role: string
  /** Todas as unidades do usuário — habilita o painel consolidado */
  houses?: House[]
  onTrocarCasa?: (houseId: string) => void
}

interface Stats {
  clients: number
  events: number
  todayCount: number
  todayRev: number
  reservations: number
  newClients: number
  expected?: number
  returns?: number   // check-ins de hoje que já eram clientes (vieram antes)
  returnPct?: number // % de retorno sobre os check-ins de hoje
  newPct?: number    // % de novos (primeira vez) entre os check-ins de hoje
  dayInvited?: number // convites do dia inteiro (invites_daily) — base do % de comparecimento
}

interface TeamRow {
  id: string; nome: string; phone?: string; area: string
  previsto: string                       // horário previsto de entrada (entry_time)
  entrada: string | null; saida: string | null
}

interface PayStat { k: string; v: number }
interface WeekDay { d: string; n: number; r: number; invited?: number }
interface HourData { h: number; n: number }
interface RecentCI {
  id: string
  created_at: string
  amount_cents: number
  payment_method: string
  clients?: { full_name: string } | { full_name: string }[]
  events?: { name: string } | { name: string }[]
}
interface CIListItem {
  id: string
  created_at: string
  amount_cents: number
  payment_method: string
  comanda?: string | null
  client_id?: string | null
  amount_corrected?: boolean
  clients?: { full_name?: string; phone?: string } | null
}
interface InviteEvent {
  id: string; name: string; event_date: string; start_time?: string; flyer_url?: string
  price_male_list_cents?: number; price_female_list_cents?: number
}
interface DashRes {
  id: string
  name: string
  status: string
  expected_arrival?: string
  people_count?: number
  location?: string
  amount_cents?: number
  deposit_cents?: number
  payment_status?: string
  reservation_date?: string
  amount_corrected?: boolean
  reservation_guests?: Array<{ id: string }>
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
interface Receivable { id: string; name: string; amount_cents: number; deposit_cents: number; reservation_date?: string }

const KPIS = (s: Stats, cash: number) => [
  { icon: 'bi-people-fill', label: 'Clientes', value: s.clients.toLocaleString('pt-BR'), color: C.acc },
  { icon: 'bi-person-plus-fill', label: 'Novos hoje', value: s.newClients.toLocaleString('pt-BR'), sub: (s.todayCount > 0 && s.newPct != null) ? `${s.newPct}%` : undefined, color: '#22d3ee' },
  { icon: 'bi-calendar-event-fill', label: 'Eventos ativos', value: s.events.toLocaleString('pt-BR'), color: '#a78bfa' },
  { icon: 'bi-door-open-fill', label: 'Check-ins hoje', value: s.todayCount.toLocaleString('pt-BR'), sub: s.todayCount > 0 ? `↩${s.returnPct ?? 0}%` : undefined, color: C.grn },
  { icon: 'bi-cash-stack', label: 'Caixa hoje', value: fmtCurrency(cash), color: C.gold },
  { icon: 'bi-bookmark-check-fill', label: 'Reservas hoje', value: s.reservations.toLocaleString('pt-BR'), color: '#f472b6' },
]

const reservaArrived = (status: string) => status === 'arrived' || status === 'confirmado' || status === 'confirmed'

export function DashboardPage({ house, role, houses = [], onTrocarCasa }: Props) {
  viradaDaCasa = viradaDa(house)
  // Painel consolidado: só existe para quem tem mais de uma unidade
  const [unidades, setUnidades] = useState<UnidadeResumo[]>([])
  useEffect(() => {
    // desligado nas Configurações: nem chega a consultar
    if (houses.length < 2 || !painelUnidadesLigado()) { setUnidades([]); return }
    supabase.rpc('dashboard_multi_casas')
      .then(r => setUnidades((r.data ?? []) as UnidadeResumo[]))
  }, [houses.length, house.id])

  const canEditCash = ['admin', 'super_admin', 'financeiro', 'finance'].includes(role)
  const [stats, setStats] = useState<Stats>({ clients: 0, events: 0, todayCount: 0, todayRev: 0, reservations: 0, newClients: 0 })
  const [hourly, setHourly] = useState<HourData[]>([])
  const [payStats, setPayStats] = useState<PayStat[]>([])
  const [recent, setRecent] = useState<RecentCI[]>([])
  const [weekData, setWeekData] = useState<WeekDay[]>([])
  const [compareDow, setCompareDow] = useState<number>(new Date().getDay())
  const [dashRes, setDashRes] = useState<DashRes[]>([])
  const [todayEvent, setTodayEvent] = useState<TodayEvent | null>(null)
  const [upcoming, setUpcoming] = useState<InviteEvent[]>([])
  const [upcomingRes, setUpcomingRes] = useState<{ event_id?: string | null; reservation_date?: string; people_count?: number; reservation_guests?: Array<unknown> | null }[]>([])
  const [upcomingGuests, setUpcomingGuests] = useState<Record<string, { total: number; confirmed: number }>>({})
  const [evMetrics, setEvMetrics] = useState<EventMetrics | null>(null)
  const [teamToday, setTeamToday] = useState<TeamRow[]>([])
  const [workAreas, setWorkAreas] = useState<WorkArea[]>(DEFAULT_AREAS)
  const [cash, setCash] = useState<CashDay>({ door: 0, tickets: 0, reservations: 0, total: 0 })
  const [birthdays, setBirthdays] = useState<Birthday[]>([])
  const [bdWeek, setBdWeek] = useState<Birthday[]>([])
  const [bdMonth, setBdMonth] = useState<Birthday[]>([])
  const [bdTab, setBdTab] = useState<'day' | 'week' | 'month'>('day')
  const [weekRes, setWeekRes] = useState<DashRes[]>([])
  const [resTab, setResTab] = useState<'day' | 'week'>('day')
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [showReceivables, setShowReceivables] = useState(false)
  const [payAmt, setPayAmt] = useState<Record<string, string>>({})
  const [payingId, setPayingId] = useState<string | null>(null)
  const [showCashClose, setShowCashClose] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  // Lista de check-ins do dia (quem está na casa) — para brindes/descontos
  const [showCheckins, setShowCheckins] = useState(false)
  const [ciList, setCiList] = useState<CIListItem[]>([])
  const [ciListLoading, setCiListLoading] = useState(false)
  const [ciListSearch, setCiListSearch] = useState('')
  const [ciEdit, setCiEdit] = useState<{ id: string; val: string } | null>(null)
  const [showReservations, setShowReservations] = useState(false)
  const [resEdit, setResEdit] = useState<{ id: string; val: string } | null>(null)
  const [showCaixa, setShowCaixa] = useState(false)
  const [giftMsg, setGiftMsg] = useState('🎁 Você está na {casa}! Mostre esta mensagem no bar e ganhe um brinde especial. 🍹')
  const [ciSelected, setCiSelected] = useState<Set<string>>(new Set())
  const [giftImage, setGiftImage] = useState('')
  const [giftSending, setGiftSending] = useState(false)
  const [giftProgress, setGiftProgress] = useState<{ sent: number; total: number } | null>(null)
  // Modo do modal: brinde rápido OU convite c/ confirmação (cria lista de promoção)
  const [ciMode, setCiMode] = useState<'gift' | 'invite'>('gift')
  const [inviteEvents, setInviteEvents] = useState<InviteEvent[]>([])
  const [inviteEventId, setInviteEventId] = useState('')
  const [inviteFriends, setInviteFriends] = useState(3)
  const [inviteFriendsOn, setInviteFriendsOn] = useState(true)

  const chartRef = useRef<HTMLCanvasElement>(null)

  async function load() {
    const today = bizTodayStr()
    const dayStart = bizDayStartISO()

    const [clientsC, newClientsC, eventsC, ciR, evR, upEvR, upResR] = await Promise.all([
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('house_id', house.id),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('house_id', house.id).gte('created_at', dayStart),
      supabase.from('events').select('id', { count: 'exact', head: true }).eq('house_id', house.id).not('status', 'in', '(cancelado,encerrado)').gte('event_date', today),
      supabase.from('checkins').select('id,amount_cents,created_at,payment_method,event_id,client_id').eq('house_id', house.id).gte('created_at', dayStart),
      supabase.from('events').select('id,name,event_date,start_time,capacity,artist_fee_cents,consumption_cents,production_cost_cents')
        .eq('house_id', house.id).eq('event_date', today).neq('status', 'cancelado').order('start_time').limit(1),
      supabase.from('events').select('id,name,event_date,start_time,flyer_url')
        .eq('house_id', house.id).not('status', 'in', '(cancelado,encerrado)').gte('event_date', today)
        .order('event_date').order('start_time').limit(4),
      // reservation_guests(id) NAO e opcional aqui: esperadoDaReserva compara o
      // declarado com o que ja foi cadastrado e, sem essa lista, ele degrada em
      // silencio para o declarado — que foi como este card passou a mostrar 181
      // enquanto a tela de Eventos mostrava 237 para o mesmo evento.
      supabase.from('reservations').select('event_id,reservation_date,people_count,reservation_guests(id)')
        .eq('house_id', house.id).gte('reservation_date', today).is('archived_at', null).neq('status', 'cancelled'),
    ])
    setUpcoming((upEvR.data ?? []) as InviteEvent[])
    setUpcomingRes((upResR.data ?? []) as { event_id?: string | null; reservation_date?: string; people_count?: number; reservation_guests?: Array<unknown> | null }[])
    // Convidados (listas de promoter/casa) e confirmados por evento futuro
    const upEvIds = (upEvR.data ?? []).map(e => e.id)
    if (upEvIds.length > 0) {
      const gR = await supabase.from('promoter_list_guests').select('event_id,promoter_confirmed').in('event_id', upEvIds)
      const gm: Record<string, { total: number; confirmed: number }> = {}
      ;(gR.data ?? []).forEach(g => {
        const k = g.event_id as string; if (!k) return
        if (!gm[k]) gm[k] = { total: 0, confirmed: 0 }
        gm[k].total++; if (g.promoter_confirmed) gm[k].confirmed++
      })
      setUpcomingGuests(gm)
    } else {
      setUpcomingGuests({})
    }

    const cins = ciR.data ?? []
    const todayDoorRev = cins.reduce((s, c) => s + (c.amount_cents ?? 0), 0)

    // Taxa de retorno: dos check-ins de hoje (com cliente), quantos já tinham vindo antes de hoje.
    const cliIdsHoje = Array.from(new Set(cins.map(c => c.client_id).filter(Boolean))) as string[]
    let returns = 0, returnPct = 0, newPct = 0
    if (cliIdsHoje.length > 0) {
      const { data: prev } = await supabase.from('checkins').select('client_id')
        .eq('house_id', house.id).in('client_id', cliIdsHoje).lt('created_at', dayStart)
      const retSet = new Set((prev ?? []).map(p => p.client_id))
      const comCliente = cins.filter(c => c.client_id)
      returns = comCliente.filter(c => retSet.has(c.client_id)).length
      returnPct = comCliente.length > 0 ? Math.round(returns / comCliente.length * 100) : 0
      newPct = comCliente.length > 0 ? 100 - returnPct : 0 // % de primeira vez (novos) entre os check-ins de hoje
    }

    // Distribuição por hora — dia operacional (06h → 05h do dia seguinte).
    // Recorta dinamicamente do primeiro ao último horário com movimento (cobre eventos diurnos e noturnos).
    const hours: Record<number, number> = {}
    cins.forEach(c => { const hh = new Date(c.created_at).getHours(); hours[hh] = (hours[hh] ?? 0) + 1 })
    // Ordem do dia operacional: 6,7,...,23,0,1,...,5
    const opOrder: number[] = []
    for (let i = 6; i <= 23; i++) opOrder.push(i)
    for (let i = 0; i <= 5; i++) opOrder.push(i)
    const fullSeq: HourData[] = opOrder.map(h => ({ h, n: hours[h] ?? 0 }))
    const firstIdx = fullSeq.findIndex(x => x.n > 0)
    let ha: HourData[]
    if (firstIdx === -1) {
      ha = [] // sem movimento ainda
    } else {
      let lastIdx = firstIdx
      fullSeq.forEach((x, i) => { if (x.n > 0) lastIdx = i })
      // pequena folga de 1h antes/depois para contexto visual
      const from = Math.max(0, firstIdx - 1)
      const to = Math.min(fullSeq.length - 1, lastIdx + 1)
      ha = fullSeq.slice(from, to + 1)
    }
    setHourly(ha)

    // Payment breakdown — TODAY only
    const pm: Record<string, number> = {}
    cins.forEach(c => { const k = c.payment_method ?? 'outros'; pm[k] = (pm[k] ?? 0) + (c.amount_cents ?? 0) })
    setPayStats(Object.entries(pm).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v))

    const ev = (evR.data ?? [])[0] as TodayEvent | undefined ?? null
    setTodayEvent(ev)

    // Cash of the day: door + online tickets paid today + reservation consumption today
    // Get week end date
    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7)
    const weekEndStr = weekEnd.toISOString().slice(0, 10)

    // Reservas de hoje: pela data OU vinculadas ao evento de hoje (cobre reservas cujo
    // reservation_date ficou desatualizado mas que já têm event_id apontando pro evento de hoje)
    // inclui canceladas de hoje (o Cancelar arquiva a reserva): não some do card, mas fica marcada
    let rrQuery = supabase.from('reservations').select('id,name,status,expected_arrival,people_count,location,amount_cents,deposit_cents,payment_status,event_id,reservation_date,amount_corrected,reservation_guests(id)')
      .eq('house_id', house.id).or('archived_at.is.null,status.eq.cancelled').order('expected_arrival')
    rrQuery = ev ? rrQuery.or(`reservation_date.eq.${today},event_id.eq.${ev.id}`) : rrQuery.eq('reservation_date', today)

    const [tkPaidTodayR, rrR, rrWeekR, receivR] = await Promise.all([
      supabase.from('ticket_orders').select('amount_cents').eq('house_id', house.id).eq('payment_status', 'paid').gte('created_at', dayStart),
      rrQuery,
      supabase.from('reservations').select('id,name,status,expected_arrival,people_count,location,amount_cents,reservation_date,payment_status')
        .eq('house_id', house.id).gt('reservation_date', today).lte('reservation_date', weekEndStr).is('archived_at', null).order('reservation_date'),
      supabase.from('reservations').select('id,name,amount_cents,deposit_cents,reservation_date')
        .eq('house_id', house.id).in('payment_status', ['unpaid', 'partial']).is('archived_at', null).neq('status', 'cancelled').gt('amount_cents', 0),
    ])
    const ticketsRevToday = (tkPaidTodayR.data ?? []).reduce((s, t) => s + (t.amount_cents ?? 0), 0)
    const rd = (rrR.data ?? []) as DashRes[]
    setDashRes(rd)
    setWeekRes((rrWeekR.data ?? []) as DashRes[])
    // Valores a receber: saldo pendente = total - já pago
    const recv = ((receivR.data ?? []) as Receivable[]).map(r => ({ ...r, deposit_cents: r.deposit_cents ?? 0 }))
    setReceivables(recv)
    // Caixa do dia: apenas o que FOI recebido hoje (pago ou sinal)
    const resReceivedToday = rd.reduce((s, r) => {
      if (r.status === 'cancelled') return s
      if (r.payment_status === 'paid') return s + (r.amount_cents ?? 0)
      if (r.payment_status === 'partial') return s + (r.deposit_cents ?? 0)
      return s
    }, 0)
    const cashTotal = todayDoorRev + ticketsRevToday + resReceivedToday
    setCash({ door: todayDoorRev, tickets: ticketsRevToday, reservations: resReceivedToday, total: cashTotal })

    // Previstos (para o % de check-ins): pessoas em reservas não canceladas + convidados de lista (se houver evento hoje)
    // Esperado por reserva = o MAIOR entre o tamanho declarado e os nomes já cadastrados.
    // Só people_count ignora quem o titular adicionou além do combinado; só os nomes
    // ignora quem ainda não foi cadastrado numa lista parcial. As duas situações existem.
    const resPeopleTotal = rd.filter(r => r.status !== 'cancelled')
      .reduce((s, r) => s + esperadoDaReserva(r), 0)
    setStats({ clients: clientsC.count ?? 0, events: eventsC.count ?? 0, todayCount: cins.length, todayRev: cashTotal, reservations: rd.filter(r => r.status !== 'cancelled').length, newClients: newClientsC.count ?? 0, expected: resPeopleTotal, returns, returnPct, newPct })

    // Tonight event metrics (occupancy + P&L + pendings)
    if (ev) {
      const [evCi, evTkPaid, evTkPend, evFr, evPl, evRi, evCl, evGuests] = await Promise.all([
        supabase.from('checkins').select('amount_cents', { count: 'exact' }).eq('event_id', ev.id),
        supabase.from('ticket_orders').select('amount_cents,quantity').eq('event_id', ev.id).eq('payment_status', 'paid'),
        supabase.from('ticket_orders').select('amount_cents,quantity').eq('event_id', ev.id).eq('payment_status', 'pending'),
        supabase.from('event_freelancers')
          .select('id, confirmed, role, entry_time, checkin_at, checkout_at, custom_fee_cents, freelancers(full_name, phone, daily_rate_cents, work_types)')
          .eq('event_id', ev.id),
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
      // Pendente = freelancer que ainda NÃO deu check-in (não chegou). O check-in da equipe
      // (Portaria/Equipe) grava checkin_at, então confirmar a entrada zera a pendência.
      const freelancersPending = (evFr.data ?? []).filter(r => !(r as { checkin_at?: string }).checkin_at).length

      // Áreas da casa: sem isto o card mostraria a chave crua ('seguranca') no lugar do rótulo
      supabase.from('work_areas').select('key,label,icon,color').eq('house_id', house.id).eq('active', true)
        .then(r => { if (r.data?.length) setWorkAreas(r.data as WorkArea[]) })

      // Equipe escalada de hoje — quem chegou, quem falta e quem já saiu
      setTeamToday(((evFr.data ?? []) as unknown as Array<{
        id: string; role?: string; entry_time?: string; checkin_at?: string; checkout_at?: string
        freelancers?: { full_name?: string; phone?: string; work_types?: string[] } | null
      }>).map(r => ({
        id: r.id,
        nome: r.freelancers?.full_name ?? '—',
        phone: r.freelancers?.phone,
        area: r.role || r.freelancers?.work_types?.[0] || 'outros',
        previsto: r.entry_time ? r.entry_time.slice(0, 5) : '',
        entrada: r.checkin_at ?? null,
        saida: r.checkout_at ?? null,
      })).sort((a, b) => {
        // Quem ainda não chegou primeiro: é a informação acionável durante a noite
        const pa = a.entrada ? (a.saida ? 2 : 1) : 0
        const pb = b.entrada ? (b.saida ? 2 : 1) : 0
        return pa !== pb ? pa - pb : a.nome.localeCompare(b.nome, 'pt-BR')
      }))

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

      // Previstas = total de pessoas em reservas (não canceladas) + convidados de lista.
      // Usa o MESMO total do comparativo (invites_daily) para o % de comparecimento bater.
      const resPeople = resPeopleTotal
      const listGuests = evGuests.count ?? 0
      // Atualiza o previsto incluindo os convidados de lista do evento de hoje
      setStats(s => ({ ...s, expected: (s.expected ?? 0) + listGuests }))

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
      setTeamToday([])
    }

    // Recent check-ins
    supabase.from('checkins').select('id,created_at,amount_cents,payment_method,clients(full_name),events(name)')
      .eq('house_id', house.id).order('created_at', { ascending: false }).limit(8)
      .then(r => setRecent(r.data ?? []))

    // 30-dias + comparativo por dia da semana (6 ocorrências = até 42 dias) — agrega no SERVIDOR (RPC)
    // para não bater no limite de 1000 linhas
    const localDay = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const COMPARE_DAYS = 42
    Promise.all([
      supabase.rpc('checkins_daily', { p_house: house.id, p_days: COMPARE_DAYS }),
      supabase.rpc('invites_daily', { p_house: house.id, p_days: COMPARE_DAYS }),
    ]).then(([rw, iv]) => {
      const byDay: Record<string, { n: number; r: number }> = {}
      ;((rw.data ?? []) as Array<{ day: string; n: number; rev: number }>).forEach(row => { byDay[row.day] = { n: row.n, r: row.rev } })
      const invByDay: Record<string, number> = {}
      ;((iv.data ?? []) as Array<{ day: string; invited: number }>).forEach(row => { invByDay[row.day] = row.invited })
      const arr: WeekDay[] = []
      for (let di = COMPARE_DAYS - 1; di >= 0; di--) {
        const dt = new Date(); dt.setDate(dt.getDate() - di)
        const ds = localDay(dt)
        arr.push({ d: ds, n: byDay[ds]?.n ?? 0, r: byDay[ds]?.r ?? 0, invited: invByDay[ds] ?? 0 })
      }
      setWeekData(arr)
      // Dia OPERACIONAL, nao a data do calendario. As 00h30 de uma sexta a casa ainda
      // esta na noite de quinta: o card mostrava o evento de quinta com as previstas
      // de sexta, misturando dois eventos na mesma linha.
      setStats(s => ({ ...s, dayInvited: invByDay[bizTodayStr()] ?? 0 }))
    })

    // Birthdays today/week/month
    supabase.from('clients').select('id,full_name,phone,birth_date').eq('house_id', house.id).not('birth_date', 'is', null)
      .then(r => {
        const now = new Date()
        const mo = now.getMonth(), da = now.getDate()
        const all = (r.data ?? []).filter(c => c.birth_date)
        const dayBd = all.filter(c => {
          const d = new Date(c.birth_date! + 'T00:00:00')
          return d.getMonth() === mo && d.getDate() === da
        })
        // Next 7 days (excluding today)
        const weekBd = all.filter(c => {
          const d = new Date(c.birth_date! + 'T00:00:00')
          const bd = new Date(now.getFullYear(), d.getMonth(), d.getDate())
          if (bd < now) bd.setFullYear(now.getFullYear() + 1)
          const diff = (bd.getTime() - now.getTime()) / 86400000
          return diff > 0 && diff <= 7
        })
        // This month (excluding today)
        const monthBd = all.filter(c => {
          const d = new Date(c.birth_date! + 'T00:00:00')
          return d.getMonth() === mo && d.getDate() !== da
        })
        setBirthdays(dayBd.map(c => ({ id: c.id, full_name: c.full_name, phone: c.phone })) as Birthday[])
        setBdWeek(weekBd.map(c => ({ id: c.id, full_name: c.full_name, phone: c.phone })) as Birthday[])
        setBdMonth(monthBd.map(c => ({ id: c.id, full_name: c.full_name, phone: c.phone })) as Birthday[])
      })
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000) // fallback (funciona também no localhost, sem realtime)
    return () => clearInterval(interval)
  }, [house.id])

  // ── Tempo real: recarrega na hora quando muda check-in / reserva / ingresso / evento ──
  useEffect(() => {
    if (!house.id) return
    if (window.location.hostname === 'localhost') return // realtime só em produção (em dev, o polling cobre)
    let t: ReturnType<typeof setTimeout> | null = null
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => load(), 700) } // debounce p/ rajadas
    const ch = supabase.channel(`dash-rt-${house.id}`)
    for (const table of ['checkins', 'reservations', 'ticket_orders', 'events'] as const) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `house_id=eq.${house.id}` }, bump)
    }
    ch.subscribe()
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch) }
  }, [house.id])

  // Draw 30-day bar chart on canvas (weekData carrega até 42 dias p/ o comparativo semanal; aqui só os últimos 30)
  useEffect(() => {
    const canvas = chartRef.current
    const chartData = weekData.slice(-30)
    if (!canvas || !chartData.length) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.clientWidth || 600
    const H = 80
    canvas.width = W; canvas.height = H
    const max = Math.max(...chartData.map(d => d.n), 1)
    const bw = W / chartData.length - 2
    ctx.clearRect(0, 0, W, H)
    const nowD = new Date()
    const today = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`
    chartData.forEach((d, i) => {
      const bh = Math.max(2, (d.n / max) * (H - 16))
      const x = i * (bw + 2)
      const y = H - bh - 8
      ctx.fillStyle = d.d === today ? '#10b981' : (d.n > 0 ? '#3b82f6' : '#1e2736')
      ctx.beginPath()
      ctx.roundRect(x, y, bw, bh, 3)
      ctx.fill()
    })
  }, [weekData])

  async function openCheckinsList() {
    setShowCheckins(true); setCiListLoading(true); setCiListSearch(''); setCiSelected(new Set()); setGiftImage(''); setCiMode('gift')
    const [ciR, evR] = await Promise.all([
      supabase.from('checkins')
        .select('id,created_at,amount_cents,payment_method,comanda,client_id,amount_corrected,clients(full_name,phone)')
        .eq('house_id', house.id).gte('created_at', bizDayStartISO())
        .order('created_at', { ascending: false }),
      supabase.from('events')
        .select('id,name,event_date,start_time,flyer_url,price_male_list_cents,price_female_list_cents')
        .eq('house_id', house.id).gte('event_date', bizTodayStr()).neq('status', 'cancelado')
        .order('event_date').limit(30),
    ])
    setCiList((ciR.data ?? []) as unknown as CIListItem[])
    const evs = (evR.data ?? []) as InviteEvent[]
    setInviteEvents(evs); setInviteEventId(evs[0]?.id ?? '')
    setCiListLoading(false)
  }

  // Corrige o valor de um check-in (ex.: lançado 1500 em vez de 15) → recalcula o caixa
  async function saveCiAmount(id: string) {
    const raw = (ciEdit?.val ?? '').replace(/\./g, '').replace(',', '.')
    const cents = Math.max(0, Math.round((parseFloat(raw) || 0) * 100))
    const { data, error } = await supabase.from('checkins').update({ amount_cents: cents, amount_corrected: true }).eq('id', id).select('id')
    if (error) { sT(setToast, 'Erro ao salvar: ' + error.message, 'error'); return }
    if (!data || data.length === 0) { sT(setToast, 'Sem permissão para corrigir o caixa.', 'error'); return }
    setCiList(p => p.map(c => c.id === id ? { ...c, amount_cents: cents, amount_corrected: true } : c))
    setCiEdit(null)
    sT(setToast, '✅ Valor corrigido!', 'success')
    load() // recalcula o caixa do dia
  }

  // Corrige o valor de uma reserva → marca como "Corrigido" e recalcula o caixa
  async function saveResAmount(id: string) {
    const raw = (resEdit?.val ?? '').replace(/\./g, '').replace(',', '.')
    const cents = Math.max(0, Math.round((parseFloat(raw) || 0) * 100))
    const { error } = await supabase.from('reservations').update({ amount_cents: cents, amount_corrected: true }).eq('id', id)
    if (error) { sT(setToast, 'Erro ao salvar: ' + error.message, 'error'); return }
    setDashRes(p => p.map(r => r.id === id ? { ...r, amount_cents: cents, amount_corrected: true } : r))
    setResEdit(null)
    sT(setToast, '✅ Valor corrigido!', 'success')
    load()
  }

  async function cancelReserva(r: DashRes) {
    if (!confirm(`Cancelar a reserva de ${r.name}?`)) return
    const { error } = await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', r.id)
    if (error) { sT(setToast, 'Erro ao cancelar: ' + error.message, 'error'); return }
    setDashRes(p => p.map(x => x.id === r.id ? { ...x, status: 'cancelled' } : x))
    sT(setToast, 'Reserva cancelada', 'success')
    load()
  }

  // Caixa do dia: carrega os check-ins (porta) para o modal com correção (reservas já vêm de dashRes)
  async function openCaixa() {
    setShowCaixa(true); setCiListLoading(true); setCiEdit(null); setResEdit(null)
    const { data } = await supabase.from('checkins')
      .select('id,created_at,amount_cents,payment_method,comanda,client_id,amount_corrected,clients(full_name,phone)')
      .eq('house_id', house.id).gte('created_at', bizDayStartISO())
      .order('created_at', { ascending: false })
    setCiList((data ?? []) as unknown as CIListItem[])
    setCiListLoading(false)
  }

  // Garante (cria/reusa) a "Lista da Casa" do evento — para o convite com confirmação
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

  // Envia convite com flyer + link de confirmação; confirmados entram na lista (preço de lista na portaria)
  async function sendInviteBulk() {
    const ev = inviteEvents.find(e => e.id === inviteEventId)
    if (!ev) { sT(setToast, 'Selecione o evento do convite', 'warn'); return }
    const recipients = ciList.filter(ci => ciSelected.has(ci.id) && ci.clients?.phone)
    if (recipients.length === 0) { sT(setToast, 'Selecione ao menos uma pessoa com telefone', 'warn'); return }
    const { data: cfg } = await supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1).single()
    if (!(cfg?.active && cfg?.api_url && cfg?.instance_name && cfg?.api_key)) { sT(setToast, 'Ative o WhatsApp em Configurações para enviar convites com flyer.', 'warn'); return }
    if (!confirm(`Enviar convite de "${ev.name}" para ${recipients.length} pessoa(s)?`)) return
    const rec = await ensureHouseList(ev.id)
    if (!rec) { sT(setToast, 'Não foi possível criar a lista da promoção.', 'error'); return }

    const effFriends = inviteFriendsOn ? (inviteFriends === 0 ? 9999 : inviteFriends) : 0
    const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    const valParts = [(ev.price_male_list_cents ?? 0) > 0 ? `♂ ${fmtCurrency(ev.price_male_list_cents ?? 0)}` : '', (ev.price_female_list_cents ?? 0) > 0 ? `♀ ${fmtCurrency(ev.price_female_list_cents ?? 0)}` : ''].filter(Boolean)
    const linhaVal = valParts.length ? `\n💵 Lista: ${valParts.join(' · ')}` : ''

    setGiftSending(true); setGiftProgress({ sent: 0, total: recipients.length })
    const { fmtWAPhone } = await import('../utils/whatsapp')
    let ok = 0
    for (const ci of recipients) {
      const name = ci.clients?.full_name ?? 'Visitante'
      const phoneDigits = (ci.clients?.phone ?? '').replace(/\D/g, '')
      const fph = fmtWAPhone(ci.clients?.phone ?? '')
      if (!fph) { setGiftProgress(p => p ? { ...p, sent: p.sent + 1 } : p); continue }
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
      const msg = `🎉 Olá ${name.split(' ')[0]}! Você está na promoção de *${ev.name}* — ${dateStr}${ev.start_time ? ` às ${ev.start_time.slice(0, 5)}` : ''}!${linhaVal}\n\n✅ Confirme sua presença com 1 clique e apresente o flyer na entrada:\n${confirmLink}${plusMsg}\n\nTe esperamos! 🔥`
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
      setGiftProgress(p => p ? { ...p, sent: p.sent + 1 } : p)
      await new Promise(r => setTimeout(r, 500))
    }
    setGiftSending(false); setGiftProgress(null); setCiSelected(new Set())
    sT(setToast, `✅ ${ok} convite${ok !== 1 ? 's' : ''} enviado${ok !== 1 ? 's' : ''}! Quem confirmar entra na lista da promoção.`, 'success')
  }

  function loadGiftImage(file: File) {
    const reader = new FileReader()
    reader.onload = e => { const r = e.target?.result as string; if (r) setGiftImage(r) }
    reader.readAsDataURL(file)
  }

  function toggleCiSelected(id: string) {
    setCiSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // Envio em massa do brinde/desconto para os selecionados (com imagem opcional)
  async function sendGiftBulk() {
    if (!giftMsg.trim()) { sT(setToast, 'Escreva a mensagem do brinde', 'warn'); return }
    const recipients = ciList.filter(ci => ciSelected.has(ci.id) && ci.clients?.phone)
    if (recipients.length === 0) { sT(setToast, 'Selecione ao menos uma pessoa com telefone', 'warn'); return }

    const { data: cfg } = await supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1).single()
    const useEvolution = !!(cfg?.active && cfg?.api_url && cfg?.instance_name && cfg?.api_key)
    if (!useEvolution && giftImage) { sT(setToast, 'Configure o WhatsApp para enviar imagens.', 'warn'); return }
    if (!confirm(`Enviar brinde para ${recipients.length} pessoa(s)?`)) return

    setGiftSending(true); setGiftProgress({ sent: 0, total: recipients.length })
    const { fmtWAPhone } = await import('../utils/whatsapp')
    let ok = 0
    for (const ci of recipients) {
      const name = ci.clients?.full_name ?? ''
      const msg = giftMsg.replace(/\{nome\}/g, name.split(' ')[0]).replace(/\{casa\}/g, house.name || '')
      const fph = fmtWAPhone(ci.clients?.phone ?? '')
      if (useEvolution && fph) {
        try {
          const useMedia = !!giftImage
          const mediaBase64 = giftImage.includes(',') ? giftImage.split(',')[1] : giftImage
          const body = useMedia
            ? { number: fph, mediatype: 'image', media: mediaBase64, caption: msg }
            : { number: fph, text: msg, linkPreview: true }
          const resp = await fetch(`${cfg.api_url}/message/${useMedia ? 'sendMedia' : 'sendText'}/${cfg.instance_name}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.api_key }, body: JSON.stringify(body),
          })
          const res = await resp.json()
          const sent = !!(res?.key || res?.status === 'success' || res?.status === 'PENDING')
          if (sent) ok++
          await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: name, message_type: 'gift', message_body: msg, status: sent ? 'sent' : 'failed', error_msg: sent ? null : JSON.stringify(res) })
        } catch (e: any) {
          await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: name, message_type: 'gift', message_body: msg, status: 'failed', error_msg: e?.message ?? 'erro' })
        }
        await new Promise(r => setTimeout(r, 500))
      } else {
        window.open(`https://wa.me/55${cn(ci.clients?.phone ?? '')}?text=${encodeURIComponent(msg)}`, '_blank')
        ok++; await new Promise(r => setTimeout(r, 800))
      }
      setGiftProgress(p => p ? { ...p, sent: p.sent + 1 } : p)
    }
    setGiftSending(false); setGiftProgress(null); setCiSelected(new Set())
    sT(setToast, `✅ ${ok} mensagem${ok !== 1 ? 's' : ''} enviada${ok !== 1 ? 's' : ''}!`, 'success')
  }

  // Registra o recebimento (total ou parcial) de uma reserva pendente direto pelo card "A receber"
  async function receivePayment(r: Receivable) {
    const raw = payAmt[r.id] ?? ''
    const cents = Math.round((parseFloat(raw.replace(',', '.')) || 0) * 100)
    if (cents <= 0) { sT(setToast, 'Informe um valor válido', 'warn'); return }
    const saldo = r.amount_cents - r.deposit_cents
    const add = Math.min(cents, saldo)
    const newDeposit = r.deposit_cents + add
    const newStatus = newDeposit >= r.amount_cents ? 'paid' : 'partial'
    setPayingId(r.id)
    const { error } = await supabase.from('reservations').update({ deposit_cents: newDeposit, payment_status: newStatus }).eq('id', r.id)
    setPayingId(null)
    if (error) { sT(setToast, 'Erro ao registrar recebimento: ' + error.message, 'error'); return }
    setPayAmt(p => ({ ...p, [r.id]: '' }))
    setReceivables(prev => newStatus === 'paid' ? prev.filter(x => x.id !== r.id) : prev.map(x => x.id === r.id ? { ...x, deposit_cents: newDeposit } : x))
    sT(setToast, `✅ Recebido ${fmtCurrency(add)}${newStatus === 'paid' ? ' — quitado!' : ''}`, 'success')
    load()
  }

  const kpis = KPIS(stats, cash.total)
  const totalPay = payStats.reduce((s, p) => s + p.v, 0)
  const weekMax = Math.max(...weekData.slice(-7).map(d => d.n), 1)
  const hourMax = Math.max(...hourly.map(h => h.n), 1)
  const occPct = evMetrics && evMetrics.capacity > 0 ? Math.min(100, Math.round(evMetrics.checkins / evMetrics.capacity * 100)) : 0
  const arrivedCount = dashRes.filter(r => reservaArrived(r.status)).length
  const activeResCount = dashRes.filter(r => r.status !== 'cancelled').length // total sem canceladas (p/ denominadores)

  return (
    <div className="pb-24 md:pb-10 max-w-[1400px] mx-auto">
      <Toast toast={toast} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-black text-txt tracking-tight truncate">{house.name || 'Dashboard'}</h1>
          <p className="text-mut text-sm first-letter:uppercase">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>

      {/* ── Suas unidades (multi-casa) ── */}
      {unidades.length > 1 && (
        <div className="mb-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-mut mb-2">🏠 Suas unidades</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {unidades.map(u => {
              const atual = u.house_id === house.id
              const dataProx = u.proximo_data
                ? new Date(u.proximo_data + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                : null
              return (
                <button
                  key={u.house_id}
                  onClick={() => { if (!atual) onTrocarCasa?.(u.house_id) }}
                  title={atual ? 'Unidade atual' : `Abrir ${u.house_name}`}
                  className={`text-left rounded-xl border p-3 transition ${atual ? 'border-acc bg-card' : 'border-brd bg-card hover:border-acc cursor-pointer'}`}
                  style={atual ? { borderColor: C.acc, boxShadow: `inset 0 0 0 1px ${C.acc}33` } : undefined}
                >
                  <div className="flex items-center gap-2 mb-2 min-w-0">
                    {u.logo_url
                      ? <img src={u.logo_url} alt="" className="w-7 h-7 rounded-lg object-cover shrink-0" />
                      : <span className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-[11px]" style={{ background: C.brd }}>🎭</span>}
                    <span className="font-bold text-sm text-txt truncate flex-1">{u.house_name}</span>
                    {atual && <span className="text-[10px] font-bold shrink-0" style={{ color: C.acc }}>atual</span>}
                  </div>
                  <div className="text-[11px] text-mut mb-2 truncate">
                    {u.proximo_nome ? `🎉 ${u.proximo_nome} · ${dataProx}` : 'sem evento programado'}
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-center">
                    {[
                      { n: u.eventos_futuros, l: 'eventos', c: '#a78bfa' },
                      { n: u.proximo_reservas, l: 'reservas', c: C.gold },
                      { n: u.checkins_hoje, l: 'check-ins', c: C.acc },
                      { n: fmtCurrency(u.faturamento_hoje_cents), l: 'hoje', c: C.grn },
                    ].map((k, i) => (
                      <div key={i}>
                        <div className="font-black text-[13px] leading-tight truncate" style={{ color: k.c }}>{k.n}</div>
                        <div className="text-[9px] text-mut uppercase tracking-wide">{k.l}</div>
                      </div>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

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
            <div className="flex w-full md:w-auto justify-between md:justify-normal gap-x-2 md:gap-x-6">
              {(() => {
                // Base do DIA (mesma do comparativo) p/ o % de comparecimento bater mesmo com vários eventos:
                // check-ins do dia inteiro ÷ convites do dia (invites_daily). Fallback: escopo do evento.
                const exp = (stats.dayInvited && stats.dayInvited > 0) ? stats.dayInvited : (evMetrics?.expectedPeople ?? 0)
                const ci = (stats.dayInvited && stats.dayInvited > 0) ? stats.todayCount : (evMetrics?.checkins ?? 0)
                const ciPct = exp > 0 ? ` · ${Math.round(ci / exp * 100)}%` : ''
                return [
                { v: exp, l: 'Previstas', c: 'text-gold', on: undefined as (() => void) | undefined },
                { v: `${ci}${ciPct}`, l: 'Check-ins', c: 'text-grn', on: openCheckinsList },
                { v: `${arrivedCount}/${activeResCount}`, l: 'Reservas', c: 'text-purp', on: () => setShowReservations(true) },
                { v: evMetrics?.ticketsSold ?? 0, l: 'Ingressos', c: 'text-acc', on: undefined },
              ]})().map((m, i) => {
                const clickable = !!m.on
                return (
                <div key={i} className="text-center min-w-0" onClick={m.on}
                  style={clickable ? { cursor: 'pointer' } : undefined} title={clickable ? 'Ver detalhes' : undefined}>
                  <div className={`text-lg md:text-2xl font-black leading-none ${m.c}`}>{m.v}</div>
                  <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-mut mt-1 whitespace-nowrap">{m.l}{clickable ? ' 👁️' : ''}</div>
                </div>
                )
              })}
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
        {kpis.map((kpi, i) => {
          const onClick = kpi.label === 'Check-ins hoje' ? openCheckinsList : kpi.label === 'Reservas hoje' ? () => setShowReservations(true) : kpi.label === 'Caixa hoje' ? openCaixa : undefined
          const clickable = !!onClick
          return (
          <div key={i} onClick={onClick}
            className={'card-3d px-4 py-3.5' + (clickable ? ' cursor-pointer' : '')}
            style={{
              background: 'var(--c-kpi-grad)',
              border: '1px solid rgba(59,130,246,0.12)',
              borderTop: `3px solid ${kpi.color}`,
              borderRadius: 16,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), 0 4px 8px rgba(0,0,0,0.35), 0 16px 32px rgba(0,0,0,0.5)',
              transform: 'translateY(-3px)',
            }}
            title={kpi.label === 'Check-ins hoje' ? '↩ = taxa de retorno hoje (check-ins de clientes que já vieram antes) · toque para detalhes' : clickable ? 'Ver detalhes' : undefined}>
            <i className={'bi ' + kpi.icon} style={{ color: kpi.color, fontSize: 19 }} aria-hidden="true" />
            <div className="text-txt text-[22px] font-semibold leading-none mt-2.5 tabular-nums" style={{ whiteSpace: 'nowrap' }}>
              {kpi.value}
              {(kpi as { sub?: string }).sub && <span style={{ fontSize: 14, fontWeight: 700, color: kpi.color, marginLeft: 5 }}>· {(kpi as { sub?: string }).sub}</span>}
            </div>
            <div className="text-mut text-[11px] mt-1.5 truncate">{kpi.label}{clickable ? ' 👁️' : ''}</div>
          </div>
          )
        })}
      </div>

      {/* ── Caixa do dia + Resultado da noite ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Caixa do dia */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.txt }}>💵 Caixa do dia</div>
            <button onClick={() => setShowCashClose(true)}
              style={{ background: C.gold + '22', border: `1px solid ${C.gold}44`, borderRadius: 8, padding: '5px 12px', color: C.gold, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              🖨️ Fechar Caixa
            </button>
          </div>
          {[
            { label: '🚪 Portaria (check-ins)', val: cash.door, color: C.grn },
            { label: '🎫 Ingressos online', val: cash.tickets, color: C.acc },
            { label: '🪑 Recebido de reservas', val: cash.reservations, color: '#a78bfa' },
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
          {/* A receber */}
          {receivables.length > 0 && (
            <button onClick={() => setShowReceivables(true)}
              style={{ width: '100%', marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', borderRadius: 10, border: '1px solid #f59e0b44', background: '#f59e0b11', cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>💸 A receber</span>
              <span style={{ color: '#f59e0b', fontWeight: 900, fontSize: 14 }}>
                {fmtCurrency(receivables.reduce((s, r) => s + (r.amount_cents - r.deposit_cents), 0))} →
              </span>
            </button>
          )}
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
            {(() => {
              const nowD = new Date()
              const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`
              return weekData.slice(-7).map((d, i) => {
                const isToday = d.d === todayStr
                return (
                  <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ background: isToday ? C.grn : (d.n > 0 ? C.acc : C.brd), borderRadius: 4, height: Math.max(4, (d.n / weekMax) * 48), marginBottom: 4, transition: 'height .3s' }} />
                    <div style={{ fontSize: 10, color: isToday ? C.grn : C.mut, fontWeight: isToday ? 800 : 400 }}>{isToday ? 'Hoje' : new Date(d.d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' })}</div>
                    <div style={{ fontSize: 11, color: isToday ? C.grn : C.txt, fontWeight: isToday ? 800 : 600 }}>{d.n}</div>
                  </div>
                )
              })
            })()}
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

      {/* ── Comparativo (metade) + Próximos eventos (metade) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      {weekData.length > 0 && (() => {
        const WDSING = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
        const WDPLUR = ['domingos', 'segundas-feiras', 'terças-feiras', 'quartas-feiras', 'quintas-feiras', 'sextas-feiras', 'sábados']
        const todayDow = new Date().getDay()
        const sameDow = weekData.filter(d => new Date(d.d + 'T12:00').getDay() === compareDow).slice(-6)
        const maxN = Math.max(...sameDow.map(d => d.n), 1)
        const nowD = new Date()
        const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`
        return (
          <div className="rounded-2xl bg-card border border-brd p-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.txt }}>🔁 Comparativo — {WDPLUR[compareDow]}</div>
              <select value={compareDow} onChange={e => setCompareDow(Number(e.target.value))}
                style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '5px 10px', color: C.txt, fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
                {WDSING.map((w, i) => <option key={i} value={i}>{w}{i === todayDow ? ' (hoje)' : ''}</option>)}
              </select>
            </div>
            {sameDow.length < 2 ? (
              <div style={{ fontSize: 13, color: C.mut, textAlign: 'center', padding: '20px 0' }}>Ainda não há histórico suficiente para {WDPLUR[compareDow]}.</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: C.mut, marginBottom: 16 }}>Fluxo de pessoas e ticket médio nos últimos {sameDow.length} {WDPLUR[compareDow]}</div>
                <div className="r-scroll-x" style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'flex', gap: 10, minWidth: sameDow.length * 84 }}>
                    {sameDow.map((d, i) => {
                      const isToday = d.d === todayStr
                      const avgTicket = d.n > 0 ? d.r / d.n : 0
                      const compPct = (d.invited ?? 0) > 0 ? Math.round(d.n / (d.invited ?? 1) * 100) : null
                      const barH = Math.max(4, (d.n / maxN) * 56)
                      return (
                        <div key={i} style={{ flex: '1 0 74px', minWidth: 74, textAlign: 'center', background: isToday ? C.acc + '14' : 'transparent', border: isToday ? `1px solid ${C.acc}44` : '1px solid transparent', borderRadius: 12, padding: '10px 4px' }}>
                          <div style={{ fontSize: 11, color: isToday ? C.acc : C.mut, fontWeight: isToday ? 800 : 600, marginBottom: 8 }}>
                            {isToday ? 'Hoje' : new Date(d.d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', height: 56 }}>
                            <div title={compPct != null ? `${d.n} de ${d.invited} convidados compareceram` : undefined}
                              style={{ position: 'relative', width: '60%', background: isToday ? C.acc : (d.n > 0 ? '#94a3b8' : C.brd), borderRadius: 4, height: barH, transition: 'height .3s' }}>
                              {compPct != null && (
                                <span style={{ position: 'absolute', left: 0, right: 0, ...(barH >= 22 ? { top: 3 } : { top: -15 }), fontSize: 9, fontWeight: 800, color: barH >= 22 ? '#fff' : C.acc, textShadow: barH >= 22 ? '0 1px 2px rgba(0,0,0,0.5)' : 'none' }}>{compPct}%</span>
                              )}
                            </div>
                          </div>
                          <div style={{ fontSize: 16, color: isToday ? C.acc : C.txt, fontWeight: 900, marginTop: 6 }}>{d.n}</div>
                          <div style={{ fontSize: 10, color: C.mut, marginBottom: 4 }}>pessoas{compPct != null ? ` · ${compPct}% compareceu` : ''}</div>
                          <div style={{ fontSize: 12, color: C.grn, fontWeight: 700 }}>{fmtCurrency(avgTicket)}</div>
                          <div style={{ fontSize: 9, color: C.mut }}>ticket médio</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {(() => {
                  const totalN = sameDow.reduce((s, d) => s + d.n, 0)
                  const totalR = sameDow.reduce((s, d) => s + d.r, 0)
                  const avgN = totalN / sameDow.length
                  const avgTicketAll = totalN > 0 ? totalR / totalN : 0
                  const others = sameDow.filter(d => d.d !== todayStr)
                  const avgNOthers = others.length ? others.reduce((s, d) => s + d.n, 0) / others.length : null
                  const todayEntry = sameDow.find(d => d.d === todayStr)
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
          </div>
        )
      })()}

        {/* Próximos eventos */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>🗓️ Próximos eventos</div>
          {upcoming.length === 0 ? (
            <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum evento agendado.</div>
          ) : <ScrollBox bleedRight={16} maxHeight={320}>{upcoming.map((ev, i) => {
            const d = new Date(ev.event_date + 'T12:00')
            const dd = String(d.getDate()).padStart(2, '0')
            const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
            const wd = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
            const isToday = ev.event_date === bizTodayStr()
            const matchRes = upcomingRes.filter(r => r.event_id ? r.event_id === ev.id : r.reservation_date === ev.event_date)
            const resN = matchRes.length
            // Mesma regra da tela de Eventos: vale o MAIOR entre o que a reserva
            // declarou e quem ja foi cadastrado nela. Quem reservou para 70 e ja
            // cadastrou 123 leva 123 — planejar a porta pelo declarado fura.
            const resPeople = matchRes.reduce((s, r) => s + esperadoDaReserva(r), 0)
            const g = upcomingGuests[ev.id] ?? { total: 0, confirmed: 0 }
            const convidadosTotal = g.total + resPeople
            return (
              <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < upcoming.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                {ev.flyer_url ? (
                  <img loading="lazy" decoding="async" src={ev.flyer_url} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: C.acc + '18', border: `1px solid ${C.acc}33`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}>
                    <span style={{ fontSize: 15, fontWeight: 900, color: C.acc }}>{dd}</span>
                    <span style={{ fontSize: 8, color: C.acc, textTransform: 'uppercase', marginTop: 1 }}>{mon}</span>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: C.txt, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.name}</span>
                    {isToday && <span style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44`, borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>Hoje</span>}
                  </div>
                  <div style={{ color: C.mut, fontSize: 11, textTransform: 'capitalize' }}>{wd}, {dd}/{String(d.getMonth() + 1).padStart(2, '0')}{ev.start_time ? ` · ${ev.start_time.slice(0, 5)}` : ''}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4, fontSize: 11 }}>
                    <span style={{ color: C.acc, fontWeight: 700 }}>👥 {convidadosTotal} <span style={{ color: C.mut, fontWeight: 400 }}>convidados</span></span>
                    <span style={{ color: C.grn, fontWeight: 700 }}>✅ {g.confirmed} <span style={{ color: C.mut, fontWeight: 400 }}>confirm.</span></span>
                    <span style={{ color: C.gold, fontWeight: 700 }}>🪑 {resN} <span style={{ color: C.mut, fontWeight: 400 }}>reserva{resN === 1 ? '' : 's'}</span></span>
                  </div>
                </div>
              </div>
            )
          })}</ScrollBox>}
        </div>
      </div>

      {/* ── Equipe do dia ── */}
      <div className="rounded-2xl bg-card border border-brd p-4 mb-4">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt }}>👷 Equipe de hoje</div>
          {teamToday.length > 0 && (() => {
            const presentes = teamToday.filter(t => t.entrada && !t.saida).length
            const sairam = teamToday.filter(t => t.saida).length
            const faltam = teamToday.filter(t => !t.entrada).length
            return (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { l: 'escalados', v: teamToday.length, c: C.mut },
                  { l: 'na casa', v: presentes, c: C.grn },
                  { l: 'saíram', v: sairam, c: C.acc },
                  { l: 'não chegaram', v: faltam, c: faltam > 0 ? C.gold : C.mut },
                ].map(k => (
                  <span key={k.l} style={{ background: k.c + '1a', color: k.c, border: `1px solid ${k.c}44`, borderRadius: 7, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}>
                    {k.v} {k.l}
                  </span>
                ))}
              </div>
            )
          })()}
        </div>
        {teamToday.length === 0 ? (
          <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            {evMetrics ? 'Nenhum colaborador escalado para hoje.' : 'Sem evento hoje.'}
          </div>
        ) : (
          <ScrollBox bleedRight={16} maxHeight={300}>
            {teamToday.map((t, i) => {
              const st = t.saida
                ? { txt: 'saiu', cor: C.acc, dot: C.acc }
                : t.entrada
                  ? { txt: 'na casa', cor: C.grn, dot: C.grn }
                  : { txt: 'não chegou', cor: C.gold, dot: C.mut }
              const hora = (iso: string | null) => iso
                ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
              // Atrasado = passou do horário previsto e ainda não bateu entrada.
              // Compara em minutos do dia de operação (madrugada = +24h), senão às 01h
              // um previsto de 22:00 pareceria "ainda não chegou a hora".
              const emMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return ((h < 12 ? h + 24 : h) * 60 + (m || 0)) }
              const agora = new Date()
              const atrasado = !t.entrada && !!t.previsto &&
                emMin(t.previsto) < emMin(`${agora.getHours()}:${agora.getMinutes()}`)
              const area = areaMeta(workAreas, t.area)
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 0', borderBottom: i < teamToday.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot, flexShrink: 0, boxShadow: t.entrada && !t.saida ? `0 0 6px ${C.grn}` : 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.txt, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.nome}</div>
                    <div style={{ color: C.mut, fontSize: 11 }}>
                      <span style={{ color: area.color }}>{area.icon} {area.label}</span>
                      {t.previsto && ` · previsto ${t.previsto}`}
                      {hora(t.entrada) && ` · entrou ${hora(t.entrada)}`}
                      {hora(t.saida) && ` · saiu ${hora(t.saida)}`}
                    </div>
                  </div>
                  {atrasado && <span style={{ color: C.gold, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>⏰ atrasado</span>}
                  <span style={{ color: st.cor, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{st.txt}</span>
                  {t.phone && !t.entrada && (
                    <button onClick={() => sendWADirect(house.id, t.phone ?? '', `Olá ${t.nome.split(' ')[0]}! Tudo certo para hoje? A equipe já está na casa.`, { type: 'direct' })}
                      title="Chamar no WhatsApp"
                      style={{ background: '#25d36622', border: '1px solid #25d36644', borderRadius: 7, padding: '3px 8px', color: '#25d366', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>💬</button>
                  )}
                </div>
              )
            })}
          </ScrollBox>
        )}
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
              { ok: evMetrics.freelancersPending === 0, icon: '👥', label: 'Freelancers que não chegaram', val: evMetrics.freelancersPending },
              { ok: evMetrics.ticketsPending === 0, icon: '🎫', label: 'Ingressos com pagamento pendente', val: evMetrics.ticketsPending, extra: evMetrics.ticketsPending > 0 ? fmtCurrency(evMetrics.ticketsPendingValue) : '' },
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

        {/* Aniversariantes */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.txt }}>🎂 Aniversariantes</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {([['day', 'Hoje'], ['week', '7 dias'], ['month', 'Mês']] as const).map(([t, l]) => {
                const cnt = t === 'day' ? birthdays.length : t === 'week' ? bdWeek.length : bdMonth.length
                return (
                  <button key={t} onClick={() => setBdTab(t)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${bdTab === t ? C.gold : C.brd}`, background: bdTab === t ? C.gold + '22' : 'transparent', color: bdTab === t ? C.gold : C.mut, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {l} {cnt > 0 ? `(${cnt})` : ''}
                  </button>
                )
              })}
            </div>
          </div>
          {(() => {
            const list = bdTab === 'day' ? birthdays : bdTab === 'week' ? bdWeek : bdMonth
            if (list.length === 0) return <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum aniversariante.</div>
            return <ScrollBox bleedRight={16} maxHeight={288}>{list.map((b, i) => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < list.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🎈</span>
                  <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{b.full_name}</span>
                </div>
                {b.phone && (
                  <button onClick={() => sendWADirect(house.id, b.phone ?? '', `🎂 Feliz aniversário, ${b.full_name.split(' ')[0]}! 🎉`, { type: 'birthday_wish' })}
                    style={{ background: '#25d36622', border: '1px solid #25d36644', borderRadius: 8, padding: '4px 10px', color: '#25d366', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>💬</button>
                )}
              </div>
            ))}</ScrollBox>
          })()}
        </div>
      </div>

      {/* ── Bottom: pagamento + reservas + recentes + check-in rápido ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Payment breakdown (today) */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 16 }}>💳 Formas de pagamento (hoje)</div>
          {payStats.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem pagamentos hoje.</div>
            : <ScrollBox bleedRight={16} maxHeight={300}>{payStats.map((ps, i) => (
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
            ))}</ScrollBox>
          }
        </div>

        {/* Today's / week reservations */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.txt }}>🪑 Reservas {resTab === 'day' ? `hoje (${arrivedCount}/${activeResCount})` : `da semana (${weekRes.length})`}</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['day', 'week'] as const).map(t => (
                <button key={t} onClick={() => setResTab(t)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${resTab === t ? C.acc : C.brd}`, background: resTab === t ? C.acc + '22' : 'transparent', color: resTab === t ? C.acc : C.mut, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {t === 'day' ? 'Hoje' : 'Semana'}
                </button>
              ))}
            </div>
          </div>
          {(() => {
            const list = resTab === 'day' ? dashRes : weekRes
            if (list.length === 0) return <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem reservas</div>
            return <ScrollBox bleedRight={16} maxHeight={300}>{list.map((r, i) => {
              const arrived = reservaArrived(r.status)
              const cancelled = r.status === 'cancelled'
              return (
                <div key={r.id || i} style={{ padding: '9px 0', borderBottom: i < list.length - 1 ? `1px solid ${C.brd}22` : 'none', opacity: cancelled ? 0.55 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ color: C.txt, fontSize: 13, fontWeight: 600, textDecoration: cancelled ? 'line-through' : 'none' }}>{r.name}</div>
                    {resTab === 'day'
                      ? cancelled
                        ? <span style={{ background: C.red + '22', color: C.red, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>✖ Cancelada</span>
                        : <span style={{ background: arrived ? C.grn + '22' : C.gold + '22', color: arrived ? C.grn : C.gold, border: `1px solid ${arrived ? C.grn : C.gold}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                          {arrived ? '✅ Chegou' : '⏳ Aguardando'}
                        </span>
                      : <span style={{ color: C.mut, fontSize: 11 }}>
                          {r.reservation_date ? new Date(r.reservation_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) : ''}
                        </span>
                    }
                  </div>
                  <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
                    {r.expected_arrival ? `${r.expected_arrival.slice(0, 5)} · ` : ''}{r.people_count ?? 0} pessoas{r.location ? ` · 📍 ${r.location}` : ''}
                  </div>
                </div>
              )
            })}</ScrollBox>
          })()}
        </div>
      </div>

      <div className="mb-4">
        {/* Recent check-ins */}
        <div className="rounded-2xl bg-card border border-brd p-4">
          <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>🔵 Últimos Check-ins</div>
          {recent.length === 0
            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum check-in hoje</div>
            : <ScrollBox bleedRight={16} maxHeight={340}>{recent.map((ci, i) => (
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
            ))}</ScrollBox>
          }
        </div>
      </div>

      {/* Modal: Check-ins do dia (quem está na casa) */}
      {showCheckins && (
        <>
          <div onClick={() => setShowCheckins(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2001, background: C.card, borderRadius: 20, padding: 20, width: 'min(94vw,520px)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.txt }}>🚪 Check-ins do dia {!ciListLoading && <span style={{ color: C.grn }}>({ciList.length})</span>}</div>
              <button onClick={() => setShowCheckins(false)} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ color: C.mut, fontSize: 12, marginBottom: 12 }}>Quem está/esteve na casa — envie brinde ou convite com confirmação pelo WhatsApp.</div>

            {/* Seletor de modo */}
            <div style={{ display: 'flex', gap: 6, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 4, marginBottom: 12 }}>
              {([['gift', '🎁 Brinde'], ['invite', '🎫 Convite + confirmação']] as const).map(([m, label]) => (
                <button key={m} onClick={() => setCiMode(m)}
                  style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: ciMode === m ? C.acc + '22' : 'transparent', color: ciMode === m ? C.acc : C.mut, fontSize: 12.5, fontWeight: ciMode === m ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── MODO CONVITE ── */}
            {ciMode === 'invite' && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>EVENTO DA PROMOÇÃO</label>
                {inviteEvents.length === 0
                  ? <div style={{ color: C.gold, fontSize: 12, padding: '8px 0' }}>⚠️ Nenhum evento futuro cadastrado. Crie o evento (com flyer e preço de lista) na aba Eventos.</div>
                  : <>
                    <select value={inviteEventId} onChange={e => setInviteEventId(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '9px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 8 }}>
                      {inviteEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.name} — {new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</option>)}
                    </select>
                    {(() => {
                      const ev = inviteEvents.find(e => e.id === inviteEventId)
                      const hasFlyer = !!ev?.flyer_url
                      const hasListPrice = (ev?.price_male_list_cents ?? 0) > 0 || (ev?.price_female_list_cents ?? 0) > 0
                      return (
                        <div style={{ fontSize: 11, color: C.mut, lineHeight: 1.6, marginBottom: 8 }}>
                          <div>{hasFlyer ? '🖼️ Flyer do evento será anexado' : '⚠️ Evento sem flyer — só texto será enviado'}</div>
                          <div>{hasListPrice ? '💸 Confirmados pagam o preço de lista na portaria' : '⚠️ Evento sem preço de lista — defina em Eventos para aplicar desconto'}</div>
                        </div>
                      )
                    })()}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.sub, cursor: 'pointer' }}>
                      <input type="checkbox" checked={inviteFriendsOn} onChange={e => setInviteFriendsOn(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.acc }} />
                      Permitir convidar amigos
                      {inviteFriendsOn && (
                        <input type="number" min={0} value={inviteFriends} onChange={e => setInviteFriends(parseInt(e.target.value) || 0)}
                          style={{ width: 56, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '4px 8px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} title="0 = ilimitado" />
                      )}
                      {inviteFriendsOn && <span style={{ fontSize: 10, color: C.mut }}>{inviteFriends === 0 ? 'ilimitado' : `até ${inviteFriends}`}</span>}
                    </label>
                  </>}
              </div>
            )}

            {/* Mensagem do brinde (editável) — só no modo brinde */}
            {ciMode === 'gift' && (<>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>MENSAGEM DO BRINDE / DESCONTO</label>
                <textarea value={giftMsg} onChange={e => setGiftMsg(e.target.value)} rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
                <div style={{ color: C.mut, fontSize: 10, marginTop: 3 }}>Use {'{nome}'} e {'{casa}'} — serão substituídos automaticamente.</div>
              </div>
              {/* Imagem opcional */}
              <div style={{ marginBottom: 10 }}>
                {giftImage ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img loading="lazy" decoding="async" src={giftImage} alt="anexo" style={{ maxHeight: 90, borderRadius: 8, border: `1px solid ${C.brd}`, display: 'block' }} />
                    <button onClick={() => setGiftImage('')}
                      style={{ position: 'absolute', top: 4, right: 4, background: '#0009', border: 'none', borderRadius: '50%', width: 24, height: 24, color: '#fff', fontSize: 13, cursor: 'pointer' }}>✕</button>
                  </div>
                ) : (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px dashed ${C.brd}`, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: C.mut }}>
                    📎 Anexar imagem (opcional)
                    <input type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) loadGiftImage(f); e.target.value = '' }} />
                  </label>
                )}
              </div>
            </>)}

            {/* Busca + selecionar todos — ambos os modos */}
            <input value={ciListSearch} onChange={e => setCiListSearch(e.target.value)} placeholder="🔍 Filtrar por nome..."
              style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '9px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 8 }} />
            {!ciListLoading && ciList.length > 0 && (() => {
              const withPhone = ciList.filter(ci => ci.clients?.phone)
              const allSel = withPhone.length > 0 && withPhone.every(ci => ciSelected.has(ci.id))
              return (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <button onClick={() => setCiSelected(allSel ? new Set() : new Set(withPhone.map(ci => ci.id)))}
                    style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {allSel ? '☑️ Desmarcar todos' : '⬜ Selecionar todos'}
                  </button>
                  <span style={{ color: C.mut, fontSize: 12 }}>{ciSelected.size} selecionado{ciSelected.size !== 1 ? 's' : ''}</span>
                </div>
              )
            })()}

            <div style={{ overflowY: 'auto', flex: 1, margin: '0 -4px', padding: '0 4px' }}>
              {ciListLoading
                ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Carregando…</div>
                : (() => {
                    const q = cn(ciListSearch) // só dígitos: usado p/ busca por telefone
                    const qName = ciListSearch.trim().toLowerCase()
                    const filtered = ciList.filter(ci => {
                      const nm = (ci.clients?.full_name ?? '').toLowerCase()
                      const ph = ci.clients?.phone ?? ''
                      // telefone só entra no match se o usuário digitou dígitos (senão "".includes('') passava tudo)
                      return !qName || nm.includes(qName) || (q.length > 0 && ph.includes(q))
                    })
                    if (filtered.length === 0) return <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum check-in encontrado.</div>
                    return filtered.map((ci, i) => {
                      const name = ci.clients?.full_name ?? 'Visitante'
                      const phone = ci.clients?.phone ?? ''
                      const hh = new Date(ci.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      const sel = ciSelected.has(ci.id)
                      return (
                        <div key={ci.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < filtered.length - 1 ? `1px solid ${C.brd}33` : 'none' }}>
                          {phone
                            ? <input type="checkbox" checked={sel} onChange={() => toggleCiSelected(ci.id)}
                                style={{ width: 18, height: 18, flexShrink: 0, accentColor: '#25D366', cursor: 'pointer' }} />
                            : <span style={{ width: 18, flexShrink: 0 }} />}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ color: C.txt, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}{ci.amount_corrected && <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 700, color: C.gold, background: C.gold + '22', borderRadius: 5, padding: '1px 5px', textTransform: 'uppercase' }}>corrigido</span>}</div>
                            <div style={{ color: C.mut, fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                              <span>🕒 {hh}</span>
                              {ciEdit?.id === ci.id ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  <span>· R$</span>
                                  <input value={ciEdit.val} autoFocus inputMode="decimal"
                                    onChange={e => setCiEdit({ id: ci.id, val: e.target.value })}
                                    onKeyDown={e => { if (e.key === 'Enter') saveCiAmount(ci.id); if (e.key === 'Escape') setCiEdit(null) }}
                                    style={{ width: 72, background: C.bg, border: `1px solid ${C.acc}`, borderRadius: 6, padding: '2px 6px', color: C.txt, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
                                  <button onClick={() => saveCiAmount(ci.id)} title="Salvar" style={{ background: C.acc, border: 'none', borderRadius: 6, padding: '2px 7px', color: '#fff', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                                  <button onClick={() => setCiEdit(null)} title="Cancelar" style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '2px 6px', color: C.mut, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                                </span>
                              ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <span>· {fmtCurrency(ci.amount_cents)}</span>
                                  {canEditCash && <button onClick={() => setCiEdit({ id: ci.id, val: (ci.amount_cents / 100).toFixed(2).replace('.', ',') })} title="Corrigir valor" style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, cursor: 'pointer', padding: 0, lineHeight: 1 }}>✏️</button>}
                                </span>
                              )}
                              {ci.comanda ? <span>· 🪙 {ci.comanda}</span> : null}
                            </div>
                          </div>
                          {phone && ciMode === 'gift'
                            ? <button onClick={() => sendWADirect(house.id, phone, giftMsg.replace(/\{nome\}/g, name.split(' ')[0]).replace(/\{casa\}/g, house.name || ''), { type: 'gift', mediaUrl: giftImage ? (giftImage.includes(',') ? giftImage.split(',')[1] : giftImage) : undefined })}
                                style={{ flexShrink: 0, background: '#25D36622', border: '1px solid #25D36655', borderRadius: 8, padding: '6px 12px', color: '#25D366', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <i className="bi bi-whatsapp" /> Brinde
                              </button>
                            : !phone ? <span style={{ flexShrink: 0, color: C.mut, fontSize: 10 }}>sem telefone</span> : null}
                        </div>
                      )
                    })
                  })()
              }
            </div>

            {/* Rodapé: progresso + botão de envio em massa */}
            {giftProgress && (
              <div style={{ margin: '10px 0 6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.mut, marginBottom: 4 }}>
                  <span>Enviando…</span><span>{giftProgress.sent}/{giftProgress.total}</span>
                </div>
                <div style={{ background: C.brd, borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{ background: '#25D366', borderRadius: 4, height: 6, width: `${(giftProgress.sent / giftProgress.total) * 100}%`, transition: 'width 0.3s' }} />
                </div>
              </div>
            )}
            {ciMode === 'gift' && ciSelected.size > 0 && (
              <button onClick={sendGiftBulk} disabled={giftSending}
                style={{ marginTop: 12, width: '100%', background: giftSending ? '#25D36644' : '#25D366', border: 'none', borderRadius: 12, padding: '13px', color: '#062e16', fontSize: 14, fontWeight: 800, cursor: giftSending ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <i className="bi bi-whatsapp" /> {giftSending ? 'Enviando…' : `Enviar brinde para ${ciSelected.size} selecionado${ciSelected.size !== 1 ? 's' : ''}`}
              </button>
            )}
            {ciMode === 'invite' && ciSelected.size > 0 && (
              <button onClick={sendInviteBulk} disabled={giftSending}
                style={{ marginTop: 12, width: '100%', background: giftSending ? '#3b82f644' : C.acc, border: 'none', borderRadius: 12, padding: '13px', color: '#fff', fontSize: 14, fontWeight: 800, cursor: giftSending ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                🎫 {giftSending ? 'Enviando…' : `Enviar convite para ${ciSelected.size} selecionado${ciSelected.size !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </>
      )}

      {/* Modal: Valores a Receber */}
      {showReceivables && (
        <>
          <div onClick={() => setShowReceivables(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2001, background: C.card, borderRadius: 20, padding: 24, width: 'min(92vw,480px)', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.txt }}>💸 Valores a Receber</div>
              <button onClick={() => setShowReceivables(false)} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            {receivables.length === 0
              ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Sem pendências.</div>
              : receivables.map((r, i) => {
                  const saldo = r.amount_cents - r.deposit_cents
                  return (
                    <div key={r.id} style={{ padding: '10px 0', borderBottom: i < receivables.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                        <span style={{ color: '#f59e0b', fontWeight: 900, fontSize: 14 }}>{fmtCurrency(saldo)}</span>
                      </div>
                      <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
                        {r.reservation_date ? new Date(r.reservation_date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' · ' : ''}
                        Total: {fmtCurrency(r.amount_cents)}{r.deposit_cents > 0 ? ` · Sinal: ${fmtCurrency(r.deposit_cents)}` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <input
                          type="text" inputMode="decimal"
                          placeholder={`Valor recebido (máx ${fmtCurrency(saldo)})`}
                          value={payAmt[r.id] ?? ''}
                          onChange={e => setPayAmt(p => ({ ...p, [r.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') receivePayment(r) }}
                          style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }}
                        />
                        <button
                          onClick={() => receivePayment(r)}
                          disabled={payingId === r.id || !(payAmt[r.id] ?? '').trim()}
                          style={{
                            background: '#10b98122', border: '1px solid #10b98144', borderRadius: 8, padding: '0 14px',
                            color: '#10b981', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                            opacity: payingId === r.id || !(payAmt[r.id] ?? '').trim() ? 0.5 : 1,
                          }}>
                          {payingId === r.id ? '...' : '💰 Receber'}
                        </button>
                        <button
                          onClick={() => { setPayAmt(p => ({ ...p, [r.id]: (saldo / 100).toFixed(2).replace('.', ',') })); }}
                          title="Preencher com o saldo total"
                          style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '0 10px', color: C.mut, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Tudo
                        </button>
                      </div>
                    </div>
                  )
                })
            }
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.brd}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: C.mut, fontSize: 13 }}>Total a receber</span>
              <span style={{ color: '#f59e0b', fontWeight: 900, fontSize: 18 }}>{fmtCurrency(receivables.reduce((s, r) => s + (r.amount_cents - r.deposit_cents), 0))}</span>
            </div>
          </div>
        </>
      )}

      {/* Modal: Reservas do dia — valores editáveis + cancelar */}
      {showReservations && (
        <>
          <div onClick={() => { setShowReservations(false); setResEdit(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2001, background: C.card, borderRadius: 20, padding: 20, width: 'min(94vw,520px)', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.txt }}>🪑 Reservas do dia ({dashRes.filter(r => r.status !== 'cancelled').length})</div>
              <button onClick={() => { setShowReservations(false); setResEdit(null) }} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            {dashRes.length === 0
              ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhuma reserva para hoje.</div>
              : dashRes.map((r, i) => {
                const cancelled = r.status === 'cancelled'
                return (
                  <div key={r.id} style={{ padding: '10px 0', borderBottom: i < dashRes.length - 1 ? `1px solid ${C.brd}22` : 'none', opacity: cancelled ? 0.55 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: C.txt, fontSize: 14, fontWeight: 600, textDecoration: cancelled ? 'line-through' : 'none' }}>{r.name}</span>
                        {r.amount_corrected && !cancelled && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: C.gold, background: C.gold + '22', border: `1px solid ${C.gold}44`, borderRadius: 6, padding: '1px 6px', textTransform: 'uppercase' }}>corrigido</span>}
                        {cancelled && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: C.red, background: C.red + '22', border: `1px solid ${C.red}44`, borderRadius: 6, padding: '1px 6px', textTransform: 'uppercase' }}>cancelada</span>}
                        <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
                          {r.people_count ? `👥 ${r.people_count}` : ''}{r.location ? ` · 📍 ${r.location}` : ''}{r.expected_arrival ? ` · 🕐 ${r.expected_arrival.slice(0, 5)}` : ''}
                        </div>
                      </div>
                      {resEdit?.id === r.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{ color: C.mut, fontSize: 12 }}>R$</span>
                          <input value={resEdit.val} autoFocus inputMode="decimal"
                            onChange={e => setResEdit({ id: r.id, val: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') saveResAmount(r.id); if (e.key === 'Escape') setResEdit(null) }}
                            style={{ width: 80, background: C.bg, border: `1px solid ${C.acc}`, borderRadius: 6, padding: '3px 6px', color: C.txt, fontSize: 13, fontFamily: 'inherit', textAlign: 'right' }} />
                          <button onClick={() => saveResAmount(r.id)} style={{ background: C.acc, border: 'none', borderRadius: 6, padding: '3px 7px', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                          <button onClick={() => setResEdit(null)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 6px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <span style={{ color: '#f472b6', fontWeight: 700, fontSize: 14 }}>{fmtCurrency(r.amount_cents ?? 0)}</span>
                          {!cancelled && canEditCash && <button onClick={() => setResEdit({ id: r.id, val: ((r.amount_cents ?? 0) / 100).toFixed(2).replace('.', ',') })} title="Corrigir valor" style={{ background: 'none', border: 'none', color: C.acc, fontSize: 13, cursor: 'pointer' }}>✏️</button>}
                          {!cancelled && canEditCash && <button onClick={() => cancelReserva(r)} title="Cancelar reserva" style={{ background: 'none', border: 'none', color: C.red, fontSize: 13, cursor: 'pointer' }}>🗑</button>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            {!canEditCash && <div style={{ color: C.mut, fontSize: 11, marginTop: 12, textAlign: 'center' }}>Correção e cancelamento disponíveis para admin/financeiro.</div>}
          </div>
        </>
      )}

      {/* Modal: Caixa hoje — todas as entradas (check-ins + reservas) com correção */}
      {showCaixa && (
        <>
          <div onClick={() => { setShowCaixa(false); setCiEdit(null); setResEdit(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2001, background: C.card, borderRadius: 20, padding: 20, width: 'min(94vw,560px)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.txt }}>💰 Caixa hoje — {fmtCurrency(cash.total)}</div>
              <button onClick={() => { setShowCaixa(false); setCiEdit(null); setResEdit(null) }} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, color: C.mut, marginBottom: 14 }}>
              <span>🚪 Porta: <strong style={{ color: C.txt }}>{fmtCurrency(cash.door)}</strong></span>
              <span>🎫 Ingressos: <strong style={{ color: C.txt }}>{fmtCurrency(cash.tickets)}</strong></span>
              <span>🪑 Reservas: <strong style={{ color: C.txt }}>{fmtCurrency(cash.reservations)}</strong></span>
            </div>
            {!canEditCash && <div style={{ color: C.mut, fontSize: 11, marginBottom: 10 }}>Correção disponível para admin/financeiro.</div>}

            {/* Check-ins (porta) */}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.grn, margin: '4px 0 6px' }}>🚪 Check-ins (porta)</div>
            {ciListLoading
              ? <div style={{ color: C.mut, fontSize: 13, padding: '8px 0' }}>Carregando…</div>
              : ciList.length === 0
                ? <div style={{ color: C.mut, fontSize: 13, padding: '8px 0' }}>Sem check-ins hoje.</div>
                : ciList.map((ci, i) => (
                  <div key={ci.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: i < ciList.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                    <span style={{ color: C.txt, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ci.clients?.full_name ?? 'Visitante'}<span style={{ color: C.mut, fontSize: 11 }}> · {new Date(ci.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>{ci.amount_corrected && <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 700, color: C.gold, background: C.gold + '22', borderRadius: 5, padding: '1px 5px', textTransform: 'uppercase' }}>corrigido</span>}</span>
                    {ciEdit?.id === ci.id ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                        <span style={{ color: C.mut, fontSize: 12 }}>R$</span>
                        <input value={ciEdit.val} autoFocus inputMode="decimal" onChange={e => setCiEdit({ id: ci.id, val: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') saveCiAmount(ci.id); if (e.key === 'Escape') setCiEdit(null) }} style={{ width: 76, background: C.bg, border: `1px solid ${C.acc}`, borderRadius: 6, padding: '3px 6px', color: C.txt, fontSize: 13, fontFamily: 'inherit', textAlign: 'right' }} />
                        <button onClick={() => saveCiAmount(ci.id)} style={{ background: C.acc, border: 'none', borderRadius: 6, padding: '3px 7px', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                        <button onClick={() => setCiEdit(null)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 6px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ color: C.gold, fontWeight: 600, fontSize: 13 }}>{fmtCurrency(ci.amount_cents)}</span>
                        {canEditCash && <button onClick={() => setCiEdit({ id: ci.id, val: (ci.amount_cents / 100).toFixed(2).replace('.', ',') })} title="Corrigir valor" style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, cursor: 'pointer' }}>✏️</button>}
                      </span>
                    )}
                  </div>
                ))}

            {/* Reservas */}
            <div style={{ fontSize: 12, fontWeight: 700, color: '#f472b6', margin: '14px 0 6px' }}>🪑 Reservas</div>
            {dashRes.filter(r => r.status !== 'cancelled').length === 0
              ? <div style={{ color: C.mut, fontSize: 13, padding: '8px 0' }}>Sem reservas hoje.</div>
              : dashRes.filter(r => r.status !== 'cancelled').map((r, i, arr) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: i < arr.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                  <span style={{ color: C.txt, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{r.amount_corrected && <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 700, color: C.gold, background: C.gold + '22', borderRadius: 5, padding: '1px 5px', textTransform: 'uppercase' }}>corrigido</span>}</span>
                  {resEdit?.id === r.id ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                      <span style={{ color: C.mut, fontSize: 12 }}>R$</span>
                      <input value={resEdit.val} autoFocus inputMode="decimal" onChange={e => setResEdit({ id: r.id, val: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') saveResAmount(r.id); if (e.key === 'Escape') setResEdit(null) }} style={{ width: 76, background: C.bg, border: `1px solid ${C.acc}`, borderRadius: 6, padding: '3px 6px', color: C.txt, fontSize: 13, fontFamily: 'inherit', textAlign: 'right' }} />
                      <button onClick={() => saveResAmount(r.id)} style={{ background: C.acc, border: 'none', borderRadius: 6, padding: '3px 7px', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                      <button onClick={() => setResEdit(null)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 6px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                    </span>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ color: '#f472b6', fontWeight: 600, fontSize: 13 }}>{fmtCurrency(r.amount_cents ?? 0)}</span>
                      {canEditCash && <button onClick={() => setResEdit({ id: r.id, val: ((r.amount_cents ?? 0) / 100).toFixed(2).replace('.', ',') })} title="Corrigir valor" style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, cursor: 'pointer' }}>✏️</button>}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </>
      )}

      {/* Modal: Fechar Caixa */}
      {showCashClose && (
        <>
          <div onClick={() => setShowCashClose(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2001, background: C.card, borderRadius: 20, padding: 24, width: 'min(92vw,500px)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: C.txt }}>🖨️ Fechamento de Caixa</div>
              <button onClick={() => setShowCashClose(false)} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ color: C.mut, fontSize: 12, marginBottom: 16 }}>
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </div>
            {[
              { label: '🚪 Portaria / Checkins', val: cash.door },
              { label: '🎫 Ingressos online', val: cash.tickets },
              { label: '🪑 Reservas recebidas', val: cash.reservations },
            ].map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: `1px solid ${C.brd}22`, fontSize: 13 }}>
                <span style={{ color: C.sub }}>{row.label}</span>
                <span style={{ color: C.txt, fontWeight: 700 }}>{fmtCurrency(row.val)}</span>
              </div>
            ))}
            {payStats.length > 0 && (
              <>
                <div style={{ color: C.mut, fontSize: 11, fontWeight: 700, marginTop: 14, marginBottom: 6, letterSpacing: '0.05em' }}>POR FORMA DE PAGAMENTO (PORTARIA)</div>
                {payStats.map((ps, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 12, borderBottom: `1px solid ${C.brd}11` }}>
                    <span style={{ color: C.mut }}>{payLabel(ps.k)}</span>
                    <span style={{ color: C.txt, fontWeight: 600 }}>{fmtCurrency(ps.v)}</span>
                  </div>
                ))}
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, paddingTop: 12, borderTop: `2px solid ${C.brd}` }}>
              <span style={{ color: C.txt, fontSize: 15, fontWeight: 700 }}>TOTAL CAIXA</span>
              <span style={{ color: C.gold, fontSize: 22, fontWeight: 900 }}>{fmtCurrency(cash.total)}</span>
            </div>
            {receivables.length > 0 && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: '#f59e0b11', border: '1px solid #f59e0b33' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠️ A receber (reservas em aberto)</span>
                  <span style={{ color: '#f59e0b', fontWeight: 900 }}>{fmtCurrency(receivables.reduce((s, r) => s + (r.amount_cents - r.deposit_cents), 0))}</span>
                </div>
              </div>
            )}
            <button onClick={() => window.print()} style={{ width: '100%', marginTop: 20, background: C.acc, border: 'none', borderRadius: 12, padding: '12px 0', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              🖨️ Imprimir / Salvar PDF
            </button>
          </div>
        </>
      )}
    </div>
  )
}
