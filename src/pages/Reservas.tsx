import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal, FAB } from '../components/ui'
import { ftel, fmtCurrency } from '../utils/format'
import { sT, type ToastState } from '../utils/toast'
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
  id?: string; name: string; quantity: number; unit_cost_cents: number
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

const RDEF = (date: string) => ({ name: '', phone: '', people_count: '', location: '', amount_cents: '', expected_arrival: '', event_id: '', reservation_type: '', flyer_url: '', invite_message: '', reservation_date: date, payment_status: 'free', deposit_cents: '', observations: '', list_type: 'normal', list_custom_value_cents: '', list_male_value_cents: '', list_female_value_cents: '' })
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

const SL: React.CSSProperties = {
  width: '100%', background: '#0a0e1a', border: `1px solid ${C.brd}`,
  borderRadius: 8, padding: '10px 12px', color: C.txt,
  fontSize: 14, minHeight: 44, fontFamily: 'inherit', boxSizing: 'border-box',
}

export function ReservasPage({ house, initialNav, onNavConsumed }: Props) {
  const [view, setView] = useState<'list' | 'settings' | 'spaces' | 'archive'>('list')
  const [archivedList, setArchivedList] = useState<Reservation[]>([])
  const [selDate, setSelDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  })
  const [resList, setResList] = useState<Reservation[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Reservation | null>(null)
  const [eventsForDate, setEventsForDate] = useState<Array<{ id: string; name: string }>>([])
  const [toast, setToast] = useState<ToastState | null>(null)
  const [form, setForm] = useState(() => RDEF(selDate))
  const [formItems, setFormItems] = useState<Array<{ name: string; quantity: string; unit_cost_cents: string; mode: 'unit' | 'total' }>>([])
  const [viewPeriod, setViewPeriod] = useState<'day' | 'week' | 'month'>('week')
  const [eventFilter, setEventFilter] = useState<{ id: string; name: string } | null>(null)
  const [periodCounts, setPeriodCounts] = useState<{ day: { res: number; people: number }; week: { res: number; people: number }; month: { res: number; people: number } }>({ day: { res: 0, people: 0 }, week: { res: 0, people: 0 }, month: { res: 0, people: 0 } })

  // ── Painel de convidados ──
  const [guestPanel, setGuestPanel] = useState<Reservation | null>(null)
  const [guestList, setGuestList] = useState<ReservationGuest[]>([])
  const [guestLoading, setGuestLoading] = useState(false)
  const [newGuest, setNewGuest] = useState({ name: '', phone: '', birth_date: '' })
  const [savingGuest, setSavingGuest] = useState(false)

  // ── Espaços da casa ──
  interface HouseSpace { id: string; name: string; capacity?: number; price_cents: number; active: boolean; sort_order: number }
  const [spaces, setSpaces] = useState<HouseSpace[]>([])
  const [spaceForm, setSpaceForm] = useState({ name: '', capacity: '', price_cents: '' })
  const [editingSpace, setEditingSpace] = useState<string | null>(null)
  const [occupiedSpaces, setOccupiedSpaces] = useState<Record<string, string>>({}) // spaceName → reservanteName
  const [spaceDropOpen, setSpaceDropOpen] = useState(false)
  const [spaceSearch, setSpaceSearch] = useState('')
  const spaceDropRef = useRef<HTMLDivElement>(null)
  const guestChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  function loadSpaces() {
    supabase.from('house_spaces').select('*').eq('house_id', house.id).eq('active', true).order('sort_order').order('name')
      .then(r => setSpaces((r.data ?? []) as HouseSpace[]))
  }

  function loadOccupied(date: string, excludeId?: string) {
    let q = supabase.from('reservations').select('location,name').eq('house_id', house.id).eq('reservation_date', date).not('location', 'is', null).neq('location', '')
    if (excludeId) q = q.neq('id', excludeId)
    q.then(r => {
      const map: Record<string, string> = {}
      ;(r.data ?? []).forEach(x => { if (x.location) map[x.location] = x.name })
      setOccupiedSpaces(map)
    })
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

  function loadRes(date?: string, period?: 'day' | 'week' | 'month', evFilter?: { id: string; name: string } | null) {
    const d = date ?? selDate
    const p = period ?? viewPeriod
    const ef = evFilter !== undefined ? evFilter : eventFilter
    let q = supabase.from('reservations').select('*,events(name,event_date),reservation_items(*)')
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
    } else {
      const dt = new Date(d + 'T12:00')
      const ms = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-01`
      const me = new Date(dt.getFullYear(), dt.getMonth()+1, 0).toISOString().split('T')[0]
      q = q.gte('reservation_date', ms).lte('reservation_date', me)
    }
    if (ef?.id) q = q.eq('event_id', ef.id)
    q.order('reservation_date').order('expected_arrival').then(r => setResList(r.data ?? []))
    supabase.from('events').select('id,name,event_date').eq('house_id', house.id).eq('event_date', d)
      .then(r => setEventsForDate(r.data ?? []))
  }

  function loadArchived() {
    supabase.from('reservations')
      .select('*,events(name,event_date),reservation_items(*)')
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
    const base = () => supabase.from('reservations').select('people_count').eq('house_id', house.id)
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
  useEffect(() => { loadPeriodCounts(selDate) }, [selDate, house.id])

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
    setFormItems(p => [...p, { name: '', quantity: '', unit_cost_cents: '', mode: 'total' }])
  }

  function removeFormItem(i: number) {
    setFormItems(p => p.filter((_, idx) => idx !== i))
  }

  function itemsTotal(items: Array<{ quantity: string; unit_cost_cents: string; mode?: 'unit' | 'total' }>) {
    return items.reduce((s, it) => {
      const val = Math.round((parseFloat(it.unit_cost_cents) || 0) * 100)
      const qty = parseFloat(it.quantity) || 0
      return s + (it.mode === 'total' ? val : qty * val)
    }, 0)
  }

  function resItemsTotal(items: ResItem[]) {
    return items.reduce((s, it) => s + (it.quantity || 0) * (it.unit_cost_cents || 0), 0)
  }

  async function saveRes() {
    if (!form.name.trim()) { sT(setToast, 'Nome do responsável obrigatório', 'error'); return }
    if ((form.phone || '').replace(/\D/g, '').length < 10) { sT(setToast, 'Celular obrigatório', 'error'); return }
    const isFree = form.payment_status === 'free'
    const baseCents = Math.round((parseFloat(String(form.amount_cents)) || 0) * 100)
    const optCents = itemsTotal(formItems)
    const totalCents = isFree ? 0 : baseCents + optCents
    const depositCents = form.payment_status === 'partial'
      ? Math.round((parseFloat(String(form.deposit_cents)) || 0) * 100)
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
      list_custom_value_cents: form.list_type === 'custom' ? Math.round((parseFloat(String(form.list_custom_value_cents)) || 0) * 100) : 0,
      list_male_value_cents: form.list_type === 'custom' ? Math.round((parseFloat(String(form.list_male_value_cents)) || 0) * 100) : 0,
      list_female_value_cents: form.list_type === 'custom' ? Math.round((parseFloat(String(form.list_female_value_cents)) || 0) * 100) : 0,
      status: editing?.status ?? 'pending',
      token: editing?.token ?? crypto.randomUUID(),
      max_guests: 10,
    }
    const q = editing ? supabase.from('reservations').update(d).eq('id', editing.id) : supabase.from('reservations').insert(d).select().single()
    const r = await q
    if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }

    // Salva itens
    const resId = editing?.id ?? (r as any).data?.id
    if (resId && formItems.length > 0) {
      if (editing) await supabase.from('reservation_items').delete().eq('reservation_id', resId)
      const validItems = formItems.filter(it => it.name.trim())
      if (validItems.length > 0) {
        await supabase.from('reservation_items').insert(validItems.map(it => {
          const qty = parseFloat(it.quantity) || 1
          const valCents = Math.round((parseFloat(it.unit_cost_cents) || 0) * 100)
          return {
            reservation_id: resId, house_id: house.id,
            name: it.name.trim(), quantity: qty,
            unit_cost_cents: it.mode === 'total' ? Math.round(valCents / qty) : valCents,
          }
        }))
      }
    } else if (editing && formItems.length === 0) {
      await supabase.from('reservation_items').delete().eq('reservation_id', editing.id)
    }

    sT(setToast, editing ? 'Reserva atualizada!' : 'Reserva criada!', 'success')
    setFormOpen(false); setEditing(null); setForm(RDEF(selDate)); setFormItems([]); loadRes(); loadPeriodCounts(selDate)
  }

  function deleteRes(id: string) {
    if (!confirm('Remover reserva?')) return
    supabase.from('reservations').delete().eq('id', id).then(() => { loadRes(); loadPeriodCounts(selDate) })
  }

  function unarchiveRes(id: string) {
    supabase.from('reservations').update({ archived_at: null }).eq('id', id)
      .then(() => loadArchived())
  }

  function deleteArchivedRes(id: string) {
    if (!confirm('Excluir permanentemente esta reserva?')) return
    supabase.from('reservations').delete().eq('id', id).then(() => loadArchived())
  }

  function markArrived(id: string) {
    supabase.from('reservations').update({ status: 'arrived', arrived_at: new Date().toISOString() }).eq('id', id).then(() => loadRes())
  }

  function editRes(r: Reservation) {
    setEditing(r)
    // amount_cents salvo = base + opcionais; ao editar, isolamos a base
    const itemsCents = (r.reservation_items ?? []).reduce((s, it) => s + (it.quantity || 0) * (it.unit_cost_cents || 0), 0)
    const baseCents = Math.max(0, (r.amount_cents ?? 0) - itemsCents)
    setForm({ name: r.name, phone: r.phone ?? '', people_count: r.people_count ? String(r.people_count) : '', location: r.location ?? '', amount_cents: baseCents ? String(baseCents / 100) : '', expected_arrival: r.expected_arrival ?? '', event_id: r.event_id ?? '', reservation_type: r.reservation_type ?? '', flyer_url: r.flyer_url ?? '', invite_message: r.invite_message ?? '', reservation_date: r.reservation_date ?? selDate, payment_status: r.payment_status ?? 'unpaid', deposit_cents: r.deposit_cents ? String(r.deposit_cents / 100) : '', observations: r.observations ?? '', list_type: r.list_type ?? 'normal', list_custom_value_cents: r.list_custom_value_cents ? String(r.list_custom_value_cents / 100) : '', list_male_value_cents: r.list_male_value_cents ? String(r.list_male_value_cents / 100) : '', list_female_value_cents: r.list_female_value_cents ? String(r.list_female_value_cents / 100) : '' })
    setFormItems((r.reservation_items ?? []).map(it => ({ name: it.name, quantity: String(it.quantity), unit_cost_cents: String((it.unit_cost_cents ?? 0) / 100), mode: 'unit' as const })))
    loadOccupied(r.reservation_date ?? selDate, r.id)
    supabase.from('events').select('id,name,event_date').eq('house_id', house.id).eq('event_date', r.reservation_date ?? selDate)
      .then(res => setEventsForDate(res.data ?? []))
    setFormOpen(true)
  }

  function openNew() {
    setEditing(null); setForm(RDEF(selDate)); setFormItems([])
    loadOccupied(selDate)
    pullEventsForDate(selDate)
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

  async function removeGuest(id: string) {
    if (!confirm('Remover convidado?')) return
    await supabase.from('reservation_guests').delete().eq('id', id)
    setGuestList(p => p.filter(g => g.id !== id))
  }

  async function sendListLink(r: Reservation) {
    const url = `https://nightpass-app.vercel.app/lista.html?t=${r.token}`
    const resType = resTypes.find(t => t.id === r.reservation_type)
    const typeLabel = resType ? `${resType.icon} ${resType.name}` : ''
    const dateStr = r.reservation_date
      ? new Date(r.reservation_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
      : ''
    const items = (r.reservation_items ?? []) as Array<{ name: string; quantity: number; unit_cost_cents: number }>
    const itemLines = items.length > 0
      ? '\n\n📦 *Itens inclusos:*\n' + items.map(i => `• ${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.name}`).join('\n')
      : ''

    const lines = [
      `Olá ${r.name}! 🎉`,
      typeLabel ? `Sua reserva de *${typeLabel}* está confirmada.` : 'Sua reserva está confirmada!',
      '',
      dateStr ? `📅 *${dateStr}*` : '',
      r.expected_arrival ? `🕐 Chegada prevista: *${r.expected_arrival.slice(0, 5)}*` : '',
      r.location ? `📍 Local: *${r.location}*` : '',
      r.people_count ? `👥 *${r.people_count} pessoas*` : '',
      itemLines,
      '',
      '👇 Acesse o link para cadastrar sua lista de convidados:',
      url,
      r.flyer_url ? `\n🖼️ Flyer do evento:\n${r.flyer_url}` : '',
    ].filter(l => l !== '').join('\n')

    const ph = (r.phone ?? '').replace(/\D/g, '')
    window.open(`https://wa.me/${ph ? '55' + ph : ''}?text=${encodeURIComponent(lines)}`, '_blank')

    // Marca que o link foi enviado (confirmação de envio)
    const ts = new Date().toISOString()
    const { error } = await supabase.from('reservations').update({ list_link_sent_at: ts }).eq('id', r.id)
    if (!error) {
      setResList(p => p.map(x => x.id === r.id ? { ...x, list_link_sent_at: ts } : x))
      setEditing(e => (e && e.id === r.id ? { ...e, list_link_sent_at: ts } : e))
      sT(setToast, '✅ Link marcado como enviado', 'success')
    }
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
      <Modal open={formOpen} title={editing ? 'Editar Reserva' : 'Nova Reserva'} onClose={() => { setFormOpen(false); setEditing(null); setForm(RDEF(selDate)); setFormItems([]) }} wide maxWidth={1100}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>

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
            <div style={{ color: '#a78bfa', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 12 }}>🎟️ TIPO DE LISTA</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

              {/* Botões de tipo — mesma altura/estilo dos botões de pagamento */}
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Acesso dos Convidados</label>
                <div style={{ display: 'flex', gap: 6, height: 56 }}>
                  {(['normal','vip','custom'] as const).map(lt => (
                    <button key={lt} type="button"
                      onClick={() => setForm(p => ({ ...p, list_type: lt, list_male_value_cents: lt !== 'custom' ? '' : p.list_male_value_cents, list_female_value_cents: lt !== 'custom' ? '' : p.list_female_value_cents }))}
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
                        <input type="number" step="0.01" min="0" autoFocus
                          style={{ ...SL, borderColor: '#60a5fa55' }}
                          value={form.list_male_value_cents}
                          onChange={e => setForm(p => ({ ...p, list_male_value_cents: e.target.value }))}
                          placeholder="Ex: 40,00" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: '#f472b6', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>👩 MULHER</div>
                        <input type="number" step="0.01" min="0"
                          style={{ ...SL, borderColor: '#f472b655' }}
                          value={form.list_female_value_cents}
                          onChange={e => setForm(p => ({ ...p, list_female_value_cents: e.target.value }))}
                          placeholder="Ex: 20,00" />
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
                            const isOcc = sp ? !!occupiedSpaces[sp.name] : false
                            return (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: isOcc ? '#ef4444' : C.txt, fontWeight: 600 }}>
                                  {isOcc ? '🔴' : '🟢'} {form.location}
                                </span>
                                {sp && sp.price_cents > 0 && (
                                  <span style={{ color: C.gold, fontSize: 12, fontWeight: 700 }}>· {fmtCurrency(sp.price_cents)}</span>
                                )}
                                {sp && sp.capacity && (
                                  <span style={{ color: C.mut, fontSize: 11 }}>· 👥 {sp.capacity}</span>
                                )}
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
                      background: '#0d1120', border: `1px solid ${C.acc}44`, borderRadius: 12,
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
                            const isOccupied = !!occupiedSpaces[sp.name]
                            const isSel = form.location === sp.name
                            return (
                              <button
                                key={sp.id}
                                type="button"
                                disabled={isOccupied}
                                onClick={() => {
                                  if (isOccupied) return
                                  setForm(p => ({
                                    ...p,
                                    location: sp.name,
                                    // auto-preenche valor se espaço tem preço e campo ainda está zerado
                                    amount_cents: sp.price_cents > 0 && (parseFloat(String(p.amount_cents)) || 0) === 0
                                      ? String(sp.price_cents / 100)
                                      : p.amount_cents,
                                  }))
                                  setSpaceDropOpen(false); setSpaceSearch('')
                                }}
                                style={{
                                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                                  padding: '10px 14px', background: isSel ? C.acc + '18' : isOccupied ? '#ef444408' : 'transparent',
                                  border: 'none', borderBottom: idx < arr.length - 1 ? `1px solid ${C.brd}` : 'none',
                                  color: isOccupied ? '#ef4444' : isSel ? C.acc : C.txt,
                                  fontSize: 13, cursor: isOccupied ? 'not-allowed' : 'pointer',
                                  fontFamily: 'inherit', textAlign: 'left', opacity: isOccupied ? 0.8 : 1,
                                }}
                              >
                                {/* Indicator dot */}
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: isOccupied ? '#ef4444' : '#10b981', flexShrink: 0, boxShadow: `0 0 6px ${isOccupied ? '#ef4444' : '#10b981'}` }} />
                                <span style={{ flex: 1, fontWeight: isSel ? 700 : 400 }}>{sp.name}</span>
                                <span style={{ fontSize: 11, color: isOccupied ? '#ef4444' : C.mut, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                                  {isOccupied
                                    ? <span>🔴 {occupiedSpaces[sp.name]}</span>
                                    : <>
                                        {sp.capacity && <span>👥 {sp.capacity}</span>}
                                        {sp.price_cents > 0 && <span style={{ color: C.gold, fontWeight: 700 }}>{fmtCurrency(sp.price_cents)}</span>}
                                        {!sp.capacity && sp.price_cents === 0 && <span>✅ Livre</span>}
                                      </>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0a0e1a', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: C.mut }}>
              {form.flyer_url
                ? <img src={form.flyer_url} alt="flyer" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
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
          <div style={{ order: 90, gridColumn: 'span 3', background: 'rgba(59,130,246,0.05)', border: `1px solid ${C.brd}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
              <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}>💳 PAGAMENTO (FINALIZAR)</div>
              {itemsTotal(formItems) > 0 && form.payment_status !== 'free' && (
                <div style={{ fontSize: 12, color: C.gold, fontWeight: 700 }}>
                  Total c/ opcionais: {fmtCurrency(Math.round((parseFloat(String(form.amount_cents)) || 0) * 100) + itemsTotal(formItems))}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor base da reserva (R$)</label>
                <input type="number" step="0.01" min="0" style={SL} value={form.amount_cents}
                  onChange={e => setForm(p => ({ ...p, amount_cents: e.target.value }))} placeholder="Ex: 500,00" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Status do Pagamento</label>
                <div style={{ display: 'flex', gap: 6, height: 44 }}>
                  {(['unpaid','partial','paid','free'] as const).map(ps => (
                    <button key={ps} type="button"
                      onClick={() => setForm(p => ({ ...p, payment_status: ps, amount_cents: ps === 'free' ? '0' : p.amount_cents, deposit_cents: ps === 'paid' ? p.amount_cents : (ps === 'unpaid' || ps === 'free') ? '' : p.deposit_cents }))}
                      style={{ flex: 1, borderRadius: 8, border: `2px solid ${form.payment_status === ps ? PAY_COLOR[ps] : PAY_COLOR[ps] + '33'}`, background: form.payment_status === ps ? PAY_COLOR[ps] + '22' : 'transparent', color: form.payment_status === ps ? PAY_COLOR[ps] : C.mut, fontSize: 11, fontWeight: form.payment_status === ps ? 800 : 500, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, transition: 'all .15s' }}>
                      <span style={{ fontSize: 14 }}>{PAY_ICON[ps]}</span>
                      <span>{PAY_LABEL[ps]}</span>
                    </button>
                  ))}
                </div>
              </div>
              {form.payment_status === 'partial' && (() => {
                const total = (parseFloat(String(form.amount_cents)) || 0) + itemsTotal(formItems) / 100
                const deposit = parseFloat(String(form.deposit_cents)) || 0
                const remaining = total - deposit
                return (
                  <>
                    <div>
                      <label style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, display: 'block', marginBottom: 4 }}>💰 Valor do Sinal (R$)</label>
                      <input type="number" step="0.01" min="0" max={String(form.amount_cents)}
                        style={{ ...SL, borderColor: '#f59e0b55' }} value={form.deposit_cents}
                        onChange={e => setForm(p => ({ ...p, deposit_cents: e.target.value }))} placeholder="Ex: 200,00" />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Saldo Restante</label>
                      <div style={{ ...SL, display: 'flex', alignItems: 'center', gap: 8, background: remaining > 0 ? '#ef444411' : '#10b98111', borderColor: remaining > 0 ? '#ef444433' : '#10b98133' }}>
                        <span style={{ fontSize: 16 }}>{remaining > 0 ? '💸' : '✅'}</span>
                        <span style={{ fontWeight: 800, fontSize: 15, color: remaining > 0 ? '#ef4444' : '#10b981' }}>{fmtCurrency(Math.round(remaining * 100))}</span>
                        {remaining <= 0 && <span style={{ fontSize: 11, color: '#10b981' }}>Quitado!</span>}
                      </div>
                    </div>
                  </>
                )
              })()}
              {form.payment_status === 'free' && (
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ background: '#a78bfa11', border: '1px solid #a78bfa33', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>🎁</span>
                    <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>Reserva gratuita · nada será cobrado</span>
                  </div>
                </div>
              )}
              {form.payment_status === 'paid' && (Math.round((parseFloat(String(form.amount_cents)) || 0) * 100) + itemsTotal(formItems)) > 0 && (
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ background: '#10b98111', border: '1px solid #10b98133', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>✅</span>
                    <span style={{ color: '#10b981', fontWeight: 700, fontSize: 14 }}>Pagamento confirmado · {fmtCurrency(Math.round((parseFloat(String(form.amount_cents)) || 0) * 100) + itemsTotal(formItems))}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 96px 78px 32px', gap: 6, marginBottom: 6 }}>
                    {['Item / Descrição', 'Qtd', 'Valor (R$)', 'Tipo', ''].map((h, i) => (
                      <div key={i} style={{ fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.05em', paddingLeft: 4 }}>{h}</div>
                    ))}
                  </div>
                  {formItems.map((it, i) => {
                    const lineTotal = it.mode === 'total'
                      ? Math.round((parseFloat(it.unit_cost_cents) || 0) * 100)
                      : (parseFloat(it.quantity) || 0) * Math.round((parseFloat(it.unit_cost_cents) || 0) * 100)
                    return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 56px 96px 78px 32px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input value={it.name} onChange={e => setFormItems(p => p.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                        placeholder="Ex: Comida p/ 30 pessoas" style={{ ...SL, minHeight: 38, padding: '8px 10px', fontSize: 13 }} />
                      <input type="number" min="0" step="1" value={it.quantity} onChange={e => setFormItems(p => p.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))}
                        placeholder="30" style={{ ...SL, minHeight: 38, padding: '8px 10px', fontSize: 13, textAlign: 'center' }} />
                      <input type="number" min="0" step="0.01" value={it.unit_cost_cents} onChange={e => setFormItems(p => p.map((x, idx) => idx === i ? { ...x, unit_cost_cents: e.target.value } : x))}
                        placeholder={it.mode === 'total' ? 'total' : 'unit.'} style={{ ...SL, minHeight: 38, padding: '8px 10px', fontSize: 13 }} />
                      <button type="button" onClick={() => setFormItems(p => p.map((x, idx) => idx === i ? { ...x, mode: x.mode === 'total' ? 'unit' : 'total' } : x))}
                        title={it.mode === 'total' ? 'Valor é o total do item' : 'Valor multiplicado pela quantidade'}
                        style={{ height: 38, borderRadius: 8, border: `1px solid ${it.mode === 'total' ? C.gold : C.acc}66`, background: (it.mode === 'total' ? C.gold : C.acc) + '22', color: it.mode === 'total' ? C.gold : C.acc, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {it.mode === 'total' ? 'Total' : '× un'}
                      </button>
                      <button onClick={() => removeFormItem(i)}
                        style={{ width: 32, height: 38, borderRadius: 8, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, fontSize: 14, cursor: 'pointer' }} title={`Subtotal: ${fmtCurrency(lineTotal)}`}>✕</button>
                    </div>
                    )
                  })}
                  {/* Totais */}
                  <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.mut, marginBottom: 4 }}>
                      <span>Valor base</span>
                      <span>{fmtCurrency(Math.round((parseFloat(String(form.amount_cents)) || 0) * 100))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.mut, marginBottom: 6 }}>
                      <span>Itens</span>
                      <span>{fmtCurrency(itemsTotal(formItems))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, color: C.gold, fontWeight: 800, borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
                      <span>Total</span>
                      <span>{fmtCurrency(Math.round((parseFloat(String(form.amount_cents)) || 0) * 100) + itemsTotal(formItems))}</span>
                    </div>
                  </div>
                </>
              )
            }
          </div>

          <div style={{ order: 100, gridColumn: 'span 3', display: 'flex', gap: 10 }}>
            <Btn onClick={saveRes} style={{ flex: 1 }}>💾 Salvar</Btn>
            {editing?.token && (
              <Btn onClick={() => sendListLink(editing)} variant="secondary"
                style={editing.list_link_sent_at ? { background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44` } : undefined}>
                {editing.list_link_sent_at ? '✅ Link enviado · Reenviar' : '📲 Enviar Link'}
              </Btn>
            )}
            <Btn onClick={() => { setFormOpen(false); setEditing(null); setFormItems([]) }} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      </Modal>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 900, color: C.txt, marginBottom: 4 }}>🪑 Reservas</h1>
            <p style={{ color: C.mut, fontSize: 14 }}>
              {view === 'list'
                ? `${resList.length} reserva${resList.length !== 1 ? 's' : ''} · ${viewPeriod === 'day' ? new Date(selDate + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : viewPeriod === 'week' ? 'esta semana' : new Date(selDate + 'T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`
                : view === 'archive'
                  ? `${archivedList.length} reserva${archivedList.length !== 1 ? 's' : ''} arquivada${archivedList.length !== 1 ? 's' : ''}`
                  : 'Tipos de celebração configuráveis'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button style={TAB(view === 'list')} onClick={() => setView('list')}>📋 Reservas</button>
            <button style={TAB(view === 'settings')} onClick={() => setView('settings')}>⚙️ Tipos</button>
            <button style={TAB(view === 'spaces')} onClick={() => setView('spaces')}>🗂️ Espaços</button>
            <button style={TAB(view === 'archive')} onClick={() => { setView('archive'); loadArchived() }}>📦 Arquivo</button>
            {view === 'list' && <Btn onClick={openNew} icon="➕">Nova Reserva</Btn>}
          </div>
        </div>

        {/* Period filters + date picker */}
        {view === 'list' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={selDate} onChange={e => setSelDate(e.target.value)}
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

      {/* ── LISTA ── */}
      {view === 'list' && (
        <Card style={{ padding: 0 }}>
          {resList.length === 0
            ? <div style={{ color: C.mut, textAlign: 'center', padding: 40 }}>Nenhuma reserva para este período</div>
            : resList.map((r, idx) => {
              const resType = resTypes.find(t => t.id === r.reservation_type)
              const items = (r.reservation_items ?? []) as ResItem[]
              const itemsSum = resItemsTotal(items)
              const total = (r.amount_cents ?? 0) + itemsSum
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
              return (
                <div key={r.id} style={{ display: 'flex', borderBottom: idx < resList.length - 1 ? `1px solid ${C.brd}` : 'none' }}>

                  {/* Barra lateral colorida por status */}
                  <div style={{ width: 4, flexShrink: 0, background: statusCol, borderRadius: idx === 0 ? '4px 0 0 0' : idx === resList.length - 1 ? '0 0 0 4px' : '0', opacity: 0.8 }} />

                  <div style={{ flex: 1, padding: '14px 18px 14px 16px', minWidth: 0 }}>

                    {/* ── Cabeçalho: ícone + nome + tipo + status ── */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      {/* Ícone / flyer thumb */}
                      {r.flyer_url
                        ? <div style={{ width: 48, height: 48, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
                            <img src={r.flyer_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }} />
                          </div>
                        : <div style={{ width: 48, height: 48, borderRadius: 10, background: resType ? resType.color + '18' : '#ffffff0a', border: `2px solid ${resType ? resType.color + '44' : C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                            {resType ? resType.icon : '🪑'}
                          </div>
                      }

                      {/* Nome + meta info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ color: C.txt, fontWeight: 900, fontSize: 18, lineHeight: 1 }}>{r.name}</span>
                          {resType && (
                            <span style={{ color: resType.color, fontSize: 12, fontWeight: 600, opacity: 0.9 }}>
                              {resType.icon} {resType.name}
                            </span>
                          )}
                          {r.events && (
                            <span style={{ color: C.mut, fontSize: 12 }}>
                              · 🎉 {(r.events as { name: string }).name}
                            </span>
                          )}
                        </div>

                        {/* Badges de status, pagamento e lista — compactos */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                          <span style={{ background: statusCol + '20', color: statusCol, border: `1px solid ${statusCol}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 800, letterSpacing: '0.03em' }}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                          <span style={{ background: payCol + '18', color: payCol, border: `1px solid ${payCol}33`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            {PAY_ICON[ps]} {PAY_LABEL[ps]}
                            {ps === 'partial' && remaining > 0 && <span style={{ opacity: 0.8 }}>· falta {fmtCurrency(remaining)}</span>}
                          </span>
                          <span style={{ background: listCol + '18', color: listCol, border: `1px solid ${listCol}33`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            {LIST_ICON[lt]} {LIST_LABEL[lt]}
                            {lt === 'custom' && (lm > 0 || lf > 0) && <span style={{ opacity: 0.85 }}>{lm > 0 && ` · 👨 ${fmtCurrency(lm)}`}{lf > 0 && ` · 👩 ${fmtCurrency(lf)}`}</span>}
                          </span>
                          {r.list_link_sent_at && (
                            <span style={{ color: C.grn, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <i className="bi bi-check2-circle" /> link enviado
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Valor total — destaque à direita */}
                      {total > 0 && (
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ color: C.gold, fontWeight: 900, fontSize: 18, lineHeight: 1 }}>{fmtCurrency(total)}</div>
                          {items.length > 0 && <div style={{ color: C.mut, fontSize: 10, marginTop: 2 }}>📦 {items.length} item{items.length > 1 ? 's' : ''}</div>}
                        </div>
                      )}
                    </div>

                    {/* ── Linha de detalhes: chips compactos ── */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: r.observations ? 8 : 10, paddingLeft: 60, alignItems: 'center' }}>
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
                      <div style={{ marginBottom: 10, marginLeft: 60, display: 'flex', alignItems: 'flex-start', gap: 6, background: '#ffffff07', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px' }}>
                        <i className="bi bi-chat-left-text" style={{ color: C.mut, fontSize: 13, flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: 12, color: C.sub, fontStyle: 'italic', lineHeight: 1.5 }}>{r.observations}</span>
                      </div>
                    )}

                    {/* ── Ações ── */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 60 }}>
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
                      <Btn onClick={() => deleteRes(r.id)} small variant="danger">
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 140px', gap: 10, marginBottom: 12 }}>
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

      {view === 'list' && <FAB onClick={openNew} icon="➕" title="Nova reserva" />}

      {/* ── Painel lateral de convidados ── */}
      {guestPanel && (
        <>
          {/* Overlay */}
          <div onClick={() => closeGuestPanel()}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }} />

          {/* Drawer */}
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
            background: '#0d1120', borderLeft: `1px solid ${C.brd}`,
            zIndex: 1001, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
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
                    👥 {guestPanel.people_count} esperados
                  </span>
                )}
              </div>
            </div>

            {/* Lista de convidados */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
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
            <div style={{ padding: '14px 16px', borderTop: `1px solid ${C.brd}`, flexShrink: 0, background: '#0a0e1a' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
                <button
                  onClick={addGuest}
                  disabled={savingGuest || !newGuest.name.trim()}
                  style={{
                    background: newGuest.name.trim() ? 'linear-gradient(135deg,#7c3aed,#a78bfa)' : C.brd,
                    color: '#fff', border: 'none', borderRadius: 10, padding: '10px', fontSize: 13,
                    fontWeight: 700, cursor: newGuest.name.trim() ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit', opacity: savingGuest ? 0.6 : 1,
                  }}>
                  {savingGuest ? 'Salvando...' : '➕ Adicionar à lista'}
                </button>
              </div>
              {guestPanel.token && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* Link de gestão (aniversariante) */}
                  <div style={{ padding: '7px 12px', background: '#7c3aed11', border: '1px solid #7c3aed33', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: '#a78bfa', fontSize: 11, fontWeight: 600 }}>📋 Gerenciar lista</span>
                    <button onClick={() => { navigator.clipboard.writeText(`https://nightpass-app.vercel.app/lista.html?t=${guestPanel.token}`); sT(setToast, 'Link de gestão copiado!', 'success') }}
                      style={{ background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 6, padding: '3px 10px', color: '#a78bfa', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Copiar
                    </button>
                  </div>
                  {/* Link de convite (convidados) */}
                  <div style={{ padding: '7px 12px', background: '#10b98111', border: '1px solid #10b98133', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: '#10b981', fontSize: 11, fontWeight: 600 }}>📲 Link de convite (convidados)</span>
                    <button onClick={() => { navigator.clipboard.writeText(`https://nightpass-app.vercel.app/convite.html?t=${guestPanel.token}`); sT(setToast, 'Link de convite copiado!', 'success') }}
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
                        <span style={{ fontSize: 11, color: statusCol, fontWeight: 700 }}>{STATUS_LABEL[r.status] ?? r.status}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Btn small onClick={() => unarchiveRes(r.id)}>
                        <i className="bi bi-arrow-counterclockwise" /> Reativar
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
