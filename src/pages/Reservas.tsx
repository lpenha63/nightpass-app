import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal } from '../components/ui'
import { ftel, fmtCurrency } from '../utils/format'
import { sT, type ToastState } from '../utils/toast'
import { sendWADirect } from '../utils/whatsapp'
import { parseGuestsXlsx } from '../utils/importGuests'
import type { House } from '../types'

interface Props {
  house: House
  user?: { id: string }
  role?: string
  initialNav?: { date: string; eventId?: string } | null
  onNavConsumed?: () => void
}

interface ResType {
  id: string; name: string; icon: string; color: string; active: boolean; sort_order: number
}

interface ResItem {
  id?: string; name: string; quantity: number; unit_cost_cents: number; unit_price_cents?: number
}

interface ReservationGuest {
  id: string; name: string; phone?: string; cpf?: string; birth_date?: string
  checked_in?: boolean; checked_in_at?: string; client_id?: string; confirmed?: boolean
}

interface Reservation {
  id: string; name: string; phone?: string; people_count?: number
  location?: string; amount_cents?: number; expected_arrival?: string
  reservation_date?: string; event_id?: string; status: string; token?: string
  reservation_type?: string; flyer_url?: string; invite_message?: string
  payment_status?: string; deposit_cents?: number; observations?: string
  list_link_sent_at?: string; archived_at?: string
  list_type?: string; list_custom_value_cents?: number; list_male_value_cents?: number; list_female_value_cents?: number
  events?: { name: string; event_date?: string }
  reservation_items?: ResItem[]
}

function parseMoneyInput(raw: string): number {
  // Máscara por dígitos (mesmo padrão já usado em Events.tsx e em apps bancários BR):
  // cada tecla reformata o campo em "R$ X,XX", e reinterpretar essa string formatada
  // como decimal (vírgula = separador) trava a digitação no 1º dígito — o dígito
  // seguinte cai nas casas decimais já fixas e o valor não muda mais.
  // Em vez disso, os dígitos digitados (em qualquer posição) formam o valor em
  // centavos direto, então a reformatação a cada tecla nunca atrapalha.
  const digits = raw.replace(/\D/g, '')
  return digits ? parseInt(digits, 10) : 0
}
function moneyVal(cents: number | string | undefined): string {
  const n = typeof cents === 'string' ? parseFloat(cents) : (cents ?? 0)
  if (!n || n === 0) return ''
  return 'R$ ' + (n / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

const RDEF = (date: string) => ({ name: '', phone: '', people_count: '', location: '', amount_cents: 0, expected_arrival: '', event_id: '', reservation_type: '', flyer_url: '', invite_message: '', reservation_date: date, payment_status: 'free', deposit_cents: 0, observations: '', list_type: 'normal', list_custom_value_cents: 0, list_male_value_cents: 0, list_female_value_cents: 0 })
const EMPTY_TYPE = { name: '', icon: '🎉', color: '#3b82f6', sort_order: '0' }
const ICON_OPTS = ['🎉','🎂','🍖','🏢','👶','💍','🎓','🎊','🥂','🍽️','🎭','🎪','🎡','🏆','🌟','🎵','🏖️','🏡','🌺','🎈']
const STATUS_COLOR: Record<string, string> = { pending: '#f59e0b', confirmed: '#10b981', arrived: '#3b82f6', cancelled: '#f87171' }
const STATUS_LABEL: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', arrived: 'Chegou', cancelled: 'Cancelado' }
const PAY_COLOR: Record<string, string> = { unpaid: '#f87171', partial: '#f59e0b', paid: '#10b981', free: '#a78bfa' }
const PAY_LABEL: Record<string, string> = { unpaid: 'A Pagar', partial: 'Sinal Pago', paid: 'Pago', free: 'Free' }
const PAY_ICON: Record<string, string>  = { unpaid: '💸', partial: '💰', paid: '✅', free: '🎁' }
const LIST_COLOR: Record<string, string> = { normal: '#94a3b8', vip: '#f59e0b', custom: '#a78bfa' }
const LIST_LABEL: Record<string, string> = { normal: 'Normal', vip: 'VIP', custom: 'Valor' }
const LIST_ICON:  Record<string, string> = { normal: '📋', vip: '⭐', custom: '💲' }
const LIST_DESC:  Record<string, string> = { normal: 'Paga entrada normal', vip: 'Entrada gratuita', custom: 'Valor combinado' }

export function ReservasPage({ house, initialNav, onNavConsumed }: Props) {
  const SL: React.CSSProperties = {
    width: '100%', background: C.bg, border: `1px solid ${C.brd}`,
    borderRadius: 8, padding: '10px 12px', color: C.txt,
    fontSize: 14, minHeight: 44, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const [view, setView] = useState<'list' | 'receivable' | 'settings' | 'spaces' | 'archive'>('list')
  const [archivedList, setArchivedList] = useState<Reservation[]>([])
  const [selDate, setSelDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  })
  const [resList, setResList] = useState<Reservation[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [viewOnly, setViewOnly] = useState(false)
  const [editing, setEditing] = useState<Reservation | null>(null)
  const [eventsForDate, setEventsForDate] = useState<Array<{ id: string; name: string }>>([])
  // Preços de espaço definidos no evento daquela data (sobrepõem o preço padrão do espaço)
  const [eventSpacePrices, setEventSpacePrices] = useState<Record<string, number>>({})
  const [toast, setToast] = useState<ToastState | null>(null)
  const [form, setForm] = useState(() => RDEF(selDate))
  const [formItems, setFormItems] = useState<Array<{ name: string; quantity: string; sale_cents: string; cost_cents: string; mode: 'unit' | 'total' }>>([])
  const [viewPeriod, setViewPeriod] = useState<'day' | 'week' | 'month' | 'all'>('week')
  const [eventFilter, setEventFilter] = useState<{ id: string; name: string } | null>(null)
  const [periodCounts, setPeriodCounts] = useState<{ day: { res: number; people: number }; week: { res: number; people: number }; month: { res: number; people: number } }>({ day: { res: 0, people: 0 }, week: { res: 0, people: 0 }, month: { res: 0, people: 0 } })

  // ── Painel de convidados ──
  const [guestPanel, setGuestPanel] = useState<Reservation | null>(null)
  const [guestList, setGuestList] = useState<ReservationGuest[]>([])
  const [guestLoading, setGuestLoading] = useState(false)
  const [newGuest, setNewGuest] = useState({ name: '', phone: '', birth_date: '' })
  const [importingRes, setImportingRes] = useState(false)
  const [savingGuest, setSavingGuest] = useState(false)

  // ── Espaços da casa ──
  interface HouseSpace { id: string; name: string; capacity?: number; price_cents: number; active: boolean; sort_order: number }
  const [spaces, setSpaces] = useState<HouseSpace[]>([])
  const [spaceForm, setSpaceForm] = useState({ name: '', capacity: '', price_cents: '' })
  const [editingSpace, setEditingSpace] = useState<string | null>(null)
  // spaceName → ocupação do dia (soma de pessoas, nº de reservas, nomes)
  const [occupiedSpaces, setOccupiedSpaces] = useState<Record<string, { people: number; count: number; names: string[] }>>({})
  const [spaceDropOpen, setSpaceDropOpen] = useState(false)
  const [spaceSearch, setSpaceSearch] = useState('')
  const spaceDropRef = useRef<HTMLDivElement>(null)
  const guestChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  function loadSpaces() {
    supabase.from('house_spaces').select('*').eq('house_id', house.id).eq('active', true).order('sort_order').order('name')
      .then(r => setSpaces((r.data ?? []) as HouseSpace[]))
  }

  function loadOccupied(date: string, excludeId?: string) {
    let q = supabase.from('reservations').select('location,name,people_count,status').eq('house_id', house.id).eq('reservation_date', date).not('location', 'is', null).neq('location', '')
    if (excludeId) q = q.neq('id', excludeId)
    q.then(r => {
      const map: Record<string, { people: number; count: number; names: string[] }> = {}
      ;(r.data ?? []).forEach((x: { location?: string; name?: string; people_count?: number; status?: string }) => {
        if (!x.location || x.status === 'cancelled') return
        const m = map[x.location] ?? { people: 0, count: 0, names: [] }
        m.people += (x.people_count ?? 0); m.count += 1; if (x.name) m.names.push(x.name)
        map[x.location] = m
      })
      setOccupiedSpaces(map)
    })
  }

  // Status de ocupação de um espaço no dia: com capacidade → várias reservas até encher; sem capacidade → 1 reserva
  function spaceStatus(sp: HouseSpace) {
    const occ = occupiedSpaces[sp.name]
    const usado = occ?.people ?? 0
    const cnt = occ?.count ?? 0
    const cap = sp.capacity ?? null
    const isFull = cap ? usado >= cap : cnt >= 1
    const restante = cap ? Math.max(0, cap - usado) : null
    return { usado, cnt, cap, isFull, restante, names: occ?.names ?? [] }
  }

  function saveSpace() {
    if (!spaceForm.name.trim()) return
    const data = {
      house_id: house.id, name: spaceForm.name.trim(),
      capacity: spaceForm.capacity ? parseInt(spaceForm.capacity) : null,
      price_cents: spaceForm.price_cents ? Math.round(parseFloat(spaceForm.price_cents) * 100) : 0,
      active: true, sort_order: spaces.length,
    }
    const q = editingSpace ? supabase.from('house_spaces').update(data).eq('id', editingSpace) : supabase.from('house_spaces').insert(data)
    q.then(r => {
      if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }
      setEditingSpace(null); setSpaceForm({ name: '', capacity: '', price_cents: '' }); loadSpaces()
    })
  }

  function deleteSpace(id: string) {
    if (!confirm('Remover espaço?')) return
    supabase.from('house_spaces').delete().eq('id', id).then(() => loadSpaces())
  }

  // ── Tipos de reserva ──
  const [resTypes, setResTypes] = useState<ResType[]>([])
  const [typeForm, setTypeForm] = useState<Record<string, string>>(EMPTY_TYPE)
  const [editingType, setEditingType] = useState<string | null>(null)

  function loadTypes() {
    supabase.from('reservation_types').select('*').eq('house_id', house.id).order('sort_order')
      .then(r => setResTypes((r.data ?? []) as ResType[]))
  }

  function saveType() {
    if (!typeForm.name.trim()) return
    const data = { house_id: house.id, name: typeForm.name.trim(), icon: typeForm.icon, color: typeForm.color, sort_order: parseInt(typeForm.sort_order) || 0, active: true }
    const q = editingType ? supabase.from('reservation_types').update(data).eq('id', editingType) : supabase.from('reservation_types').insert(data)
    q.then(r => {
      if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }
      setEditingType(null); setTypeForm(EMPTY_TYPE); loadTypes()
    })
  }

  function deleteType(id: string) {
    if (!confirm('Remover tipo?')) return
    supabase.from('reservation_types').delete().eq('id', id).then(() => loadTypes())
  }

  function loadRes(date?: string, period?: 'day' | 'week' | 'month' | 'all', evFilter?: { id: string; name: string } | null) {
    const d = date ?? selDate
    const p = period ?? viewPeriod
    const ef = evFilter !== undefined ? evFilter : eventFilter
    let q = supabase.from('reservations').select('*,events(name,event_date),reservation_items(*),reservation_guests(id,confirmed,checked_in)')
      .eq('house_id', house.id)
      .is('archived_at', null)
    if (p === 'day') {
      q = q.eq('reservation_date', d)
    } else if (p === 'week') {
      const dt = new Date(d + 'T12:00')
      const dow = dt.getDay()
      const mon = new Date(dt); mon.setDate(dt.getDate() - (dow === 0 ? 6 : dow - 1))
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
      const fmt = (x: Date) => x.toISOString().split('T')[0]
      q = q.gte('reservation_date', fmt(mon)).lte('reservation_date', fmt(sun))
    } else if (p === 'month') {
      const dt = new Date(d + 'T12:00')
      const ms = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-01`
      const me = new Date(dt.getFullYear(), dt.getMonth()+1, 0).toISOString().split('T')[0]
      q = q.gte('reservation_date', ms).lte('reservation_date', me)
    }
    // p === 'all': sem filtro de data
    if (ef?.id) q = q.eq('event_id', ef.id)
    q.order('reservation_date').order('expected_arrival').then(r => setResList(r.data ?? []))
    if (p !== 'all') {
      supabase.from('events').select('id,name,event_date').eq('house_id', house.id).eq('event_date', d)
        .then(r => setEventsForDate(r.data ?? []))
    }
  }

  // Arquiva automaticamente reservas com data anterior a hoje
  async function autoArchivePast() {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
    await supabase.from('reservations')
      .update({ archived_at: new Date().toISOString() })
      .eq('house_id', house.id)
      .lt('reservation_date', todayStr)
      .is('archived_at', null)
  }

  // Reservas com saldo em aberto (a receber) — independente da data, ativas (não arquivadas)
  function loadReceivables() {
    supabase.from('reservations')
      .select('*,events(name,event_date),reservation_items(*)')
      .eq('house_id', house.id)
      .is('archived_at', null)
      .in('payment_status', ['unpaid', 'partial'])
      .neq('status', 'cancelled')
      .order('reservation_date')
      .then(r => {
        const open = (r.data ?? []).filter((x: Reservation) => ((x.amount_cents ?? 0) - (x.deposit_cents ?? 0)) > 0)
        setResList(open)
      })
  }

  function loadArchived() {
    supabase.from('reservations')
      .select('*,events(name,event_date),reservation_items(*),reservation_guests(id,confirmed,checked_in)')
      .eq('house_id', house.id)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(100)
      .then(r => setArchivedList(r.data ?? []))
  }

  function loadPeriodCounts(date: string) {
    const d = date
    const dt = new Date(d + 'T12:00')
    // Week range
    const dow = dt.getDay()
    const mon = new Date(dt); mon.setDate(dt.getDate() - (dow === 0 ? 6 : dow - 1))
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    const fmt = (x: Date) => x.toISOString().split('T')[0]
    // Month range
    const ms = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-01`
    const me = new Date(dt.getFullYear(), dt.getMonth()+1, 0).toISOString().split('T')[0]

    const sum = (rows: { people_count: number | null }[]) => rows.reduce((acc, r) => acc + (r.people_count ?? 0), 0)
    const base = () => supabase.from('reservations').select('people_count').eq('house_id', house.id).is('archived_at', null).neq('status', 'cancelled')
    Promise.all([
      base().eq('reservation_date', d),
      base().gte('reservation_date', fmt(mon)).lte('reservation_date', fmt(sun)),
      base().gte('reservation_date', ms).lte('reservation_date', me),
    ]).then(([day, week, month]) => {
      const dr = day.data ?? [], wr = week.data ?? [], mr = month.data ?? []
      setPeriodCounts({
        day:   { res: dr.length, people: sum(dr) },
        week:  { res: wr.length, people: sum(wr) },
        month: { res: mr.length, people: sum(mr) },
      })
    })
  }

  // Pulls events for a date and auto-selects the first one (if any)
  function pullEventsForDate(date: string) {
    supabase.from('events').select('id,name,event_date').eq('house_id', house.id).eq('event_date', date)
      .then(r => {
        const evs = r.data ?? []
        setEventsForDate(evs)
        setForm(p => ({ ...p, event_id: evs.length >= 1 ? evs[0].id : '' }))
      })
  }

  function onFormDateChange(date: string) {
    setForm(p => ({ ...p, reservation_date: date, location: '' }))
    loadOccupied(date)
    pullEventsForDate(date)
  }

  useEffect(() => { loadTypes() }, [house.id])
  useEffect(() => { loadSpaces() }, [house.id])
  // Carrega os preços de espaço do(s) evento(s) da data da reserva (mescla se houver mais de um)
  useEffect(() => {
    const date = form.reservation_date as string
    if (!date || !formOpen) { setEventSpacePrices({}); return }
    supabase.from('events').select('space_prices').eq('house_id', house.id).eq('event_date', date)
      .then(r => {
        const merged: Record<string, number> = {}
        for (const ev of r.data ?? []) {
          const sp = (ev as { space_prices?: Record<string, number> | null }).space_prices
          if (sp) for (const [k, v] of Object.entries(sp)) merged[k] = v
        }
        setEventSpacePrices(merged)
      })
  }, [form.reservation_date, formOpen, house.id])
  useEffect(() => { loadPeriodCounts(selDate) }, [selDate, house.id])
  useEffect(() => { autoArchivePast().then(() => loadRes()) }, [house.id])

  // Close space dropdown on outside click
  useEffect(() => {
    if (!spaceDropOpen) return
    function handler(e: MouseEvent) {
      if (spaceDropRef.current && !spaceDropRef.current.contains(e.target as Node)) {
        setSpaceDropOpen(false); setSpaceSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [spaceDropOpen])
  useEffect(() => { if (view === 'list') loadRes(selDate, viewPeriod) }, [selDate, house.id, view, viewPeriod])

  // Navigate from Events page
  useEffect(() => {
    if (!initialNav) return
    setSelDate(initialNav.date)
    setViewPeriod('day')
    if (initialNav.eventId) {
      supabase.from('events').select('id,name').eq('id', initialNav.eventId).single()
        .then(r => {
          if (r.data) {
            setEventFilter({ id: r.data.id, name: r.data.name })
            loadRes(initialNav.date, 'day', { id: r.data.id, name: r.data.name })
          }
        })
    } else {
      setEventFilter(null)
      loadRes(initialNav.date, 'day', null)
    }
    onNavConsumed?.()
  }, [initialNav])

  async function uploadFlyer(file: File): Promise<string | null> {
    const ext = file.name.split('.').pop()
    const path = `reservas/${house.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('event-flyers').upload(path, file, { upsert: true })
    if (error) { sT(setToast, 'Erro no upload: ' + error.message, 'error'); return null }
    const { data } = supabase.storage.from('event-flyers').getPublicUrl(path)
    return data.publicUrl
  }

  function addFormItem() {
    setFormItems(p => [...p, { name: '', quantity: '', sale_cents: '', cost_cents: '', mode: 'total' }])
  }

  // Custo total dos opcionais (para o budget)
  function itemsCostTotal(items: Array<{ quantity: string; cost_cents: string; mode?: 'unit' | 'total' }>) {
    return items.reduce((s, it) => {
      const val = Math.round((parseFloat(it.cost_cents) || 0) * 100)
      const qty = parseFloat(it.quantity) || 0
      return s + (it.mode === 'total' ? val : qty * val)
    }, 0)
  }

  function removeFormItem(i: number) {
    setFormItems(p => p.filter((_, idx) => idx !== i))
  }

  // Valor de venda total dos opcionais (entra no valor da reserva)
  // Preço real do espaço: usa o valor definido no evento da data, se houver; senão o padrão do espaço
  function effectiveSpacePrice(sp: { id: string; price_cents: number }): number {
    return eventSpacePrices[sp.id] ?? sp.price_cents
  }

  function itemsTotal(items: Array<{ quantity: string; sale_cents: string; mode?: 'unit' | 'total' }>) {
    return items.reduce((s, it) => {
      const val = Math.round((parseFloat(it.sale_cents) || 0) * 100)
      const qty = parseFloat(it.quantity) || 0
      return s + (it.mode === 'total' ? val : qty * val)
    }, 0)
  }

  // Auto: ao incluir QUALQUER item que gere valor (base, opcionais ou valores de lista),
  // o status sai de "Free" e vai para "A pagar". Só em nova reserva, e só na borda de
  // subida (0 → valor) para não impedir o usuário de marcar Free deliberadamente depois.
  const valueGenerated =
    ((form.amount_cents as number) || 0) +
    itemsTotal(formItems) +
    (form.list_type === 'custom'
      ? ((form.list_custom_value_cents as number) || 0) +
        ((form.list_male_value_cents as number) || 0) +
        ((form.list_female_value_cents as number) || 0)
      : 0)
  const prevValueRef = useRef(0)
  useEffect(() => {
    if (!editing && !viewOnly && prevValueRef.current === 0 && valueGenerated > 0 && form.payment_status === 'free') {
      setForm(p => ({ ...p, payment_status: 'unpaid' }))
    }
    prevValueRef.current = valueGenerated
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueGenerated, editing, viewOnly])

  async function saveRes() {
    if (!form.name.trim()) { sT(setToast, 'Nome do responsável obrigatório', 'error'); return }
    if ((form.phone || '').replace(/\D/g, '').length < 10) { sT(setToast, 'Celular obrigatório', 'error'); return }
    const isFree = form.payment_status === 'free'
    const baseCents = (form.amount_cents as number) || 0
    const optCents = itemsTotal(formItems)
    const totalCents = isFree ? 0 : baseCents + optCents
    const depositCents = form.payment_status === 'partial'
      ? (form.deposit_cents as number) || 0
      : form.payment_status === 'paid' ? totalCents : 0
    const d = {
      house_id: house.id, name: form.name, phone: form.phone || null,
      people_count: parseInt(String(form.people_count)) || null,
      location: form.location || null,
      amount_cents: totalCents,
      expected_arrival: form.expected_arrival || '22:00',
      reservation_date: form.reservation_date || selDate, event_id: form.event_id || null,
      reservation_type: form.reservation_type || null,
      flyer_url: form.flyer_url || null,
      payment_status: form.payment_status || 'unpaid',
      deposit_cents: depositCents,
      observations: form.observations?.trim() || null,
      invite_message: (form as any).invite_message?.trim() || null,
      list_type: form.list_type || 'normal',
      list_custom_value_cents: form.list_type === 'custom' ? ((form.list_custom_value_cents as number) || 0) : 0,
      list_male_value_cents: form.list_type === 'custom' ? ((form.list_male_value_cents as number) || 0) : 0,
      list_female_value_cents: form.list_type === 'custom' ? ((form.list_female_value_cents as number) || 0) : 0,
      status: editing?.status ?? 'pending',
      token: editing?.token ?? crypto.randomUUID(),
      max_guests: 10,
    }
    // O .select() no update nao e cosmetico: sem ele o PostgREST devolve 0 linhas SEM
    // erro quando a RLS barra a gravacao, e a tela anunciava "Reserva atualizada!" sem
    // ter gravado nada. Com ele da para distinguir "falhou" de "nao tinha permissao".
    const q = editing
      ? supabase.from('reservations').update(d).eq('id', editing.id).select('id')
      : supabase.from('reservations').insert(d).select().single()
    const r = await q
    if (r.error) { sT(setToast, 'Erro ao salvar a reserva: ' + r.error.message, 'error'); return }
    if (editing && (!r.data || (r.data as unknown[]).length === 0)) {
      sT(setToast, 'A reserva nao foi gravada: sem permissao para alterar esta reserva.', 'error'); return
    }

    // Salva itens.
    // Estes retornos eram descartados: se a gravacao dos opcionais falhasse, a tela
    // dizia "Reserva atualizada!" e os itens sumiam sem ninguem ficar sabendo.
    const erroItem = (e: { message: string } | null, onde: string) => {
      if (!e) return false
      sT(setToast, `Erro ao salvar os opcionais (${onde}): ${e.message}`, 'error')
      return true
    }
    const resId = editing?.id ?? (r as any).data?.id
    if (resId && formItems.length > 0) {
      if (editing) {
        const del = await supabase.from('reservation_items').delete().eq('reservation_id', resId)
        if (erroItem(del.error, 'remover anteriores')) return
      }
      const validItems = formItems.filter(it => it.name.trim())
      if (validItems.length > 0) {
        const ins = await supabase.from('reservation_items').insert(validItems.map(it => {
          const qty = parseFloat(it.quantity) || 1
          const saleCents = Math.round((parseFloat(it.sale_cents) || 0) * 100)
          const costCents = Math.round((parseFloat(it.cost_cents) || 0) * 100)
          return {
            reservation_id: resId, house_id: house.id,
            name: it.name.trim(), quantity: qty,
            unit_price_cents: it.mode === 'total' ? Math.round(saleCents / qty) : saleCents,
            unit_cost_cents: it.mode === 'total' ? Math.round(costCents / qty) : costCents,
          }
        }))
        if (erroItem(ins.error, 'inserir')) return
      }
    } else if (editing && formItems.length === 0) {
      const del = await supabase.from('reservation_items').delete().eq('reservation_id', editing.id)
      if (erroItem(del.error, 'limpar')) return
    }

    sT(setToast, editing ? 'Reserva atualizada!' : 'Reserva criada!', 'success')
    setFormOpen(false); setEditing(null); setForm(RDEF(selDate)); setFormItems([]); loadRes(); loadPeriodCounts(selDate)
  }

  function deleteRes(id: string) {
    if (!confirm('Remover reserva?')) return
    supabase.from('reservations').delete().eq('id', id).then(() => { loadRes(); loadPeriodCounts(selDate) })
  }



  function deleteArchivedRes(id: string) {
    if (!confirm('Excluir permanentemente esta reserva?')) return
    supabase.from('reservations').delete().eq('id', id).then(() => loadArchived())
  }

  function markArrived(id: string) {
    supabase.from('reservations').update({ status: 'arrived', arrived_at: new Date().toISOString() }).eq('id', id).then(() => loadRes())
  }

  // Cancela a reserva: permanece na lista com a tarja "Cancelado" (não arquiva),
  // mas deixa de contar na ocupação/capacidade.
  function cancelRes(id: string) {
    if (!confirm('Cancelar esta reserva? Ela ficará marcada como "Cancelada" na lista.')) return
    supabase.from('reservations').update({ status: 'cancelled' }).eq('id', id)
      .then(() => { loadRes(); loadPeriodCounts(selDate); sT(setToast, 'Reserva cancelada.', 'success') })
  }

  function editRes(r: Reservation) {
    setEditing(r)
    // amount_cents salvo = base + venda dos opcionais; ao editar, isolamos a base
    const saleItemsCents = (r.reservation_items ?? []).reduce((s, it) => s + (it.quantity || 0) * (it.unit_price_cents ?? it.unit_cost_cents ?? 0), 0)
    const baseCents = Math.max(0, (r.amount_cents ?? 0) - saleItemsCents)
    setForm({ name: r.name, phone: r.phone ?? '', people_count: r.people_count ? String(r.people_count) : '', location: r.location ?? '', amount_cents: baseCents, expected_arrival: r.expected_arrival ?? '', event_id: r.event_id ?? '', reservation_type: r.reservation_type ?? '', flyer_url: r.flyer_url ?? '', invite_message: r.invite_message ?? '', reservation_date: r.reservation_date ?? selDate, payment_status: r.payment_status ?? 'unpaid', deposit_cents: r.deposit_cents ?? 0, observations: r.observations ?? '', list_type: r.list_type ?? 'normal', list_custom_value_cents: r.list_custom_value_cents ?? 0, list_male_value_cents: r.list_male_value_cents ?? 0, list_female_value_cents: r.list_female_value_cents ?? 0 })
    setFormItems((r.reservation_items ?? []).map(it => ({
      name: it.name, quantity: String(it.quantity),
      sale_cents: String((it.unit_price_cents ?? it.unit_cost_cents ?? 0) / 100),
      cost_cents: it.unit_price_cents != null ? String((it.unit_cost_cents ?? 0) / 100) : '',
      mode: 'unit' as const,
    })))
    loadOccupied(r.reservation_date ?? selDate, r.id)
    supabase.from('events').select('id,name,event_date').eq('house_id', house.id).eq('event_date', r.reservation_date ?? selDate)
      .then(res => setEventsForDate(res.data ?? []))
    setFormOpen(true)
  }

  function openNew() {
    setEditing(null); setForm(RDEF(selDate)); setFormItems([])
    loadOccupied(selDate)
    pullEventsForDate(selDate)
    setViewOnly(false)
    setFormOpen(true)
  }

  function consultRes(r: Reservation) {
    setEditing(r)
    const saleItemsCents = (r.reservation_items ?? []).reduce((s, it) => s + (it.quantity || 0) * (it.unit_price_cents ?? it.unit_cost_cents ?? 0), 0)
    const baseCents = Math.max(0, (r.amount_cents ?? 0) - saleItemsCents)
    setForm({ name: r.name, phone: r.phone ?? '', people_count: r.people_count ? String(r.people_count) : '', location: r.location ?? '', amount_cents: baseCents, expected_arrival: r.expected_arrival ?? '', event_id: r.event_id ?? '', reservation_type: r.reservation_type ?? '', flyer_url: r.flyer_url ?? '', invite_message: r.invite_message ?? '', reservation_date: r.reservation_date ?? selDate, payment_status: r.payment_status ?? 'unpaid', deposit_cents: r.deposit_cents ?? 0, observations: r.observations ?? '', list_type: r.list_type ?? 'normal', list_custom_value_cents: r.list_custom_value_cents ?? 0, list_male_value_cents: r.list_male_value_cents ?? 0, list_female_value_cents: r.list_female_value_cents ?? 0 })
    setFormItems((r.reservation_items ?? []).map(it => ({
      name: it.name, quantity: String(it.quantity),
      sale_cents: String((it.unit_price_cents ?? it.unit_cost_cents ?? 0) / 100),
      cost_cents: it.unit_price_cents != null ? String((it.unit_cost_cents ?? 0) / 100) : '',
      mode: 'unit' as const,
    })))
    supabase.from('events').select('id,name,event_date').eq('house_id', house.id).eq('event_date', r.reservation_date ?? selDate)
      .then(res => setEventsForDate(res.data ?? []))
    setViewOnly(true)
    setFormOpen(true)
  }

  async function openGuestPanel(r: Reservation) {
    setGuestPanel(r)
    setNewGuest({ name: '', phone: '', birth_date: '' })
    setGuestLoading(true)
    const { data } = await supabase.from('reservation_guests').select('*').eq('reservation_id', r.id).order('name')
    setGuestList((data ?? []) as ReservationGuest[])
    setGuestLoading(false)

    // Realtime: atualiza lista quando convidado se cadastra pelo link
    if (guestChannelRef.current) supabase.removeChannel(guestChannelRef.current)
    guestChannelRef.current = supabase.channel(`rg_${r.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservation_guests', filter: `reservation_id=eq.${r.id}` }, async () => {
        const { data: fresh } = await supabase.from('reservation_guests').select('*').eq('reservation_id', r.id).order('name')
        setGuestList((fresh ?? []) as ReservationGuest[])
      })
      .subscribe()
  }

  function closeGuestPanel() {
    if (guestChannelRef.current) { supabase.removeChannel(guestChannelRef.current); guestChannelRef.current = null }
    setGuestPanel(null)
  }

  async function addGuest() {
    if (!newGuest.name.trim() || !guestPanel) return
    setSavingGuest(true)
    const { data, error } = await supabase.from('reservation_guests').insert({
      reservation_id: guestPanel.id,
      house_id: house.id,
      name: newGuest.name.trim(),
      phone: newGuest.phone.replace(/\D/g, '') || null,
      birth_date: newGuest.birth_date || null,
      confirmed: true,
    }).select().single()
    setSavingGuest(false)
    if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); return }
    setGuestList(p => [...p, data as ReservationGuest])
    setNewGuest({ name: '', phone: '', birth_date: '' })
  }

  // Importa convidados de uma planilha (.xlsx/.xls/.csv) para a reserva aberta.
  // Sempre ignora duplicados (no arquivo e contra quem já está na reserva).
  async function importReservaXlsx(file: File) {
    if (!guestPanel) return
    setImportingRes(true)
    try {
      const parsed = await parseGuestsXlsx(file)
      if (!parsed.length) { sT(setToast, 'Nenhum convidado encontrado na planilha.', 'warn'); return }
      const dedupKey = (name: string, phone: string | null) => {
        const ph = (phone ?? '').replace(/\D/g, '')
        return ph.length >= 8 ? 'p:' + ph : 'n:' + (name ?? '').trim().toLowerCase()
      }
      const { data: ex } = await supabase.from('reservation_guests').select('name,phone').eq('reservation_id', guestPanel.id)
      const seen = new Set((ex ?? []).map((g: { name?: string; phone?: string }) => dedupKey(g.name ?? '', g.phone ?? null)))
      const uniq = parsed.filter(g => { const k = dedupKey(g.name, g.phone); if (seen.has(k)) return false; seen.add(k); return true })
      const rows = uniq.map(g => ({ reservation_id: guestPanel.id, house_id: house.id, name: g.name, phone: g.phone, birth_date: g.birth_date, confirmed: true }))
      for (let i = 0; i < rows.length; i += 200) await supabase.from('reservation_guests').insert(rows.slice(i, i + 200))
      const { data } = await supabase.from('reservation_guests').select('*').eq('reservation_id', guestPanel.id).order('name')
      setGuestList((data ?? []) as ReservationGuest[])
      const dup = parsed.length - uniq.length
      sT(setToast, `✅ ${uniq.length} importado(s)${dup ? ` · ${dup} duplicado(s) ignorado(s)` : ''}`, 'success')
    } catch (e) {
      sT(setToast, 'Erro ao importar: ' + ((e as Error)?.message ?? 'planilha inválida'), 'error')
    } finally {
      setImportingRes(false)
    }
  }

  async function removeGuest(id: string) {
    if (!confirm('Remover convidado?')) return
    await supabase.from('reservation_guests').delete().eq('id', id)
    setGuestList(p => p.filter(g => g.id !== id))
  }

  async function sendListLink(r: Reservation) {
    const url = `${window.location.origin}/lista.html?t=${r.token}`
    const resType = resTypes.find(t => t.id === r.reservation_type)
    const typeLabel = resType ? `${resType.icon} ${resType.name}` : ''
    const dateStr = r.reservation_date
      ? new Date(r.reservation_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
      : ''
    const items = (r.reservation_items ?? []) as Array<{ name: string; quantity: number; unit_cost_cents: number }>
    const itemLines = items.length > 0
      ? '\n\n📦 *Itens inclusos:*\n' + items.map(i => `• ${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.name}`).join('\n')
      : ''

    // Busca o evento do dia (pelo vínculo da reserva ou pela data) para incluir flyer, valores de lista e atrações
    type EvInfo = { name?: string; flyer_url?: string; attractions?: string; start_time?: string; artists?: Array<{ name?: string }>; price_male_list_cents?: number; price_female_list_cents?: number }
    let ev: EvInfo | null = null
    const evSelect = 'name,flyer_url,attractions,start_time,artists,price_male_list_cents,price_female_list_cents'
    if (r.event_id) {
      const { data } = await supabase.from('events').select(evSelect).eq('id', r.event_id).limit(1)
      ev = (data?.[0] as EvInfo) ?? null
    } else if (r.reservation_date) {
      const { data } = await supabase.from('events').select(evSelect).eq('house_id', house.id).eq('event_date', r.reservation_date).limit(1)
      ev = (data?.[0] as EvInfo) ?? null
    }

    // Linhas do evento: valor de entrada na lista + atrações
    const evLines: string[] = []
    if (ev) {
      if (r.list_type === 'vip') {
        evLines.push('🎫 Entrada na lista: *Gratuita (VIP)*')
      } else if (r.list_type === 'custom' && ((r.list_male_value_cents ?? 0) > 0 || (r.list_female_value_cents ?? 0) > 0)) {
        const parts: string[] = []
        if ((r.list_male_value_cents ?? 0) > 0) parts.push(`♂ ${fmtCurrency(r.list_male_value_cents ?? 0)}`)
        if ((r.list_female_value_cents ?? 0) > 0) parts.push(`♀ ${fmtCurrency(r.list_female_value_cents ?? 0)}`)
        evLines.push(`🎫 Entrada na lista: ${parts.join(' · ')}`)
      } else {
        const parts: string[] = []
        if ((ev.price_male_list_cents ?? 0) > 0) parts.push(`♂ ${fmtCurrency(ev.price_male_list_cents ?? 0)}`)
        if ((ev.price_female_list_cents ?? 0) > 0) parts.push(`♀ ${fmtCurrency(ev.price_female_list_cents ?? 0)}`)
        if (parts.length) evLines.push(`🎫 Entrada na lista: ${parts.join(' · ')}`)
      }
      const artistNames = (ev.artists ?? []).map(a => a?.name).filter((n): n is string => !!n && n.trim() !== '')
      const attractionParts = [...artistNames]
      if (ev.attractions && ev.attractions.trim()) attractionParts.push(ev.attractions.trim())
      if (attractionParts.length) evLines.push(`🎤 *Atrações:* ${attractionParts.join(' · ')}`)
    }

    // Resumo financeiro
    const total = r.amount_cents ?? 0
    const deposito = r.deposit_cents ?? 0
    const restante = total - deposito
    const payStatus = r.payment_status ?? 'free'
    const finLines: string[] = []
    if (payStatus !== 'free' && total > 0) {
      finLines.push(`\n💳 *Financeiro:*`)
      finLines.push(`• Total: *${fmtCurrency(total)}*`)
      if (payStatus === 'partial' && deposito > 0) {
        finLines.push(`• Sinal pago: *${fmtCurrency(deposito)}*`)
        finLines.push(`• Saldo a pagar: *${fmtCurrency(restante)}*`)
      } else if (payStatus === 'paid') {
        finLines.push(`• ✅ Pagamento: *Quitado*`)
      } else if (payStatus === 'unpaid') {
        finLines.push(`• ⚠️ A pagar na chegada: *${fmtCurrency(total)}*`)
      }
    }

    const lines = [
      `Olá ${r.name}! 🎉`,
      ev?.name ? `Sua reserva para *${ev.name}* está confirmada!` : (typeLabel ? `Sua reserva de *${typeLabel}* está confirmada.` : 'Sua reserva está confirmada!'),
      '',
      dateStr ? `📅 *${dateStr}*${ev?.start_time ? ` às ${ev.start_time.slice(0, 5)}` : ''}` : '',
      r.expected_arrival ? `🕐 Chegada prevista: *${r.expected_arrival.slice(0, 5)}*` : '',
      r.location ? `📍 Local: *${r.location}*` : '',
      r.people_count ? `👥 *${r.people_count} pessoas*` : '',
      evLines.length ? '\n' + evLines.join('\n') : '',
      itemLines,
      finLines.join('\n'),
      '',
      '👇 Acesse o link para cadastrar sua lista de convidados:',
      url,
    ].filter(l => l !== '').join('\n')

    if (!r.phone) { sT(setToast, 'Reserva sem telefone cadastrado', 'warn'); return }
    const imageUrl = ev?.flyer_url || r.flyer_url || house.logo_url || undefined
    const res = await sendWADirect(house.id, r.phone, lines, { type: 'reservation_list', mediaUrl: imageUrl })

    // Marca que o link foi enviado (confirmação de envio)
    const ts = new Date().toISOString()
    const { error } = await supabase.from('reservations').update({ list_link_sent_at: ts }).eq('id', r.id)
    if (!error) {
      setResList(p => p.map(x => x.id === r.id ? { ...x, list_link_sent_at: ts } : x))
      setEditing(e => (e && e.id === r.id ? { ...e, list_link_sent_at: ts } : e))
    }
    sT(setToast, res.viaApi ? '✅ Link enviado pela API' : '📲 Abrindo WhatsApp...', 'success')
  }

  const TAB = (active: boolean): React.CSSProperties => ({
    padding: '8px 18px', borderRadius: 10, border: `1px solid ${active ? C.acc : C.brd}`,
    background: active ? C.acc + '22' : 'transparent', color: active ? C.acc : C.mut,
    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  })

  return (
    <div style={{ paddingBottom: 80 }}>
      <Toast toast={toast} />

      {/* ── Formulário Reserva ── */}
      <Modal open={formOpen} title={viewOnly ? '🔍 Consultar Reserva' : editing ? 'Editar Reserva' : 'Nova Reserva'} onClose={() => { setFormOpen(false); setEditing(null); setViewOnly(false); setForm(RDEF(selDate)); setFormItems([]) }} wide maxWidth={1100}>
        <fieldset disabled={viewOnly} style={{ border: 'none', padding: 0, margin: 0, opacity: viewOnly ? 0.8 : 1 }}>
        <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>

          {/* ── Tipo de Celebração — full width ── */}
          <div style={{ gridColumn: 'span 3' }}>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>Tipo de Celebração</label>
            {resTypes.length === 0
              ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: `1px dashed ${C.brd}`, borderRadius: 10 }}>
                  <span style={{ color: C.mut, fontSize: 13 }}>Nenhum tipo cadastrado.</span>
                  <button onClick={() => { setFormOpen(false); setView('settings') }}
                    style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '4px 12px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ⚙️ Configurar tipos
                  </button>
                </div>
              )
              : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {resTypes.filter(t => t.active).map(t => (
                    <button key={t.id} onClick={() => setForm(p => ({ ...p, reservation_type: p.reservation_type === t.id ? '' : t.id }))}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: `2px solid ${form.reservation_type === t.id ? t.color : t.color + '44'}`, background: form.reservation_type === t.id ? t.color + '22' : 'transparent', color: form.reservation_type === t.id ? t.color : C.mut, fontSize: 13, fontWeight: form.reservation_type === t.id ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                      <span>{t.icon}</span> {t.name}
                    </button>
                  ))}
                </div>
              )
            }
          </div>

          {/* ── Tipo de Lista — mesmo modelo do Pagamento ── */}
          <div style={{ gridColumn: 'span 3', background: 'rgba(167,139,250,0.05)', border: `1px solid ${C.brd}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ color: '#a78bfa', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 12 }}>🎫 TIPO DE LISTA</div>
            <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

              {/* Botões de tipo — mesma altura/estilo dos botões de pagamento */}
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Acesso dos Convidados</label>
                <div style={{ display: 'flex', gap: 6, height: 56 }}>
                  {(['normal','vip','custom'] as const).map(lt => (
                    <button key={lt} type="button"
                      onClick={() => setForm(p => ({ ...p, list_type: lt, list_male_value_cents: lt !== 'custom' ? 0 : p.list_male_value_cents, list_female_value_cents: lt !== 'custom' ? 0 : p.list_female_value_cents }))}
                      style={{ flex: 1, borderRadius: 8, border: `2px solid ${form.list_type === lt ? LIST_COLOR[lt] : LIST_COLOR[lt] + '33'}`, background: form.list_type === lt ? LIST_COLOR[lt] + '22' : 'transparent', color: form.list_type === lt ? LIST_COLOR[lt] : C.mut, fontSize: 11, fontWeight: form.list_type === lt ? 800 : 500, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, transition: 'all .15s' }}>
                      <span style={{ fontSize: 15 }}>{LIST_ICON[lt]}</span>
                      <span>{LIST_LABEL[lt]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Descrição quando Normal ou VIP / Campos Homem+Mulher quando Valor */}
              {form.list_type !== 'custom'
                ? (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ background: LIST_COLOR[form.list_type] + '11', border: `1px solid ${LIST_COLOR[form.list_type]}33`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                      <span style={{ fontSize: 22 }}>{LIST_ICON[form.list_type]}</span>
                      <span style={{ color: LIST_COLOR[form.list_type], fontWeight: 700, fontSize: 13 }}>{LIST_DESC[form.list_type]}</span>
                    </div>
                  </div>
                )
                : (
                  <div>
                    <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor por Gênero (R$)</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>👨 HOMEM</div>
                        <input inputMode="decimal" autoFocus
                          style={{ ...SL, borderColor: '#60a5fa55' }}
                          value={moneyVal(form.list_male_value_cents as number)}
                          onChange={e => setForm(p => ({ ...p, list_male_value_cents: parseMoneyInput(e.target.value) }))}
                          placeholder="R$ 0,00" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: '#f472b6', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>👩 MULHER</div>
                        <input inputMode="decimal"
                          style={{ ...SL, borderColor: '#f472b655' }}
                          value={moneyVal(form.list_female_value_cents as number)}
                          onChange={e => setForm(p => ({ ...p, list_female_value_cents: parseMoneyInput(e.target.value) }))}
                          placeholder="R$ 0,00" />
                      </div>
                    </div>
                  </div>
                )
              }
            </div>
          </div>

          {/* ── Linha: Data | Nome | Celular ── */}
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Data do Evento *</label>
            <input type="date" style={SL} value={form.reservation_date} onChange={e => onFormDateChange(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nome do Responsável *</label>
            <input style={SL} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: João Silva" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Celular *</label>
            <input style={SL} value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="Ex: (11) 99999-9999" />
          </div>

          {/* ── Linha: Nº Pessoas | Horário | Local/Mesa ── */}
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nº Pessoas</label>
            <input type="number" min="1" style={SL} value={form.people_count} onChange={e => setForm(p => ({ ...p, people_count: e.target.value }))} placeholder="Ex: 10" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Horário chegada</label>
            <input type="time" style={SL} value={form.expected_arrival} onChange={e => setForm(p => ({ ...p, expected_arrival: e.target.value }))} />
          </div>

          {/* Local / Mesa — dropdown customizado */}
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Local / Mesa</label>
            {spaces.length === 0
              ? <input style={SL} value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Ex: Área VIP, Salão A" />
              : (
                <div ref={spaceDropRef} style={{ position: 'relative' }}>
                  {/* Trigger button */}
                  <button
                    type="button"
                    onClick={() => { setSpaceDropOpen(o => !o); setSpaceSearch('') }}
                    style={{ ...SL, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left', gap: 8 }}
                  >
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {form.location
                        ? (() => {
                            const sp = spaces.find(s => s.name === form.location)
                            const st = sp ? spaceStatus(sp) : null
                            const isFull = st?.isFull ?? false
                            return (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: isFull ? '#ef4444' : C.txt, fontWeight: 600 }}>
                                  {isFull ? '🔴' : '🟢'} {form.location}
                                </span>
                                {sp && sp.price_cents > 0 && (
                                  <span style={{ color: C.gold, fontSize: 12, fontWeight: 700 }}>· {fmtCurrency(sp.price_cents)}</span>
                                )}
                                {sp && sp.capacity
                                  ? <span style={{ color: isFull ? '#ef4444' : C.mut, fontSize: 11 }}>· 👥 {st!.usado}/{sp.capacity}</span>
                                  : null}
                              </span>
                            )
                          })()
                        : <span style={{ color: C.mut }}>📍 Selecionar local...</span>
                      }
                    </span>
                    <span style={{ color: C.mut, fontSize: 11, flexShrink: 0 }}>{spaceDropOpen ? '▲' : '▼'}</span>
                  </button>

                  {/* Dropdown panel */}
                  {spaceDropOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
                      background: C.card, border: `1px solid ${C.acc}44`, borderRadius: 12,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden',
                    }}>
                      {/* Search */}
                      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.brd}` }}>
                        <input
                          autoFocus
                          value={spaceSearch}
                          onChange={e => setSpaceSearch(e.target.value)}
                          placeholder="🔍 Buscar espaço..."
                          style={{ ...SL, minHeight: 34, padding: '6px 10px', fontSize: 13, borderColor: C.acc + '44' }}
                        />
                      </div>

                      {/* List */}
                      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                        {/* Option: clear */}
                        {form.location && (
                          <button
                            type="button"
                            onClick={() => { setForm(p => ({ ...p, location: '' })); setSpaceDropOpen(false); setSpaceSearch('') }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'transparent', border: 'none', borderBottom: `1px solid ${C.brd}`, color: C.mut, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                            <span>✕</span>
                            <span>Nenhum (limpar)</span>
                          </button>
                        )}

                        {spaces
                          .filter(sp => sp.name.toLowerCase().includes(spaceSearch.toLowerCase()))
                          .map((sp, idx, arr) => {
                            const st = spaceStatus(sp)
                            const isFull = st.isFull
                            const isSel = form.location === sp.name
                            return (
                              <button
                                key={sp.id}
                                type="button"
                                onClick={() => {
                                  // Não bloqueia mesmo cheio — só avisa visualmente
                                  setForm(p => {
                                    const eff = effectiveSpacePrice(sp)
                                    return {
                                      ...p,
                                      location: sp.name,
                                      // auto-preenche valor se espaço tem preço (do evento ou padrão) e campo ainda está zerado
                                      amount_cents: eff > 0 && ((p.amount_cents as number) || 0) === 0
                                        ? eff
                                        : p.amount_cents,
                                      payment_status: eff > 0 && ((p.amount_cents as number) || 0) === 0 && p.payment_status === 'free'
                                        ? 'unpaid' : p.payment_status,
                                    }
                                  })
                                  setSpaceDropOpen(false); setSpaceSearch('')
                                }}
                                style={{
                                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                                  padding: '10px 14px', background: isSel ? C.acc + '18' : isFull ? '#ef444408' : 'transparent',
                                  border: 'none', borderBottom: idx < arr.length - 1 ? `1px solid ${C.brd}` : 'none',
                                  color: isFull ? '#ef4444' : isSel ? C.acc : C.txt,
                                  fontSize: 13, cursor: 'pointer',
                                  fontFamily: 'inherit', textAlign: 'left',
                                }}
                              >
                                {/* Indicator dot */}
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: isFull ? '#ef4444' : st.cap && st.usado > 0 ? '#f59e0b' : '#10b981', flexShrink: 0, boxShadow: `0 0 6px ${isFull ? '#ef4444' : st.cap && st.usado > 0 ? '#f59e0b' : '#10b981'}` }} />
                                <span style={{ flex: 1, fontWeight: isSel ? 700 : 400 }}>{sp.name}</span>
                                <span style={{ fontSize: 11, color: isFull ? '#ef4444' : C.mut, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                                  {(() => {
                                    const eff = effectiveSpacePrice(sp)
                                    const isEvent = eventSpacePrices[sp.id] !== undefined && eventSpacePrices[sp.id] !== sp.price_cents
                                    return <>
                                      {st.cap
                                        ? <span style={{ fontWeight: 700 }}>👥 {st.usado}/{st.cap}{isFull ? ' · cheio' : ` · ${st.restante} vaga${st.restante !== 1 ? 's' : ''}`}</span>
                                        : (st.isFull ? <span>🔴 {st.names[0] ?? 'ocupado'}</span> : null)}
                                      {eff > 0 && <span style={{ color: C.gold, fontWeight: 700 }}>{fmtCurrency(eff)}{isEvent && <span title="Valor definido no evento" style={{ color: C.acc, fontSize: 9, marginLeft: 3 }}>★</span>}</span>}
                                      {!st.cap && !st.isFull && eff === 0 && <span>✅ Livre</span>}
                                    </>
                                  })()
                                  }
                                </span>
                                {isSel && <span style={{ color: C.acc, fontSize: 14, flexShrink: 0 }}>✓</span>}
                              </button>
                            )
                          })
                        }

                        {spaces.filter(sp => sp.name.toLowerCase().includes(spaceSearch.toLowerCase())).length === 0 && (
                          <div style={{ padding: '14px', color: C.mut, fontSize: 13, textAlign: 'center' }}>
                            Nenhum espaço encontrado
                          </div>
                        )}

                        {/* Free text option when search has content not matching any space */}
                        {spaceSearch.trim() && !spaces.some(s => s.name.toLowerCase() === spaceSearch.toLowerCase()) && (
                          <button
                            type="button"
                            onClick={() => { setForm(p => ({ ...p, location: spaceSearch.trim() })); setSpaceDropOpen(false); setSpaceSearch('') }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: C.acc + '11', border: 'none', borderTop: `1px solid ${C.brd}`, color: C.acc, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', fontWeight: 600 }}>
                            <span>✏️</span>
                            <span>Usar "{spaceSearch.trim()}" como local livre</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            }
          </div>

          {/* Valor do espaço selecionado — editável diretamente */}
          {form.location && (() => {
            const sp = spaces.find(s => s.name === form.location)
            return (
              <div style={{ gridColumn: 'span 1' }}>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  💰 Valor do Espaço {sp ? `(${sp.name})` : ''}
                </label>
                <input
                  inputMode="decimal"
                  style={SL}
                  value={moneyVal(form.amount_cents as number)}
                  onChange={e => {
                    const cents = parseMoneyInput(e.target.value)
                    setForm(p => ({
                      ...p,
                      amount_cents: cents,
                      payment_status: cents > 0 && p.payment_status === 'free' ? 'unpaid' : p.payment_status,
                    }))
                  }}
                  placeholder="R$ 0,00"
                />
                {sp && (() => {
                  const eff = effectiveSpacePrice(sp)
                  const isEvent = eventSpacePrices[sp.id] !== undefined && eventSpacePrices[sp.id] !== sp.price_cents
                  if (eff <= 0 || (form.amount_cents as number) === eff) return null
                  return (
                    <button type="button"
                      onClick={() => setForm(p => ({ ...p, amount_cents: eff, payment_status: p.payment_status === 'free' ? 'unpaid' : p.payment_status }))}
                      style={{ marginTop: 4, fontSize: 11, color: C.acc, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                      ↩ Restaurar {isEvent ? 'valor do evento' : 'padrão'} ({fmtCurrency(eff)})
                    </button>
                  )
                })()}
              </div>
            )
          })()}

          {/* ── Linha: Evento do dia | Flyer ── */}
          {eventsForDate.length > 0
            ? <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Evento do dia</label>
                <select style={SL} value={form.event_id} onChange={e => setForm(p => ({ ...p, event_id: e.target.value }))}>
                  <option value="">Sem evento vinculado</option>
                  {eventsForDate.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </div>
            : <div />
          }

          <div style={{ gridColumn: eventsForDate.length > 0 ? undefined : 'span 2' }}>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Flyer do Evento</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: C.mut }}>
              {form.flyer_url
                ? <img loading="lazy" decoding="async" src={form.flyer_url} alt="flyer" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                : <span>📁</span>
              }
              <span style={{ flex: 1 }}>{form.flyer_url ? 'Trocar imagem' : 'Selecionar imagem (JPG, PNG, WEBP)'}</span>
              {form.flyer_url && (
                <button onClick={e => { e.preventDefault(); setForm(p => ({ ...p, flyer_url: '' })) }}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 4, color: C.mut, cursor: 'pointer', fontSize: 11, padding: '2px 6px' }}>✕</button>
              )}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                const file = e.target.files?.[0]
                if (!file) return
                sT(setToast, 'Enviando imagem...', 'warn')
                const url = await uploadFlyer(file)
                if (url) { setForm(p => ({ ...p, flyer_url: url })); sT(setToast, 'Imagem enviada!', 'success') }
              }} />
            </label>
          </div>

          {/* ── Pagamento — última linha (finaliza o total) ── */}
          {(() => {
            const baseCentsForm = (form.amount_cents as number) || 0
            const optCentsForm  = itemsTotal(formItems)
            const grandTotal    = form.payment_status === 'free' ? 0 : baseCentsForm + optCentsForm
            const depositCents  = (form.deposit_cents as number) || 0
            const remaining     = grandTotal - depositCents
            return (
              <div style={{ order: 90, gridColumn: 'span 3', background: 'rgba(59,130,246,0.05)', border: `1px solid ${C.brd}`, borderRadius: 14, padding: '14px 16px' }}>
                <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 12 }}>💳 PAGAMENTO</div>

                {/* Breakdown: base + opcionais → total */}
                <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>Valor base</label>
                    <input
                      inputMode="decimal"
                      value={moneyVal(form.amount_cents as number)}
                      onChange={e => {
                        const cents = parseMoneyInput(e.target.value)
                        setForm(p => ({
                          ...p,
                          amount_cents: cents,
                          payment_status: cents > 0 && p.payment_status === 'free' ? 'unpaid' : p.payment_status,
                        }))
                      }}
                      placeholder="R$ 0,00"
                      style={{ background: 'transparent', border: 'none', color: C.txt, fontSize: 14, fontWeight: 700, textAlign: 'right', width: 140, outline: 'none', fontFamily: 'inherit' }}
                    />
                  </div>
                  {optCentsForm > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: C.mut }}>+ Opcionais</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.gold }}>{fmtCurrency(optCentsForm)}</span>
                    </div>
                  )}
                  {(optCentsForm > 0 || baseCentsForm > 0) && (
                    <div style={{ borderTop: `1px solid ${C.brd}`, marginTop: 6, paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: C.sub, fontWeight: 700 }}>TOTAL A PAGAR</span>
                      <span style={{ fontSize: 20, fontWeight: 900, color: form.payment_status === 'free' ? '#a78bfa' : C.grn }}>
                        {form.payment_status === 'free' ? 'Free' : fmtCurrency(grandTotal)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Status do pagamento */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>Como será liquidado</label>
                  <div style={{ display: 'flex', gap: 6, height: 44 }}>
                    {(['unpaid','partial','paid','free'] as const).map(ps => (
                      <button key={ps} type="button"
                        onClick={() => setForm(p => ({ ...p, payment_status: ps, amount_cents: ps === 'free' ? 0 : p.amount_cents, deposit_cents: (ps === 'unpaid' || ps === 'free') ? 0 : p.deposit_cents }))}
                        style={{ flex: 1, borderRadius: 8, border: `2px solid ${form.payment_status === ps ? PAY_COLOR[ps] : PAY_COLOR[ps] + '33'}`, background: form.payment_status === ps ? PAY_COLOR[ps] + '22' : 'transparent', color: form.payment_status === ps ? PAY_COLOR[ps] : C.mut, fontSize: 11, fontWeight: form.payment_status === ps ? 800 : 500, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, transition: 'all .15s' }}>
                        <span style={{ fontSize: 14 }}>{PAY_ICON[ps]}</span>
                        <span>{PAY_LABEL[ps]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sinal parcial */}
                {form.payment_status === 'partial' && (
                  <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, display: 'block', marginBottom: 4 }}>💰 Valor do Sinal</label>
                      <input inputMode="decimal"
                        style={{ ...SL, borderColor: '#f59e0b55' }} value={moneyVal(form.deposit_cents as number)}
                        onChange={e => setForm(p => ({ ...p, deposit_cents: parseMoneyInput(e.target.value) }))} placeholder="R$ 0,00" />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Saldo Restante no Caixa</label>
                      <div style={{ ...SL, display: 'flex', alignItems: 'center', gap: 8, background: remaining > 0 ? '#ef444411' : '#10b98111', borderColor: remaining > 0 ? '#ef444433' : '#10b98133' }}>
                        <span style={{ fontSize: 16 }}>{remaining > 0 ? '💸' : '✅'}</span>
                        <span style={{ fontWeight: 800, fontSize: 15, color: remaining > 0 ? '#ef4444' : '#10b981' }}>{fmtCurrency(remaining)}</span>
                        {remaining <= 0 && <span style={{ fontSize: 11, color: '#10b981' }}>Quitado!</span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Confirmações de status */}
                {form.payment_status === 'free' && (
                  <div style={{ background: '#a78bfa11', border: '1px solid #a78bfa33', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>🎁</span>
                    <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>Reserva gratuita · nada entra no caixa</span>
                  </div>
                )}
                {form.payment_status === 'paid' && grandTotal > 0 && (
                  <div style={{ background: '#10b98111', border: '1px solid #10b98133', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>✅</span>
                    <span style={{ color: '#10b981', fontWeight: 700, fontSize: 14 }}>
                      {fmtCurrency(grandTotal)} confirmados · valor entra no caixa
                    </span>
                  </div>
                )}
                {form.payment_status === 'unpaid' && grandTotal > 0 && (
                  <div style={{ background: '#ef444411', border: '1px solid #ef444433', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>💸</span>
                    <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 14 }}>
                      {fmtCurrency(grandTotal)} a receber · pendente no caixa
                    </span>
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── Observações — full width ── */}
          <div style={{ gridColumn: 'span 3' }}>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>📝 Observações</label>
            <textarea
              style={{ ...SL, minHeight: 80, resize: 'vertical', lineHeight: 1.5 }}
              value={form.observations}
              onChange={e => setForm(p => ({ ...p, observations: e.target.value }))}
              placeholder="Anotações especiais: decoração, preferências, restrições alimentares, pedidos específicos..."
            />
          </div>

          {/* ── Opcionais / Itens inclusos — full width ── */}
          <div style={{ gridColumn: 'span 3' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>OPCIONAIS / ITENS INCLUSOS</label>
              <button onClick={addFormItem}
                style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '4px 12px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                ➕ Adicionar item
              </button>
            </div>

            {formItems.length === 0
              ? <div style={{ color: C.mut, fontSize: 13, padding: '10px 0', textAlign: 'center', border: `1px dashed ${C.brd}`, borderRadius: 8 }}>
                  Nenhum item adicionado
                </div>
              : (
                <>
                  {/* Header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px 84px 84px 64px 30px', gap: 6, marginBottom: 6 }}>
                    {['Item / Descrição', 'Qtd', '💲 Valor', '🧾 Custo', 'Tipo', ''].map((h, i) => (
                      <div key={i} style={{ fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em', paddingLeft: 4 }}>{h}</div>
                    ))}
                  </div>
                  {formItems.map((it, i) => {
                    const f = it.mode === 'total' ? 1 : (parseFloat(it.quantity) || 0)
                    const lineSale = (it.mode === 'total' ? 1 : f) * Math.round((parseFloat(it.sale_cents) || 0) * 100)
                    const lineCost = (it.mode === 'total' ? 1 : f) * Math.round((parseFloat(it.cost_cents) || 0) * 100)
                    return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 48px 84px 84px 64px 30px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input value={it.name} onChange={e => setFormItems(p => p.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                        placeholder="Ex: Comida p/ 30 pessoas" style={{ ...SL, minHeight: 38, padding: '8px 10px', fontSize: 13 }} />
                      <input type="number" min="0" step="1" value={it.quantity} onChange={e => setFormItems(p => p.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))}
                        placeholder="30" style={{ ...SL, minHeight: 38, padding: '8px 6px', fontSize: 13, textAlign: 'center' }} />
                      <input type="number" min="0" step="0.01" value={it.sale_cents} onChange={e => setFormItems(p => p.map((x, idx) => idx === i ? { ...x, sale_cents: e.target.value } : x))}
                        title="Valor cobrado do cliente (entra na reserva)" placeholder="venda" style={{ ...SL, minHeight: 38, padding: '8px 8px', fontSize: 13, borderColor: C.gold + '55' }} />
                      <input type="number" min="0" step="0.01" value={it.cost_cents} onChange={e => setFormItems(p => p.map((x, idx) => idx === i ? { ...x, cost_cents: e.target.value } : x))}
                        title="Custo do item (entra no Budget como despesa)" placeholder="custo" style={{ ...SL, minHeight: 38, padding: '8px 8px', fontSize: 13, borderColor: '#f59e0b55' }} />
                      <button type="button" onClick={() => setFormItems(p => p.map((x, idx) => idx === i ? { ...x, mode: x.mode === 'total' ? 'unit' : 'total' } : x))}
                        title={it.mode === 'total' ? 'Valores são o total do item' : 'Valores multiplicados pela quantidade'}
                        style={{ height: 38, borderRadius: 8, border: `1px solid ${it.mode === 'total' ? C.gold : C.acc}66`, background: (it.mode === 'total' ? C.gold : C.acc) + '22', color: it.mode === 'total' ? C.gold : C.acc, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {it.mode === 'total' ? 'Total' : '× un'}
                      </button>
                      <button onClick={() => removeFormItem(i)}
                        style={{ width: 30, height: 38, borderRadius: 8, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, fontSize: 14, cursor: 'pointer' }} title={`Venda: ${fmtCurrency(lineSale)} · Custo: ${fmtCurrency(lineCost)}`}>✕</button>
                    </div>
                    )
                  })}
                  {/* Totais */}
                  <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.mut, marginBottom: 4 }}>
                      <span>Valor base</span>
                      <span>{fmtCurrency(Math.round((parseFloat(String(form.amount_cents)) || 0) * 100))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.mut, marginBottom: 4 }}>
                      <span>Opcionais (venda)</span>
                      <span>{fmtCurrency(itemsTotal(formItems))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#f59e0b', marginBottom: 6 }}>
                      <span>Custo opcionais (Budget)</span>
                      <span>{fmtCurrency(itemsCostTotal(formItems))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, color: C.gold, fontWeight: 800, borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
                      <span>Total da reserva</span>
                      <span>{fmtCurrency(Math.round((parseFloat(String(form.amount_cents)) || 0) * 100) + itemsTotal(formItems))}</span>
                    </div>
                  </div>
                </>
              )
            }
          </div>

          <div style={{ order: 100, gridColumn: 'span 3', display: 'flex', gap: 10 }}>
            {!viewOnly && <Btn onClick={saveRes} style={{ flex: 1 }}>💾 Salvar</Btn>}
            {!viewOnly && editing?.token && (
              <Btn onClick={() => sendListLink(editing)} variant="secondary"
                style={editing.list_link_sent_at ? { background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44` } : undefined}>
                {editing.list_link_sent_at ? '✅ Link enviado · Reenviar' : '📲 Enviar Link'}
              </Btn>
            )}
            <Btn onClick={() => { setFormOpen(false); setEditing(null); setViewOnly(false); setFormItems([]) }} variant="ghost">{viewOnly ? 'Fechar' : 'Cancelar'}</Btn>
          </div>
        </div>
        </fieldset>
      </Modal>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <div className="r-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 900, color: C.txt, marginBottom: 4 }}>🪑 Reservas</h1>
            <p style={{ color: C.mut, fontSize: 14 }}>
              {view === 'list'
                ? `${resList.length} reserva${resList.length !== 1 ? 's' : ''} · ${viewPeriod === 'day' ? new Date(selDate + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : viewPeriod === 'week' ? 'esta semana' : viewPeriod === 'month' ? new Date(selDate + 'T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : 'todas as reservas ativas'}`
                : view === 'archive'
                  ? `${archivedList.length} reserva${archivedList.length !== 1 ? 's' : ''} arquivada${archivedList.length !== 1 ? 's' : ''}`
                  : 'Tipos de celebração configuráveis'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={TAB(view === 'list')} onClick={() => setView('list')}>📋 Reservas</button>
            <button style={TAB(view === 'receivable')} onClick={() => { setView('receivable'); loadReceivables() }}>💰 A Receber</button>
            <button style={TAB(view === 'settings')} onClick={() => setView('settings')}>⚙️ Tipos</button>
            <button style={TAB(view === 'spaces')} onClick={() => setView('spaces')}>🗂️ Espaços</button>
            <button style={TAB(view === 'archive')} onClick={() => { setView('archive'); loadArchived() }}>📦 Arquivo</button>
            {view === 'list' && <Btn onClick={openNew} icon="➕">Nova Reserva</Btn>}
          </div>
        </div>

        {/* Period filters + date picker */}
        {view === 'list' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={selDate}
              onChange={e => {
                if (!e.target.value || !/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return
                setSelDate(e.target.value)
                // Escolher uma data específica deve mostrar só as reservas daquele dia
                if (viewPeriod !== 'day') { setEventFilter(null); setViewPeriod('day') }
              }}
              style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px', color: C.txt, fontSize: 14, minHeight: 40, fontFamily: 'inherit' }} />
            {(['day', 'week', 'month'] as const).map(p => {
              const { res, people } = periodCounts[p]
              const label = p === 'day' ? '📅 Dia' : p === 'week' ? '📆 Semana' : '🗓️ Mês'
              const isActive = viewPeriod === p && !eventFilter
              return (
                <button key={p} style={TAB(isActive)} onClick={() => { setEventFilter(null); setViewPeriod(p); loadRes(selDate, p, null) }}>
                  {label}
                  {res > 0 && (
                    <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ background: isActive ? C.acc : C.mut + '33', color: isActive ? '#fff' : C.mut, borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 800, lineHeight: 1.6 }}>
                        {res}
                      </span>
                      {people > 0 && (
                        <span style={{ background: isActive ? '#10b981' : '#10b98122', color: isActive ? '#fff' : '#10b981', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 800, lineHeight: 1.6 }}>
                          👥 {people}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              )
            })}
            <button style={TAB(viewPeriod === 'all' && !eventFilter)} onClick={() => { setEventFilter(null); setViewPeriod('all'); loadRes(selDate, 'all', null) }}>
              📋 Todas
              {viewPeriod === 'all' && resList.length > 0 && (
                <span style={{ marginLeft: 6, background: C.acc, color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 800, lineHeight: 1.6 }}>
                  {resList.length}
                </span>
              )}
            </button>
            {eventFilter && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.acc + '18', border: `1px solid ${C.acc}44`, borderRadius: 10, padding: '6px 12px' }}>
                <span style={{ color: C.acc, fontSize: 13, fontWeight: 600 }}>🎉 {eventFilter.name}</span>
                <button onClick={() => { setEventFilter(null); loadRes(selDate, viewPeriod, null) }}
                  style={{ background: 'none', border: 'none', color: C.mut, cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── A RECEBER: resumo do total em aberto ── */}
      {view === 'receivable' && (() => {
        const totalOpen = resList.reduce((s, r) => s + ((r.amount_cents ?? 0) - (r.deposit_cents ?? 0)), 0)
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#f59e0b14', border: '1px solid #f59e0b44', borderRadius: 12, padding: '12px 18px', marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ color: '#f59e0b', fontSize: 13, fontWeight: 700 }}>💰 {resList.length} reserva(s) com saldo em aberto</span>
            <span style={{ color: '#f59e0b', fontSize: 18, fontWeight: 900 }}>{fmtCurrency(totalOpen)} a receber</span>
          </div>
        )
      })()}

      {/* ── LISTA ── */}
      {(view === 'list' || view === 'receivable') && (
        <Card style={{ padding: 0 }}>
          {resList.length === 0
            ? <div style={{ color: C.mut, textAlign: 'center', padding: 40 }}>{view === 'receivable' ? 'Nenhuma reserva com saldo em aberto 🎉' : 'Nenhuma reserva para este período'}</div>
            : resList.map((r, idx) => {
              const resType = resTypes.find(t => t.id === r.reservation_type)
              const items = (r.reservation_items ?? []) as ResItem[]
              // amount_cents já inclui a venda dos opcionais (não somar de novo; unit_cost é custo/Budget)
              const total = r.amount_cents ?? 0
              const ph = (r.phone ?? '').replace(/\D/g, '')
              const waHref = ph ? `https://wa.me/55${ph}` : null
              const ps = r.payment_status ?? 'unpaid'
              const payCol = PAY_COLOR[ps] ?? C.mut
              const depositCents = r.deposit_cents ?? 0
              const amtCents = r.amount_cents ?? 0
              const remaining = amtCents - depositCents
              const lt = r.list_type ?? 'normal'
              const listCol = LIST_COLOR[lt] ?? C.mut
              const lm = r.list_male_value_cents ?? 0
              const lf = r.list_female_value_cents ?? 0
              const statusCol = STATUS_COLOR[r.status] ?? C.mut
              const guests = (r as { reservation_guests?: Array<{ confirmed?: boolean; checked_in?: boolean }> }).reservation_guests ?? []
              const confirmedByLink = guests.filter(g => g.confirmed).length
              const checkedInCount = guests.filter(g => g.checked_in).length
              return (
                <div key={r.id} style={{ display: 'flex', borderBottom: idx < resList.length - 1 ? `1px solid ${C.brd}` : 'none', opacity: r.status === 'cancelled' ? 0.6 : 1 }}>

                  {/* Barra lateral colorida por status */}
                  <div style={{ width: 4, flexShrink: 0, background: statusCol, borderRadius: idx === 0 ? '4px 0 0 0' : idx === resList.length - 1 ? '0 0 0 4px' : '0', opacity: 0.8 }} />

                  <div style={{ flex: 1, padding: '14px 18px 14px 16px', minWidth: 0 }}>

                    {/* ── Cabeçalho: avatar + nome + valor (alinhados ao topo) ── */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                      {/* Ícone / flyer thumb */}
                      {r.flyer_url
                        ? <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
                            <img loading="lazy" decoding="async" src={r.flyer_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }} />
                          </div>
                        : <div style={{ width: 44, height: 44, borderRadius: 10, background: resType ? resType.color + '18' : '#ffffff0a', border: `2px solid ${resType ? resType.color + '44' : C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                            {resType ? resType.icon : '🪑'}
                          </div>
                      }
                      {/* Nome + tipo/evento */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: C.txt, fontWeight: 800, fontSize: 17, lineHeight: 1.2 }}>{r.name}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 8px', marginTop: 2, fontSize: 12 }}>
                          {resType && <span style={{ color: resType.color, fontWeight: 600 }}>{resType.icon} {resType.name}</span>}
                          {r.events && <span style={{ color: C.mut }}>🎉 {(r.events as { name: string }).name}</span>}
                        </div>
                      </div>
                      {/* Valor total */}
                      {total > 0 && (
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ color: C.gold, fontWeight: 900, fontSize: 17, lineHeight: 1 }}>{fmtCurrency(total)}</div>
                          {items.length > 0 && <div style={{ color: C.mut, fontSize: 10, marginTop: 2 }}>📦 {items.length} item{items.length > 1 ? 's' : ''}</div>}
                        </div>
                      )}
                    </div>

                    {/* ── Badges (largura cheia, alinhados à esquerda) ── */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ background: statusCol + '20', color: statusCol, border: `1px solid ${statusCol}44`, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 800, letterSpacing: '0.03em' }}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                      <span style={{ background: payCol + '18', color: payCol, border: `1px solid ${payCol}33`, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {PAY_ICON[ps]} {PAY_LABEL[ps]}
                        {ps === 'partial' && remaining > 0 && <span style={{ opacity: 0.8 }}>· falta {fmtCurrency(remaining)}</span>}
                      </span>
                      <span style={{ background: listCol + '18', color: listCol, border: `1px solid ${listCol}33`, borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {LIST_ICON[lt]} {LIST_LABEL[lt]}
                        {lt === 'custom' && (lm > 0 || lf > 0) && <span style={{ opacity: 0.85 }}>{lm > 0 && ` · 👨 ${fmtCurrency(lm)}`}{lf > 0 && ` · 👩 ${fmtCurrency(lf)}`}</span>}
                      </span>
                      {r.list_link_sent_at && (
                        <span style={{ color: C.grn, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <i className="bi bi-check2-circle" /> link enviado
                        </span>
                      )}
                    </div>

                    {/* ── Linha de detalhes: chips compactos ── */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: r.observations ? 8 : 10, alignItems: 'center' }}>
                      {viewPeriod !== 'day' && (
                        <span style={{ color: C.mut, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="bi bi-calendar3" style={{ color: C.acc }} />
                          <strong style={{ color: C.txt }}>{new Date((r.reservation_date ?? selDate) + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</strong>
                        </span>
                      )}
                      {r.expected_arrival && (
                        <span style={{ color: C.mut, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="bi bi-clock-fill" style={{ color: C.acc }} />
                          <strong style={{ color: C.txt }}>{r.expected_arrival.slice(0, 5)}</strong>
                        </span>
                      )}
                      {r.people_count && (
                        <span style={{ color: C.mut, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="bi bi-people-fill" style={{ color: C.sub }} />
                          <strong style={{ color: C.txt }}>{r.people_count} pessoas</strong>
                        </span>
                      )}
                      {confirmedByLink > 0 && (
                        <span style={{ color: C.mut, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="bi bi-check2-circle" style={{ color: '#10b981' }} />
                          <strong style={{ color: '#10b981' }}>{confirmedByLink} confirmados pelo link</strong>
                        </span>
                      )}
                      {checkedInCount > 0 && (
                        <span style={{ color: C.mut, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="bi bi-door-open-fill" style={{ color: '#3b82f6' }} />
                          <strong style={{ color: '#3b82f6' }}>{checkedInCount} check-ins</strong>
                        </span>
                      )}
                      {r.location && (
                        <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="bi bi-geo-alt-fill" style={{ color: C.acc }} />
                          <strong style={{ color: C.acc }}>{r.location}</strong>
                        </span>
                      )}
                      {r.phone && (
                        <span style={{ color: C.mut, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <i className="bi bi-telephone-fill" style={{ color: C.mut }} />
                          <span>{ftel(r.phone)}</span>
                        </span>
                      )}
                    </div>

                    {/* ── Observações ── */}
                    {r.observations && (
                      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 6, background: '#ffffff07', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px' }}>
                        <i className="bi bi-chat-left-text" style={{ color: C.mut, fontSize: 13, flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: 12, color: C.sub, fontStyle: 'italic', lineHeight: 1.5 }}>{r.observations}</span>
                      </div>
                    )}

                    {/* ── Ações ── */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.status === 'pending' && (
                        <Btn onClick={() => markArrived(r.id)} small style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44` }}>
                          <i className="bi bi-check-circle-fill" /> Chegou
                        </Btn>
                      )}
                      {waHref && (
                        <Btn onClick={() => window.open(waHref, '_blank')} small style={{ background: '#25d36622', color: '#25d366', border: '1px solid #25d36644' }}>
                          <i className="bi bi-whatsapp" /> WhatsApp
                        </Btn>
                      )}
                      {r.token && r.phone && (
                        <Btn onClick={() => sendListLink(r)} small variant="secondary"
                          title={r.list_link_sent_at ? `Link enviado em ${new Date(r.list_link_sent_at).toLocaleString('pt-BR')}` : 'Enviar link da lista'}
                          style={r.list_link_sent_at ? { background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44` } : undefined}>
                          <i className={`bi bi-${r.list_link_sent_at ? 'send-check-fill' : 'send-fill'}`} /> {r.list_link_sent_at ? 'Link enviado' : 'Enviar Link'}
                        </Btn>
                      )}
                      <Btn onClick={() => openGuestPanel(r)} small style={{ background: '#7c3aed22', color: '#a78bfa', border: '1px solid #7c3aed44' }}>
                        <i className="bi bi-people-fill" /> Lista
                      </Btn>
                      <Btn onClick={() => editRes(r)} small variant="ghost">
                        <i className="bi bi-pencil-fill" /> Editar
                      </Btn>
                      {r.status !== 'cancelled' && (
                        <Btn onClick={() => cancelRes(r.id)} small style={{ background: '#f8717122', color: '#f87171', border: '1px solid #f8717144' }}>
                          <i className="bi bi-x-circle-fill" /> Cancelar
                        </Btn>
                      )}
                      <Btn onClick={() => deleteRes(r.id)} small variant="danger" title="Excluir permanentemente">
                        <i className="bi bi-trash3-fill" />
                      </Btn>
                    </div>

                  </div>
                </div>
              )
            })
          }
        </Card>
      )}

      {/* ── CONFIGURAÇÕES DE TIPOS ── */}
      {view === 'settings' && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 600 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>Tipos de Celebração Cadastrados</div>
            {resTypes.length === 0 && (
              <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Nenhum tipo cadastrado. Adicione abaixo.</div>
            )}
            {resTypes.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.brd}` }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: t.color + '22', border: `2px solid ${t.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{t.icon}</div>
                <span style={{ flex: 1, color: C.txt, fontWeight: 600, fontSize: 14 }}>{t.name}</span>
                <button onClick={() => { setEditingType(t.id); setTypeForm({ name: t.name, icon: t.icon, color: t.color, sort_order: String(t.sort_order) }) }}
                  style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '4px 10px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✏️</button>
                <button onClick={() => deleteType(t.id)}
                  style={{ background: 'none', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '4px 10px', color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>🗑</button>
              </div>
            ))}
          </Card>

          <Card>
            <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, marginBottom: 14, letterSpacing: '0.06em' }}>
              {editingType ? 'EDITAR TIPO' : 'ADICIONAR TIPO'}
            </div>
            {/* Icon picker */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>ÍCONE</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ICON_OPTS.map(ic => (
                  <button key={ic} onClick={() => setTypeForm(p => ({ ...p, icon: ic }))}
                    style={{ width: 38, height: 38, borderRadius: 8, border: `2px solid ${typeForm.icon === ic ? C.acc : C.brd}`, background: typeForm.icon === ic ? C.acc + '22' : 'transparent', fontSize: 18, cursor: 'pointer' }}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>NOME *</label>
                <input value={typeForm.name} onChange={e => setTypeForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Aniversário, Churrasco..."
                  style={{ ...SL, padding: '8px 12px', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>COR</label>
                <input type="color" value={typeForm.color} onChange={e => setTypeForm(p => ({ ...p, color: e.target.value }))}
                  style={{ width: 44, height: 44, borderRadius: 8, border: `1px solid ${C.brd}`, cursor: 'pointer', background: 'none' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveType}
                style={{ flex: 1, background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, color: '#fff', border: 'none', borderRadius: 10, padding: '10px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                💾 {editingType ? 'Atualizar' : 'Adicionar'}
              </button>
              {editingType && (
                <button onClick={() => { setEditingType(null); setTypeForm(EMPTY_TYPE) }}
                  style={{ background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 16px', color: C.mut, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancelar
                </button>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── ESPAÇOS ── */}
      {view === 'spaces' && (
        <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, marginBottom: 14 }}>Espaços / Mesas Disponíveis</div>
            {spaces.length === 0 && (
              <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Nenhum espaço cadastrado. Adicione abaixo.</div>
            )}
            {spaces.map(sp => (
              <div key={sp.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${C.brd}` }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: sp.price_cents > 0 ? C.gold + '18' : C.acc + '18', border: `1px solid ${sp.price_cents > 0 ? C.gold + '33' : C.acc + '33'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                  {sp.price_cents > 0 ? '💰' : '🗂️'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.txt, fontWeight: 600, fontSize: 14 }}>{sp.name}</div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                    {sp.capacity && <span style={{ color: C.mut, fontSize: 12 }}>👥 {sp.capacity} pessoas</span>}
                    {sp.price_cents > 0
                      ? <span style={{ color: C.gold, fontSize: 12, fontWeight: 700 }}>💰 {fmtCurrency(sp.price_cents)}</span>
                      : <span style={{ color: C.sub, fontSize: 12 }}>Sem cobrança</span>
                    }
                  </div>
                </div>
                <button onClick={() => { setEditingSpace(sp.id); setSpaceForm({ name: sp.name, capacity: sp.capacity ? String(sp.capacity) : '', price_cents: sp.price_cents > 0 ? String(sp.price_cents / 100) : '' }) }}
                  style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '4px 10px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✏️</button>
                <button onClick={() => deleteSpace(sp.id)}
                  style={{ background: 'none', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '4px 10px', color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>🗑</button>
              </div>
            ))}
          </Card>

          <Card>
            <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, marginBottom: 14, letterSpacing: '0.06em' }}>
              {editingSpace ? 'EDITAR ESPAÇO' : 'ADICIONAR ESPAÇO'}
            </div>
            <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 100px 140px', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>NOME DO ESPAÇO *</label>
                <input value={spaceForm.name} onChange={e => setSpaceForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Área VIP, Mesa 01, Camarote A..."
                  style={{ ...SL, padding: '8px 12px', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>CAPACIDADE</label>
                <input type="number" min="1" value={spaceForm.capacity} onChange={e => setSpaceForm(p => ({ ...p, capacity: e.target.value }))} placeholder="—"
                  style={{ ...SL, padding: '8px 12px', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.gold, fontWeight: 600, display: 'block', marginBottom: 4 }}>VALOR DA RESERVA (R$)</label>
                <input type="number" min="0" step="0.01" value={spaceForm.price_cents} onChange={e => setSpaceForm(p => ({ ...p, price_cents: e.target.value }))} placeholder="0,00 = grátis"
                  style={{ ...SL, padding: '8px 12px', fontSize: 13, borderColor: spaceForm.price_cents ? C.gold + '66' : C.brd }} />
              </div>
            </div>
            {/* Preview */}
            {spaceForm.price_cents && parseFloat(spaceForm.price_cents) > 0 && (
              <div style={{ background: C.gold + '11', border: `1px solid ${C.gold}33`, borderRadius: 10, padding: '8px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>💡</span>
                <span style={{ color: C.gold, fontSize: 13 }}>
                  Ao selecionar <strong>{spaceForm.name || 'este espaço'}</strong> numa reserva, o valor <strong>{fmtCurrency(Math.round(parseFloat(spaceForm.price_cents) * 100))}</strong> será sugerido automaticamente.
                </span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveSpace}
                style={{ flex: 1, background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, color: '#fff', border: 'none', borderRadius: 10, padding: '10px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                💾 {editingSpace ? 'Atualizar' : 'Adicionar'}
              </button>
              {editingSpace && (
                <button onClick={() => { setEditingSpace(null); setSpaceForm({ name: '', capacity: '', price_cents: '' }) }}
                  style={{ background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 16px', color: C.mut, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancelar
                </button>
              )}
            </div>
          </Card>
        </div>
      )}


      {/* ── Painel lateral de convidados ── */}
      {guestPanel && (
        <>
          {/* Overlay */}
          <div onClick={() => closeGuestPanel()}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }} />

          {/* Drawer */}
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(400px, 100vw)', maxWidth: '100vw',
            background: C.card, borderLeft: `1px solid ${C.brd}`,
            zIndex: 1001, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
            boxSizing: 'border-box',
          }}>
            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>👥</span>
                  <span style={{ color: C.txt, fontWeight: 800, fontSize: 16 }}>Lista de Convidados</span>
                </div>
                <button onClick={() => closeGuestPanel()}
                  style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, width: 32, height: 32, color: C.mut, fontSize: 16, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ fontSize: 13, color: C.acc, fontWeight: 700 }}>{guestPanel.name}</div>
              {guestPanel.reservation_date && (
                <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>
                  📅 {new Date(guestPanel.reservation_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                  {guestPanel.location && <span> · 📍 {guestPanel.location}</span>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                <span style={{ background: '#a78bfa22', color: '#a78bfa', border: '1px solid #a78bfa44', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                  {guestList.length} convidados
                </span>
                {guestList.some(g => g.checked_in) && (
                  <span style={{ background: '#10b98122', color: '#10b981', border: '1px solid #10b98144', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                    ✅ {guestList.filter(g => g.checked_in).length} entraram
                  </span>
                )}
                {guestPanel.people_count && (
                  <span style={{ background: C.card, color: C.mut, borderRadius: 20, padding: '2px 10px', fontSize: 12 }}>
                    👥 {guestPanel.people_count} convidados
                  </span>
                )}
              </div>
            </div>

            {/* Lista de convidados */}
            <div className="r-scroll-y" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px' }}>
              {guestLoading
                ? <div style={{ color: C.mut, textAlign: 'center', padding: 32 }}>Carregando...</div>
                : guestList.length === 0
                  ? (
                    <div style={{ color: C.mut, textAlign: 'center', padding: '32px 16px' }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                      <div style={{ fontSize: 14 }}>Nenhum convidado cadastrado ainda.</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>Adicione abaixo ou compartilhe o link da reserva.</div>
                    </div>
                  )
                  : [...guestList].sort((a, b) => {
                      if (a.checked_in !== b.checked_in) return (a.checked_in ? 1 : 0) - (b.checked_in ? 1 : 0)
                      if (a.confirmed !== b.confirmed) return (a.confirmed ? 0 : 1) - (b.confirmed ? 0 : 1)
                      return 0
                    }).map(g => {
                      const borderColor = g.checked_in ? '#3b82f633' : g.confirmed ? '#10b98133' : '#f59e0b33'
                      const bg = g.checked_in ? '#3b82f610' : g.confirmed ? '#10b98110' : '#f59e0b08'
                      return (
                      <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, marginBottom: 6, background: bg, border: `1px solid ${borderColor}` }}>
                        <div style={{ fontSize: 18, flexShrink: 0 }}>{g.checked_in ? '✅' : g.confirmed ? '✅' : '⏳'}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                            {g.checked_in ? <span style={{ color: '#3b82f6', fontSize: 11, fontWeight: 700 }}>Entrou</span>
                              : g.confirmed ? <span style={{ color: '#10b981', fontSize: 11, fontWeight: 700 }}>Confirmado</span>
                              : <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>Pendente</span>}
                            {g.phone && <span style={{ color: C.mut, fontSize: 11 }}>· 📱 {ftel(g.phone)}</span>}
                            {g.birth_date && <span style={{ color: C.mut, fontSize: 11 }}>· 🎂 {new Date(g.birth_date + 'T12:00').toLocaleDateString('pt-BR')}</span>}
                            {g.checked_in && g.checked_in_at && <span style={{ color: '#3b82f6', fontSize: 11 }}>· {new Date(g.checked_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
                          </div>
                        </div>
                        {!g.checked_in && (
                          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                            {!g.confirmed
                              ? <button onClick={() => supabase.from('reservation_guests').update({ confirmed: true }).eq('id', g.id).then(() => setGuestList(p => p.map(x => x.id === g.id ? { ...x, confirmed: true } : x)))}
                                  title="Confirmar" style={{ background: '#10b98122', border: '1px solid #10b98144', borderRadius: 8, padding: '4px 8px', color: '#10b981', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                              : <button onClick={() => supabase.from('reservation_guests').update({ confirmed: false }).eq('id', g.id).then(() => setGuestList(p => p.map(x => x.id === g.id ? { ...x, confirmed: false } : x)))}
                                  title="Remover confirmação" style={{ background: '#f59e0b22', border: '1px solid #f59e0b44', borderRadius: 8, padding: '4px 8px', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>↩</button>
                            }
                            <button onClick={() => removeGuest(g.id)} style={{ background: 'none', border: `1px solid ${C.red}44`, borderRadius: 8, width: 28, height: 28, color: C.red, fontSize: 12, cursor: 'pointer' }}>🗑</button>
                          </div>
                        )}
                      </div>
                    )})
              }
            </div>

            {/* Formulário para adicionar convidado */}
            <div style={{ padding: '14px 16px', borderTop: `1px solid ${C.brd}`, flexShrink: 0, background: C.bg }}>
              <div style={{ color: '#a78bfa', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>➕ ADICIONAR CONVIDADO</div>
              <div style={{ fontSize: 11, color: C.mut, marginBottom: 10 }}>
                💡 Fone + nascimento = check-in automático · sem eles, completa na portaria
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  style={{ ...SL, fontSize: 13 }}
                  placeholder="Nome completo *"
                  value={newGuest.name}
                  onChange={e => setNewGuest(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) addGuest() }}
                />
                <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    style={{ ...SL, fontSize: 13 }}
                    placeholder="Celular (opcional)"
                    value={newGuest.phone}
                    onChange={e => setNewGuest(p => ({ ...p, phone: e.target.value }))}
                  />
                  <div style={{ position: 'relative' }}>
                    <input
                      type="date"
                      style={{ ...SL, fontSize: 13, color: newGuest.birth_date ? C.txt : C.mut }}
                      value={newGuest.birth_date}
                      onChange={e => setNewGuest(p => ({ ...p, birth_date: e.target.value }))}
                    />
                    {!newGuest.birth_date && (
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: C.mut, pointerEvents: 'none' }}>
                        🎂 Nascimento
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={addGuest}
                    disabled={savingGuest || !newGuest.name.trim()}
                    style={{
                      flex: 1,
                      background: newGuest.name.trim() ? 'linear-gradient(135deg,#7c3aed,#a78bfa)' : C.brd,
                      color: '#fff', border: 'none', borderRadius: 10, padding: '10px', fontSize: 13,
                      fontWeight: 700, cursor: newGuest.name.trim() ? 'pointer' : 'not-allowed',
                      fontFamily: 'inherit', opacity: savingGuest ? 0.6 : 1,
                    }}>
                    {savingGuest ? 'Salvando...' : '➕ Adicionar à lista'}
                  </button>
                  <label title="Importar planilha .xlsx/.xls/.csv (colunas: nome, telefone, nascimento)"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#22c55e14', border: '1px solid #22c55e44', borderRadius: 10, padding: '0 14px', color: '#22c55e', fontSize: 13, fontWeight: 700, cursor: importingRes ? 'default' : 'pointer', fontFamily: 'inherit', opacity: importingRes ? 0.6 : 1 }}>
                    {importingRes ? '...' : '📥 XLS'}
                    <input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" disabled={importingRes} style={{ display: 'none' }}
                      onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) importReservaXlsx(f) }} />
                  </label>
                </div>
              </div>
              {guestPanel.token && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* Link de gestão (aniversariante) */}
                  <div style={{ padding: '7px 12px', background: '#7c3aed11', border: '1px solid #7c3aed33', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: '#a78bfa', fontSize: 11, fontWeight: 600 }}>📋 Gerenciar lista</span>
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/lista.html?t=${guestPanel.token}`); sT(setToast, 'Link de gestão copiado!', 'success') }}
                      style={{ background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 6, padding: '3px 10px', color: '#a78bfa', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Copiar
                    </button>
                  </div>
                  {/* Link de convite (convidados) */}
                  <div style={{ padding: '7px 12px', background: '#10b98111', border: '1px solid #10b98133', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: '#10b981', fontSize: 11, fontWeight: 600 }}>📲 Link de convite (convidados)</span>
                    <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/convite.html?t=${guestPanel.token}`); sT(setToast, 'Link de convite copiado!', 'success') }}
                      style={{ background: '#10b98122', border: '1px solid #10b98144', borderRadius: 6, padding: '3px 10px', color: '#10b981', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Copiar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── ARQUIVO DE RESERVAS ── */}
      {view === 'archive' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {archivedList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px', color: C.mut }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.txt, marginBottom: 6 }}>Nenhuma reserva arquivada</div>
              <div style={{ fontSize: 13 }}>Quando um evento é encerrado, suas reservas aparecem aqui.</div>
            </div>
          ) : (
            archivedList.map((r, i) => {
              const statusCol = STATUS_COLOR[r.status] ?? '#94a3b8'
              const total = r.amount_cents ? (r.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null
              const archivedDate = r.archived_at ? new Date(r.archived_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
              const aGuests = (r as { reservation_guests?: Array<{ checked_in?: boolean }> }).reservation_guests ?? []
              const aChecked = aGuests.filter(g => g.checked_in).length
              return (
                <div key={r.id} style={{ display: 'flex', borderBottom: i < archivedList.length - 1 ? `1px solid ${C.brd}` : 'none', opacity: 0.85 }}>
                  <div style={{ width: 4, flexShrink: 0, background: statusCol }} />
                  <div style={{ flex: 1, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: C.card, border: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                      {r.reservation_type ? (resTypes.find(t => t.name === r.reservation_type)?.icon ?? '🎉') : '🎉'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ color: C.txt, fontWeight: 800, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                        {total && <span style={{ color: C.acc, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{total}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '4px 12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {r.events?.name && <span style={{ fontSize: 11, color: C.mut }}><i className="bi bi-calendar-event-fill" /> {r.events.name}</span>}
                        {r.reservation_date && <span style={{ fontSize: 11, color: C.mut }}><i className="bi bi-calendar3" /> {new Date(r.reservation_date + 'T12:00').toLocaleDateString('pt-BR')}</span>}
                        {archivedDate && <span style={{ fontSize: 11, color: C.mut }}><i className="bi bi-archive-fill" /> Arquivado em {archivedDate}</span>}
                        <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 700 }}><i className="bi bi-door-open-fill" /> {aChecked} check-in{aChecked !== 1 ? 's' : ''}</span>
                        <span style={{ fontSize: 11, color: statusCol, fontWeight: 700 }}>{STATUS_LABEL[r.status] ?? r.status}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Btn small onClick={() => consultRes(r)}>
                        🔍 Consultar
                      </Btn>
                      <Btn small variant="danger" onClick={() => deleteArchivedRes(r.id)}>
                        <i className="bi bi-trash3-fill" />
                      </Btn>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </Card>
      )}
    </div>
  )
}
