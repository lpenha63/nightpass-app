import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, FAB } from '../components/ui'
import { cn, fcpf, ftel, fmtCurrency, loyalTier } from '../utils/format'
import { sT, type ToastState } from '../utils/toast'
import { sendWA } from '../utils/whatsapp'
import { QRScanner } from '../components/QRScanner'
import type { House, Client, Ticket } from '../types'

interface Props {
  house: House
  user: { id: string; email: string }
  role: string
}

interface RecentCI {
  id: string
  created_at: string
  amount_cents: number
  payment_method: string
  comanda?: string
  clients?: { full_name: string }
  events?: { name: string }
}

interface ReservationGuest {
  id: string
  name: string
  phone?: string
  cpf?: string
  birth_date?: string
  gender?: string
  checked_in: boolean
  checked_in_at?: string
  comanda?: string
  confirmed?: boolean
}

interface Reservation {
  id: string
  name: string
  phone?: string
  people_count: number
  location?: string
  expected_arrival?: string
  status: string
  arrived_at?: string
  amount_cents: number
  token?: string
  list_type?: string
  list_male_value_cents?: number
  list_female_value_cents?: number
  list_custom_value_cents?: number
  reservation_guests?: ReservationGuest[]
}

interface PromoterGuest {
  id: string
  full_name: string
  phone?: string
  cpf?: string
  gender?: string
  list_type?: string
  checked_in: boolean
  checked_in_at?: string
  promoter_confirmed: boolean
  list_id?: string
  promoter_lists?: { id: string; name: string; token?: string; promoters?: { full_name: string } }
  comanda?: string
}

const PAY_METHODS = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'PIX' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'credito', label: 'Crédito' },
  { value: 'debito', label: 'Débito' },
  { value: 'cortesia', label: 'Cortesia' },
]

interface ScannedTicket extends Ticket {
  ticket_orders?: { buyer_name: string; quantity: number; amount_cents: number }
  events?: { name: string; event_date: string }
}

interface CheckinType {
  id: string
  name: string
  description?: string
  default_price_cents: number
  color: string
  icon: string
  active: boolean
  sort_order: number
}

const EMPTY_TYPE = { name: '', description: '', default_price_cents: '', color: '#3b82f6', icon: '🎟️', sort_order: '0' }
const ICON_OPTS = ['🎟️','🎭','👑','🏅','⭐','🏆','🎯','🎮','🍽️','☀️','🏊','🎾','⚽','🏀','🏐','🎳','🎰','💼','🎪','🎡']

type Mode = 'checkin' | 'listas' | 'scanner'

const TAB_BTN = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 10,
  border: `1px solid ${active ? C.acc : C.brd}`,
  background: active ? C.acc + '22' : 'transparent',
  color: active ? C.acc : C.mut,
  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
})

const SL: React.CSSProperties = {
  width: '100%', background: C.bg, border: `1px solid ${C.brd}`,
  borderRadius: 10, padding: '10px 14px', color: C.txt,
  fontSize: 14, minHeight: 44, fontFamily: 'inherit',
}

export function CheckinPage({ house, user }: Props) {
  const [mode, setMode] = useState<Mode>('checkin')

  // ── portaria ──
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<ScannedTicket | null>(null)
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<Client | null>(null)
  const [ciCount, setCiCount] = useState(0)
  const [events, setEvents] = useState<Array<{ id: string; name: string; event_date: string; price_male_cents?: number; price_female_cents?: number }>>([])
  const [selEv, setSelEv] = useState('bar')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [nc, setNc] = useState({ full_name: '', cpf: '', phone: '', birth_date: '', gender: '' })
  const [recent, setRecent] = useState<RecentCI[]>([])
  const [payMethod, setPayMethod] = useState('dinheiro')
  const [payAmt, setPayAmt] = useState('')
  const [comanda, setComanda] = useState('')

  // ── tipos de check-in ──
  const [ciTypes, setCiTypes] = useState<CheckinType[]>([])
  const [selTypeId, setSelTypeId] = useState<string | null>(null)
  const [typesModal, setTypesModal] = useState(false)
  const [typeForm, setTypeForm] = useState<Record<string, string>>(EMPTY_TYPE)
  const [editingType, setEditingType] = useState<string | null>(null)

  // ── listas ──
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [promoGuests, setPromoGuests] = useState<PromoterGuest[]>([])
  const [listSearch, setListSearch] = useState('')
  const [loadingLists, setLoadingLists] = useState(false)
  const [ciResId, setCiResId] = useState<string>('')

  // ── completar cadastro modal ──
  const [completeGuest, setCompleteGuest] = useState<ReservationGuest | null>(null)
  const [completeForm, setCompleteForm] = useState({ phone: '', cpf: '', birth_date: '', photoDataUrl: '', comanda: '', amount: '' })
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ── accordion state ──
  const [portariaAccordion, setPortariaAccordion] = useState<{ reservas: boolean; promoters: boolean }>({ reservas: true, promoters: true })
  const [listasAccordion, setListasAccordion] = useState<{ reservas: boolean; promoters: boolean }>({ reservas: true, promoters: true })

  // ── comanda confirm ──
  const [pendingCI, setPendingCI] = useState<{ type: 'reserva' | 'promo'; guest: ReservationGuest | PromoterGuest; reservation?: Reservation } | null>(null)
  const [listComanda, setListComanda] = useState('')
  const [listAmount, setListAmount] = useState('')

  useEffect(() => {
    if (!house) return
    // Usa data local (Brasil) — evita erro de timezone UTC vs UTC-3
    // Se antes das 8h, considera ontem como data operacional (eventos que viraram a madrugada)
    const now = new Date()
    const opDate = now.getHours() < 8 ? new Date(now.getTime() - 86400000) : now
    const today = `${opDate.getFullYear()}-${String(opDate.getMonth()+1).padStart(2,'0')}-${String(opDate.getDate()).padStart(2,'0')}`

    // Apenas o(s) evento(s) do dia operacional — não é possível fazer check-in em data anterior/posterior
    supabase.from('events').select('*').eq('house_id', house.id).neq('status', 'cancelado').eq('event_date', today).order('start_time')
      .then(r => {
        const evs = r.data ?? []
        setEvents(evs)
        setSelEv(evs.length > 0 ? evs[0].id : 'bar')
      })

    // Carrega tipos de check-in da casa
    supabase.from('checkin_types').select('*').eq('house_id', house.id).eq('active', true).order('sort_order')
      .then(r => setCiTypes((r.data ?? []) as CheckinType[]))

    loadRecent()

    const ch = supabase.channel(`ci-${house.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'checkins', filter: `house_id=eq.${house.id}` }, () => loadRecent())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [house.id])

  useEffect(() => {
    loadLists()
  }, [selEv])

  function loadTypes() {
    supabase.from('checkin_types').select('*').eq('house_id', house.id).order('sort_order')
      .then(r => setCiTypes((r.data ?? []) as CheckinType[]))
  }

  function selectType(t: CheckinType) {
    setSelTypeId(t.id)
    if (t.default_price_cents > 0) setPayAmt((t.default_price_cents / 100).toFixed(2))
    else setPayAmt('')
    if (t.default_price_cents === 0) setPayMethod('cortesia')
  }

  function saveType() {
    if (!typeForm.name.trim()) return
    const data = {
      house_id: house.id,
      name: typeForm.name.trim(),
      description: typeForm.description || null,
      default_price_cents: Math.round((parseFloat(typeForm.default_price_cents) || 0) * 100),
      color: typeForm.color,
      icon: typeForm.icon,
      sort_order: parseInt(typeForm.sort_order) || 0,
      active: true,
    }
    const q = editingType
      ? supabase.from('checkin_types').update(data).eq('id', editingType)
      : supabase.from('checkin_types').insert(data)
    q.then(r => {
      if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }
      setEditingType(null); setTypeForm(EMPTY_TYPE); loadTypes()
    })
  }

  function deleteType(id: string) {
    if (!confirm('Remover este tipo de check-in?')) return
    supabase.from('checkin_types').delete().eq('id', id).then(() => loadTypes())
  }

  async function loadRecent() {
    const { data } = await supabase.from('checkins').select('*,clients(full_name),events(name)')
      .eq('house_id', house.id).order('created_at', { ascending: false }).limit(10)
    setRecent(data ?? [])
  }

  function prefilledAmount(res: Reservation, g: ReservationGuest): string {
    if (!res) return ''
    if (res.list_type === 'vip') return '0'
    if (res.list_type === 'custom') {
      const val = g.gender === 'feminino'
        ? (res.list_female_value_cents ?? 0)
        : (res.list_male_value_cents ?? 0)
      return val > 0 ? String(val / 100) : ''
    }
    return res.amount_cents > 0 ? String(res.amount_cents / 100) : ''
  }

  async function loadLists() {
    setLoadingLists(true)
    const now = new Date()
    // Se antes das 8h, considera ontem como data operacional (eventos que viraram a madrugada)
    const opDate = now.getHours() < 8 ? new Date(now.getTime() - 86400000) : now
    const today = `${opDate.getFullYear()}-${String(opDate.getMonth()+1).padStart(2,'0')}-${String(opDate.getDate()).padStart(2,'0')}`

    // Reservas: busca por data de hoje (independe de ter evento vinculado)
    // Se há evento selecionado, inclui também as vinculadas ao evento
    let resvQuery = supabase.from('reservations').select('*,reservation_guests(*)')
      .eq('house_id', house.id).order('expected_arrival')

    if (selEv !== 'bar') {
      resvQuery = resvQuery.or(`reservation_date.eq.${today},event_id.eq.${selEv}`)
    } else {
      resvQuery = resvQuery.eq('reservation_date', today)
    }

    const [resv, guests] = await Promise.all([
      resvQuery,
      selEv !== 'bar'
        ? supabase.from('promoter_list_guests').select('*,promoter_lists(id,name,token,promoters(full_name))').eq('house_id', house.id).eq('event_id', selEv).order('full_name')
        : Promise.resolve({ data: [] }),
    ])

    // Deduplica por id (pode aparecer nas duas condições do OR)
    const seen = new Set<string>()
    const deduped = (resv.data ?? []).filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true })

    setReservations(deduped as Reservation[])
    setPromoGuests((guests.data ?? []) as PromoterGuest[])
    setLoadingLists(false)
  }

  async function confirmReservation(id: string) {
    await supabase.from('reservations').update({ status: 'arrived', arrived_at: new Date().toISOString() }).eq('id', id)
    sT(setToast, '✅ Reserva confirmada!', 'success')
    loadLists()
  }

  async function checkInPromoGuest(g: PromoterGuest) {
    const now = new Date().toISOString()
    let clientId: string | null = null

    // 1. busca cliente existente por CPF ou telefone
    const cpfClean   = g.cpf?.replace(/\D/g, '') ?? ''
    const phoneClean = g.phone?.replace(/\D/g, '') ?? ''
    if (cpfClean || phoneClean) {
      const orParts = [cpfClean ? `cpf.eq.${cpfClean}` : null, phoneClean ? `phone.eq.${phoneClean}` : null].filter(Boolean).join(',')
      const { data: existing } = await supabase.from('clients').select('id').eq('house_id', house.id).or(orParts).limit(1).maybeSingle()
      clientId = existing?.id ?? null
    }

    // 2. se não existe, cria automaticamente
    if (!clientId) {
      const { data: created } = await supabase.from('clients').insert({
        house_id: house.id,
        full_name: g.full_name,
        cpf: cpfClean || null,
        phone: phoneClean || null,
        status: 'ativo',
        created_by: user.id,
      }).select('id').single()
      clientId = created?.id ?? null
    }

    // 3. registra check-in sempre
    await supabase.from('checkins').insert({
      house_id: house.id,
      event_id: selEv !== 'bar' ? selEv : null,
      client_id: clientId,
      source: 'lista_promoter',
      operator_user_id: user.id,
      amount_cents: (g as PromoterGuest & { amount_cents?: number }).amount_cents ?? 0,
      checkin_type: 'lista',
      payment_method: ((g as PromoterGuest & { amount_cents?: number }).amount_cents ?? 0) > 0 ? 'dinheiro' : 'cortesia',
      comanda: g.comanda || null,
    })

    // 4. marca convidado como presente
    await supabase.from('promoter_list_guests').update({ checked_in: true, checked_in_at: now, client_id: clientId }).eq('id', g.id)

    sT(setToast, `✅ ${g.full_name} entrou${clientId ? ' · cliente cadastrado' : ''}!`, 'success')
    await loadLists()
    await loadRecent()
  }

  async function checkInReservaGuest(g: { id: string; name: string; phone?: string; cpf?: string; birth_date?: string; comanda?: string; amount_cents?: number }, photo_url?: string) {
    const now = new Date().toISOString()
    let clientId: string | null = null

    // 1. busca cliente existente por CPF ou telefone
    if (g.cpf || g.phone) {
      const cpfClean  = g.cpf?.replace(/\D/g, '') ?? ''
      const phoneClean = g.phone?.replace(/\D/g, '') ?? ''
      const { data: existing } = await supabase.from('clients').select('id')
        .eq('house_id', house.id)
        .or(
          [cpfClean ? `cpf.eq.${cpfClean}` : null, phoneClean ? `phone.eq.${phoneClean}` : null]
            .filter(Boolean).join(',')
        )
        .limit(1).maybeSingle()
      clientId = existing?.id ?? null
    }

    // 2. se não existe, cria automaticamente
    if (!clientId) {
      const { data: created } = await supabase.from('clients').insert({
        house_id: house.id,
        full_name: g.name,
        cpf: g.cpf?.replace(/\D/g, '') || null,
        phone: g.phone?.replace(/\D/g, '') || null,
        birth_date: g.birth_date || null,
        status: 'ativo',
        created_by: user.id,
        ...(photo_url ? { photo_url } : {}),
      }).select('id').single()
      clientId = created?.id ?? null
    } else if (photo_url) {
      await supabase.from('clients').update({ photo_url }).eq('id', clientId)
    }

    // 3. registra check-in sempre (clientId pode ser null se criação falhou)
    await supabase.from('checkins').insert({
      house_id: house.id,
      event_id: selEv !== 'bar' ? selEv : null,
      client_id: clientId,
      source: 'lista_reserva',
      operator_user_id: user.id,
      amount_cents: g.amount_cents ?? 0,
      checkin_type: 'lista',
      payment_method: (g.amount_cents ?? 0) > 0 ? 'dinheiro' : 'cortesia',
      comanda: g.comanda || null,
    })

    // 4. marca convidado como presente
    await supabase.from('reservation_guests')
      .update({ checked_in: true, checked_in_at: now, client_id: clientId })
      .eq('id', g.id)

    sT(setToast, `✅ ${g.name} entrou${clientId ? ' · cliente cadastrado' : ''}!`, 'success')
    await loadLists()
    await loadRecent()
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      setCameraStream(stream)
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch { sT(setToast, 'Câmera não disponível', 'error') }
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return
    const v = videoRef.current, c = canvasRef.current
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')?.drawImage(v, 0, 0)
    const url = c.toDataURL('image/jpeg', 0.85)
    setCompleteForm(p => ({ ...p, photoDataUrl: url }))
    stopCamera()
  }

  function stopCamera() {
    cameraStream?.getTracks().forEach(t => t.stop())
    setCameraStream(null)
  }

  async function saveCompleteGuest() {
    if (!completeGuest) return
    // Update reservation_guests record with form data
    await supabase.from('reservation_guests').update({
      phone: completeForm.phone || null,
      cpf: completeForm.cpf || null,
      birth_date: completeForm.birth_date || null,
    }).eq('id', completeGuest.id)

    let photoUrl: string | undefined
    if (completeForm.photoDataUrl) {
      try {
        const res = await fetch(completeForm.photoDataUrl)
        const blob = await res.blob()
        const path = `clients/photos/${house.id}/${Date.now()}.jpg`
        const { data: uploadData } = await supabase.storage.from('event-flyers').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
        if (uploadData) {
          const { data: pub } = supabase.storage.from('event-flyers').getPublicUrl(path)
          photoUrl = pub.publicUrl
        }
      } catch { /* photo upload failed silently */ }
    }

    const updatedGuest = {
      ...completeGuest,
      phone: completeForm.phone || completeGuest.phone,
      cpf: completeForm.cpf || completeGuest.cpf,
      birth_date: completeForm.birth_date || completeGuest.birth_date,
      comanda: completeForm.comanda || undefined,
      amount_cents: Math.round((parseFloat(completeForm.amount) || 0) * 100),
    }
    await checkInReservaGuest(updatedGuest, photoUrl)
    stopCamera()
    setCompleteGuest(null)
  }

  function doSearch() {
    if (!search.trim()) return
    setLoading(true); setResult(null); setShowForm(false)
    const q = cn(search)
    const isCPF = q.length === 11
    const isPhone = q.length >= 10 && q.length <= 11 && !isCPF
    const pr = isCPF
      ? supabase.from('clients').select('*').eq('house_id', house.id).eq('cpf', q).single()
      : isPhone
        ? supabase.from('clients').select('*').eq('house_id', house.id).eq('phone', q).single()
        : supabase.from('clients').select('*').eq('house_id', house.id).ilike('full_name', `%${search}%`).limit(1).single()
    pr.then(r => {
      if (r.data) {
        setResult(r.data)
        // Cliente fora de lista com desconto → preenche o valor padrão do evento (por gênero) para não precisar digitar
        if (!selTypeId) setPayAmt(eventPriceFor(r.data.gender ?? ''))
        supabase.from('checkins').select('id', { count: 'exact', head: true })
          .eq('house_id', house.id).eq('client_id', r.data.id)
          .then(rc => setCiCount(rc.count ?? 0))
      } else {
        setShowForm(true)
        sT(setToast, 'Cliente não encontrado. Preencha o cadastro abaixo.', 'warn')
        setNc(prev => ({ ...prev, cpf: isCPF ? q : '', phone: isPhone ? q : '', gender: '' }))
        // Novo cliente (fora de lista) → valor padrão do evento (masculino como base)
        if (!selTypeId) setPayAmt(eventPriceFor(''))
      }
      setLoading(false)
    })
  }

  function doCheckin(c: Client) {
    if (!selEv) { sT(setToast, 'Selecione o evento ou Entrada Livre', 'warn'); return }
    const isBar = selEv === 'bar'
    const cents = Math.round((parseFloat(payAmt) || 0) * 100)

    function doInsert() {
      const selType = ciTypes.find(t => t.id === selTypeId)
      const row: Record<string, unknown> = {
        house_id: house.id, client_id: c.id, source: 'door',
        operator_user_id: user.id, amount_cents: cents,
        checkin_type: selType ? selType.name : 'portaria',
        checkin_type_id: selTypeId || null,
        payment_method: payMethod || 'dinheiro',
        comanda: comanda.trim() || null,
      }
      if (!isBar) row.event_id = selEv
      supabase.from('checkins').insert(row).then(r => {
        if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }
        sT(setToast, `✅ Check-in de ${c.full_name}!${comanda ? ` · Comanda ${comanda}` : ''}`, 'success')
        sendWA(house.id, 'checkin_confirm', c.phone ?? '', c.full_name, {}, c.id, isBar ? null : selEv)
        setResult(null); setSearch(''); setPayAmt(''); setComanda(''); setCiCount(0); setSelTypeId(null)
        loadRecent()
      })
    }

    if (isBar) { doInsert(); return }
    supabase.from('checkins').select('id').eq('event_id', selEv).eq('client_id', c.id).maybeSingle()
      .then(ck => {
        if (ck.data) { sT(setToast, `⚠️ ${c.full_name} já está neste evento!`, 'warn'); return }
        doInsert()
      })
  }

  function eventPriceFor(gender: string): string {
    const ev = events.find(e => e.id === selEv)
    if (!ev) return ''
    const price = (gender === 'feminino' ? ev.price_female_cents : ev.price_male_cents) ?? ev.price_male_cents ?? ev.price_female_cents ?? 0
    return price > 0 ? (price / 100).toFixed(2) : ''
  }

  function pickNcGender(gender: string) {
    setNc(p => ({ ...p, gender }))
    if (!selTypeId) setPayAmt(eventPriceFor(gender))
  }

  function saveNew() {
    if (!nc.full_name || (!nc.cpf && !nc.phone)) {
      sT(setToast, 'Nome e CPF ou celular obrigatórios', 'warn'); return
    }
    supabase.from('clients').insert({
      full_name: nc.full_name, cpf: cn(nc.cpf) || null, phone: cn(nc.phone) || null,
      birth_date: nc.birth_date || null, gender: nc.gender || null, house_id: house.id, status: 'ativo', created_by: user.id,
    }).select().single().then(r => {
      if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }
      doCheckin(r.data)
      setShowForm(false)
    })
  }

  async function handleScan(token: string) {
    setScanning(false); setScanMsg(null)
    const { data: tk } = await supabase
      .from('tickets')
      .select('*,ticket_orders(buyer_name,quantity,amount_cents),events(name,event_date)')
      .eq('token', token).eq('house_id', house.id).single()
    if (!tk) { setScanMsg({ text: '❌ Ingresso inválido ou não encontrado', ok: false }); return }
    setScanned(tk as ScannedTicket)
  }

  async function confirmTicketCheckin() {
    if (!scanned) return
    if (scanned.checked_in) { setScanMsg({ text: '⚠️ Ingresso já utilizado', ok: false }); setScanned(null); return }
    const { error } = await supabase.from('tickets').update({ checked_in: true, checked_in_at: new Date().toISOString() }).eq('id', scanned.id)
    if (error) { setScanMsg({ text: '❌ Erro ao dar entrada', ok: false }); return }
    setScanMsg({ text: `✅ Entrada confirmada! — ${scanned.ticket_orders?.buyer_name ?? scanned.holder_name}`, ok: true })
    setScanned(null)
  }

  const tier = result ? loyalTier(ciCount) : null

  const filteredRes = reservations
    .filter(r => !listSearch || r.name.toLowerCase().includes(listSearch.toLowerCase()) || r.phone?.includes(listSearch))
    .sort((a, b) => {
      // Reservas com convidados não checados sobem; reservas totalmente checadas ou sem convidados ficam abaixo
      const aUnchecked = (a.reservation_guests ?? []).filter((g: ReservationGuest) => !g.checked_in).length
      const bUnchecked = (b.reservation_guests ?? []).filter((g: ReservationGuest) => !g.checked_in).length
      return bUnchecked - aUnchecked
    })
  const filteredGuests = promoGuests
    .filter(g => !listSearch || g.full_name.toLowerCase().includes(listSearch.toLowerCase()) || g.phone?.includes(listSearch))
    .sort((a, b) => (a.checked_in ? 1 : 0) - (b.checked_in ? 1 : 0))

  const evLabel = events.find(e => e.id === selEv)

  return (
    <div style={{ paddingBottom: 80 }}>
      <Toast toast={toast} />
      {scanning && <QRScanner onScan={handleScan} onClose={() => setScanning(false)} />}

      {/* ── Modal de Tipos de Check-in ── */}
      {typesModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ color: C.txt, fontWeight: 900, fontSize: 18, margin: 0 }}>⚙️ Tipos de Check-in</h2>
              <button onClick={() => { setTypesModal(false); setEditingType(null); setTypeForm(EMPTY_TYPE) }}
                style={{ background: 'none', border: 'none', color: C.mut, fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>

            {/* Lista de tipos */}
            <div style={{ marginBottom: 20 }}>
              {ciTypes.length === 0 && (
                <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                  Nenhum tipo configurado. Adicione abaixo.
                </div>
              )}
              {ciTypes.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.brd}` }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: t.color + '22', border: `2px solid ${t.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                    {t.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                    <div style={{ color: C.mut, fontSize: 12 }}>
                      {t.default_price_cents === 0 ? 'Grátis / Cortesia' : fmtCurrency(t.default_price_cents)}
                      {t.description ? ` · ${t.description}` : ''}
                    </div>
                  </div>
                  <button onClick={() => { setEditingType(t.id); setTypeForm({ name: t.name, description: t.description ?? '', default_price_cents: t.default_price_cents > 0 ? (t.default_price_cents / 100).toFixed(2) : '', color: t.color, icon: t.icon, sort_order: String(t.sort_order) }) }}
                    style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '4px 10px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✏️</button>
                  <button onClick={() => deleteType(t.id)}
                    style={{ background: 'none', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '4px 10px', color: C.red, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>🗑</button>
                </div>
              ))}
            </div>

            {/* Form adicionar/editar */}
            <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 16 }}>
              <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, marginBottom: 12, letterSpacing: '0.06em' }}>
                {editingType ? 'EDITAR TIPO' : 'ADICIONAR TIPO'}
              </div>
              {/* Icon picker */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>ÍCONE</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ICON_OPTS.map(ic => (
                    <button key={ic} onClick={() => setTypeForm(p => ({ ...p, icon: ic }))}
                      style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${typeForm.icon === ic ? C.acc : C.brd}`, background: typeForm.icon === ic ? C.acc + '22' : 'transparent', fontSize: 18, cursor: 'pointer' }}>
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>NOME *</label>
                  <input value={typeForm.name} onChange={e => setTypeForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: VIP, Day Use, Quadra"
                    style={{ ...SL, padding: '8px 12px', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>PREÇO PADRÃO (R$)</label>
                  <input type="number" step="0.01" min="0" value={typeForm.default_price_cents} onChange={e => setTypeForm(p => ({ ...p, default_price_cents: e.target.value }))} placeholder="0,00 = Grátis"
                    style={{ ...SL, padding: '8px 12px', fontSize: 13 }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>DESCRIÇÃO (opcional)</label>
                  <input value={typeForm.description} onChange={e => setTypeForm(p => ({ ...p, description: e.target.value }))} placeholder="Ex: Inclui consumação mínima R$ 50"
                    style={{ ...SL, padding: '8px 12px', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>COR</label>
                  <input type="color" value={typeForm.color} onChange={e => setTypeForm(p => ({ ...p, color: e.target.value }))}
                    style={{ width: 44, height: 40, borderRadius: 8, border: `1px solid ${C.brd}`, cursor: 'pointer', background: 'none' }} />
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
            </div>
          </div>
        </div>
      )}

      {/* Header + tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: C.txt, marginBottom: 2 }}>🚪 Check-in</h1>
          <div style={{ color: C.mut, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {evLabel ? (
              <>
                <span style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44`, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>HOJE</span>
                <span>{new Date(evLabel.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })} · <strong style={{ color: C.sub }}>{evLabel.name}</strong></span>
              </>
            ) : '🍺 Entrada Livre · sem evento hoje'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={TAB_BTN(mode === 'checkin')} onClick={() => { setMode('checkin'); setScanMsg(null); setScanned(null) }}>🚪 Portaria</button>
          <button style={TAB_BTN(mode === 'listas')} onClick={() => setMode('listas')}>📋 Listas do Dia</button>
          <button style={TAB_BTN(mode === 'scanner')} onClick={() => { setMode('scanner'); setScanMsg(null); setScanned(null) }}>🎟️ Scanner</button>
          <button onClick={() => setTypesModal(true)}
            style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.brd}`, background: 'transparent', color: C.mut, fontSize: 16, cursor: 'pointer' }}
            title="Configurar tipos de check-in">⚙️</button>
        </div>
      </div>

      {/* ── PORTARIA ── */}
      {mode === 'checkin' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Card>
            {/* Search */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
                autoFocus placeholder="CPF, celular ou nome completo"
                style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }} />
              <Btn onClick={doSearch} disabled={loading}>{loading ? '...' : '🔍 Buscar'}</Btn>
            </div>

            {/* Evento */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>EVENTO / ENTRADA</label>
              <select value={selEv} onChange={e => setSelEv(e.target.value)} style={SL}>
                <option value="bar">🍺 Entrada Livre (sem evento)</option>
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} — {new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                  </option>
                ))}
              </select>
            </div>

            {/* Tipos de Check-in */}
            {ciTypes.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>TIPO DE CHECK-IN</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {ciTypes.map(t => {
                    const active = selTypeId === t.id
                    return (
                      <button key={t.id} onClick={() => active ? (setSelTypeId(null)) : selectType(t)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, border: `2px solid ${active ? t.color : t.color + '44'}`, background: active ? t.color + '22' : 'transparent', color: active ? t.color : C.mut, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 700 : 500, transition: 'all 0.15s' }}>
                        <span style={{ fontSize: 18 }}>{t.icon}</span>
                        <div style={{ textAlign: 'left' }}>
                          <div>{t.name}</div>
                          {t.default_price_cents > 0
                            ? <div style={{ fontSize: 11, opacity: 0.8 }}>{fmtCurrency(t.default_price_cents)}</div>
                            : <div style={{ fontSize: 11, opacity: 0.8 }}>Grátis</div>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Valor + Pagamento + Comanda */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>VALOR</label>
                <input value={payAmt} onChange={e => setPayAmt(e.target.value)} placeholder="R$ 0,00" type="number" step="0.01"
                  style={{ ...SL }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>PAGAMENTO</label>
                <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={SL}>
                  {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>COMANDA</label>
                <input value={comanda} onChange={e => setComanda(e.target.value)} placeholder="Nº"
                  style={{ ...SL, textAlign: 'center', fontWeight: 700, fontSize: 16 }} />
              </div>
            </div>

            {/* Client result */}
            {result && (
              <div style={{ background: C.bg, border: `1px solid ${C.acc}33`, borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ color: C.txt, fontWeight: 800, fontSize: 18 }}>{result.full_name}</div>
                    <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
                      {result.cpf ? fcpf(result.cpf) + ' · ' : ''}{result.phone ? ftel(result.phone) : ''}
                    </div>
                  </div>
                  {tier && (
                    <span style={{ background: tier.color + '22', color: tier.color, border: `1px solid ${tier.color}44`, borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>
                      {tier.icon} {tier.label} · {ciCount} visitas
                    </span>
                  )}
                </div>
                {comanda && (
                  <div style={{ background: C.gold + '18', border: `1px solid ${C.gold}33`, borderRadius: 8, padding: '6px 12px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: C.gold, fontSize: 12, fontWeight: 600 }}>🪙 Comanda:</span>
                    <span style={{ color: C.gold, fontSize: 16, fontWeight: 900 }}>{comanda}</span>
                  </div>
                )}
                <Btn onClick={() => doCheckin(result)} style={{ width: '100%' }}>
                  ✅ Confirmar Check-in — {payAmt ? fmtCurrency(Math.round(parseFloat(payAmt) * 100)) : 'Cortesia'}
                </Btn>
              </div>
            )}

            {/* New client form */}
            {showForm && (
              <div style={{ background: C.bg, border: `1px solid ${C.gold}33`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
                <div style={{ color: C.gold, fontWeight: 700, fontSize: 14, marginBottom: 12 }}>➕ Novo Cliente</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  <input value={nc.full_name} onChange={e => setNc(p => ({ ...p, full_name: e.target.value }))} placeholder="Nome completo *"
                    style={{ background: C.bg2, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit', width: '100%' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <input value={fcpf(nc.cpf)} onChange={e => setNc(p => ({ ...p, cpf: cn(e.target.value).slice(0, 11) }))} placeholder="CPF"
                      style={{ background: C.bg2, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }} />
                    <input value={ftel(nc.phone)} onChange={e => setNc(p => ({ ...p, phone: cn(e.target.value).slice(0, 11) }))} placeholder="Celular"
                      style={{ background: C.bg2, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }} />
                  </div>
                  <input type="date" value={nc.birth_date} onChange={e => setNc(p => ({ ...p, birth_date: e.target.value }))}
                    style={{ background: C.bg2, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit', width: '100%' }} />
                  {/* Gênero — define o valor automático do evento */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([['masculino', '♂ Masculino', C.acc], ['feminino', '♀ Feminino', '#f472b6']] as const).map(([g, label, col]) => {
                      const on = nc.gender === g
                      return (
                        <button key={g} type="button" onClick={() => pickNcGender(g)}
                          style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `2px solid ${on ? col : C.brd}`, background: on ? col + '22' : 'transparent', color: on ? col : C.mut, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', minHeight: 44 }}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn onClick={saveNew} style={{ flex: 1 }}>💾 Cadastrar e Dar Check-in</Btn>
                    <Btn onClick={() => setShowForm(false)} variant="ghost">Cancelar</Btn>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* ── Painel de Reservas + Promotores (accordion) ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Accordion: Reservas */}
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <button
                onClick={() => setPortariaAccordion(p => ({ ...p, reservas: !p.reservas }))}
                style={{ width: '100%', background: 'none', border: 'none', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: C.txt }}>🪑 Reservas ({reservations.length})</span>
                <span style={{ color: C.mut, fontSize: 16 }}>{portariaAccordion.reservas ? '▼' : '▶'}</span>
              </button>
              {portariaAccordion.reservas && (
                <div style={{ padding: '0 16px 16px' }}>
                  {reservations.length === 0
                    ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '16px 0', border: `1px dashed ${C.brd}`, borderRadius: 10 }}>
                        {selEv === 'bar' ? 'Selecione um evento acima' : 'Nenhuma reserva para este evento'}
                      </div>
                    : <>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                          <select value={ciResId} onChange={e => setCiResId(e.target.value)} style={{ ...SL, flex: 1 }}>
                            <option value="">— Selecionar reserva —</option>
                            {[...reservations].sort((a, b) => {
                              const aU = (a.reservation_guests ?? []).filter((g: ReservationGuest) => !g.checked_in).length
                              const bU = (b.reservation_guests ?? []).filter((g: ReservationGuest) => !g.checked_in).length
                              return bU - aU
                            }).map(r => {
                              const guests = (r.reservation_guests ?? []) as ReservationGuest[]
                              const checked = guests.filter(g => g.checked_in).length
                              return (
                                <option key={r.id} value={r.id}>
                                  {r.name}{r.location ? ` · ${r.location}` : ''}{guests.length > 0 ? ` (${checked}/${guests.length})` : ''}
                                </option>
                              )
                            })}
                          </select>
                          {ciResId && (
                            <button onClick={() => setCiResId('')} style={{ background: '#ffffff10', border: `1px solid ${C.brd}`, borderRadius: 8, color: C.mut, cursor: 'pointer', padding: '0 12px', fontSize: 16 }} title="Fechar lista">✕</button>
                          )}
                        </div>

                        {ciResId && (() => {
                          const res = reservations.find(r => r.id === ciResId)
                          if (!res) return null
                          const guests = (res.reservation_guests ?? []) as ReservationGuest[]
                          const arrived = res.status === 'arrived' || res.status === 'confirmado'
                          return (
                            <div>
                              <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                  <div>
                                    <span style={{ fontWeight: 700, color: C.txt, fontSize: 14 }}>{res.name}</span>
                                    {res.location && <span style={{ color: C.acc, fontSize: 12, marginLeft: 8 }}>📍 {res.location}</span>}
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <span style={{ background: arrived ? C.grn + '22' : C.gold + '22', color: arrived ? C.grn : C.gold, border: `1px solid ${arrived ? C.grn : C.gold}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                                      {arrived ? '✅ Chegou' : '⏳ Aguardando'}
                                    </span>
                                    {!arrived && (
                                      <button onClick={() => confirmReservation(res.id)}
                                        style={{ background: C.grn + '22', border: `1px solid ${C.grn}44`, borderRadius: 8, padding: '4px 10px', color: C.grn, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                        ✅ Confirmar
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div style={{ color: C.mut, fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  {res.phone && <span>📱 {ftel(res.phone)}</span>}
                                  {res.expected_arrival && <span>🕐 {res.expected_arrival.slice(0,5)}</span>}
                                  {res.people_count > 0 && <span>👥 {res.people_count} pessoas</span>}
                                </div>
                              </div>
                              {guests.length === 0
                                ? <div style={{ color: C.mut, fontSize: 12, textAlign: 'center', padding: '12px 0', fontStyle: 'italic' }}>
                                    Nenhum convidado cadastrado nesta reserva
                                  </div>
                                : <div style={{ maxHeight: 308, overflowY: 'auto', paddingRight: 2 }}>
                                  {[...guests].sort((a, b) => (a.checked_in ? 1 : 0) - (b.checked_in ? 1 : 0)).map(g => {
                                    const hasData = !!(g.confirmed || (g.name && (g.phone || g.cpf || g.birth_date)))
                                    const hasBirth = !!g.birth_date
                                    return (
                                      <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, marginBottom: 6, background: g.checked_in ? C.grn + '0d' : C.bg, border: `1px solid ${g.checked_in ? C.grn + '33' : C.brd + '55'}` }}>
                                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: g.checked_in ? C.grn : C.mut, flexShrink: 0, boxShadow: g.checked_in ? `0 0 6px ${C.grn}` : 'none' }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ color: g.checked_in ? C.grn : C.txt, fontWeight: 600, fontSize: 13 }}>
                                            {g.name}
                                            {g.gender && <span style={{ color: g.gender === 'feminino' ? '#f472b6' : C.acc, fontSize: 11, marginLeft: 5 }}>{g.gender === 'feminino' ? '♀' : '♂'}</span>}
                                          </div>
                                          <div style={{ color: C.mut, fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                            {g.phone && <span>📱 {ftel(g.phone)}</span>}
                                            {hasBirth && <span style={{ color: C.acc }}>🎂 {new Date(g.birth_date! + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>}
                                            {!hasData && <span style={{ color: C.gold }}>⚠️ dados incompletos</span>}
                                          </div>
                                        </div>
                                        {g.checked_in
                                          ? <span style={{ color: C.grn, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✅ Entrou</span>
                                          : hasData
                                            ? <button
                                                onClick={() => { setPendingCI({ type: 'reserva', guest: g, reservation: res }); setListComanda(''); setListAmount(prefilledAmount(res, g)) }}
                                                style={{ background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, boxShadow: '0 2px 8px rgba(59,130,246,0.4)' }}>
                                                ✅ Check-in
                                              </button>
                                            : <button
                                                onClick={() => { setCompleteGuest(g); setCompleteForm({ phone: g.phone ?? '', cpf: g.cpf ?? '', birth_date: g.birth_date ?? '', photoDataUrl: '', comanda: '', amount: '' }) }}
                                                style={{ background: C.gold + '22', border: `1px solid ${C.gold}44`, borderRadius: 8, padding: '6px 10px', color: C.gold, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                                                ✏️ Manual
                                              </button>
                                        }
                                      </div>
                                    )
                                  })}
                                  </div>
                              }
                            </div>
                          )
                        })()}
                      </>
                  }
                </div>
              )}
            </Card>

            {/* Accordion: Promotores */}
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <button
                onClick={() => setPortariaAccordion(p => ({ ...p, promoters: !p.promoters }))}
                style={{ width: '100%', background: 'none', border: 'none', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: C.txt }}>👤 Promotores ({promoGuests.length})</span>
                <span style={{ color: C.mut, fontSize: 16 }}>{portariaAccordion.promoters ? '▼' : '▶'}</span>
              </button>
              {portariaAccordion.promoters && (
                <div style={{ padding: '0 16px 16px' }}>
                  {promoGuests.length === 0
                    ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '16px 0', border: `1px dashed ${C.brd}`, borderRadius: 10 }}>
                        {selEv === 'bar' ? 'Selecione um evento' : 'Nenhum convidado de promoter'}
                      </div>
                    : filteredGuests.map(g => {
                        const pl = g.promoter_lists as { id?: string; name?: string; token?: string; promoters?: { full_name?: string } } | undefined
                        return (
                          <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, marginBottom: 6, background: g.checked_in ? C.grn + '0d' : C.bg, border: `1px solid ${g.checked_in ? C.grn + '33' : C.brd + '55'}` }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: g.checked_in ? C.grn : C.mut, flexShrink: 0, boxShadow: g.checked_in ? `0 0 6px ${C.grn}` : 'none' }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: g.checked_in ? C.grn : C.txt, fontWeight: 600, fontSize: 13 }}>
                                {g.full_name}
                                {g.gender && <span style={{ color: g.gender === 'feminino' ? '#f472b6' : C.acc, fontSize: 11, marginLeft: 5 }}>{g.gender === 'feminino' ? '♀' : '♂'}</span>}
                              </div>
                              <div style={{ color: C.mut, fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {g.phone && <span>📱 {ftel(g.phone)}</span>}
                                {pl?.name && <span>📋 {pl.name}</span>}
                              </div>
                            </div>
                            {g.checked_in
                              ? <span style={{ color: C.grn, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✅ Entrou</span>
                              : <button
                                  onClick={() => { setPendingCI({ type: 'promo', guest: g }); setListComanda('') }}
                                  style={{ background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, boxShadow: '0 2px 8px rgba(59,130,246,0.4)' }}>
                                  ✅ Entrada
                                </button>
                            }
                          </div>
                        )
                      })
                  }
                </div>
              )}
            </Card>

            {/* Recentes — compacto abaixo */}
            <Card style={{ padding: '14px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.txt, marginBottom: 10 }}>⏱ Recentes</div>
              {recent.length === 0
                ? <div style={{ color: C.mut, fontSize: 12 }}>Nenhum ainda</div>
                : recent.slice(0, 6).map((ci, i) => {
                  const mins = Math.floor((Date.now() - new Date(ci.created_at).getTime()) / 60000)
                  const cl = ci.clients as { full_name?: string } | undefined
                  return (
                    <div key={ci.id || i} style={{ padding: '6px 0', borderBottom: i < Math.min(recent.length, 6) - 1 ? `1px solid ${C.brd}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: C.txt, fontSize: 12, fontWeight: 600 }}>{cl?.full_name ?? 'Visitante'}</div>
                        <div style={{ color: C.mut, fontSize: 11 }}>há {mins < 60 ? `${mins}min` : `${Math.floor(mins / 60)}h`}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {ci.comanda && <span style={{ background: C.gold + '22', color: C.gold, fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6 }}>#{ci.comanda}</span>}
                        {(ci.amount_cents ?? 0) > 0
                          ? <span style={{ color: C.grn, fontSize: 11, fontWeight: 700 }}>{fmtCurrency(ci.amount_cents)}</span>
                          : <span style={{ color: C.mut, fontSize: 11 }}>cortesia</span>
                        }
                      </div>
                    </div>
                  )
                })
              }
            </Card>
          </div>
        </div>
      )}

      {/* ── LISTAS DO DIA ── */}
      {mode === 'listas' && (
        <div>
          {/* Evento selector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 16, alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>EVENTO</label>
              <select value={selEv} onChange={e => { setSelEv(e.target.value) }} style={SL}>
                <option value="bar">— Selecione um evento —</option>
                {events.map(ev => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} — {new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                  </option>
                ))}
              </select>
            </div>
            <input value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="🔍 Buscar nome ou telefone"
              style={{ ...SL, width: 240 }} />
          </div>

          {selEv === 'bar'
            ? <Card><div style={{ color: C.mut, fontSize: 14, textAlign: 'center', padding: 32 }}>Selecione um evento para ver as listas</div></Card>
            : (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <button onClick={loadLists} style={{ background: 'none', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 10, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                    🔄 Atualizar
                  </button>
                </div>

                {loadingLists && <div style={{ color: C.mut, textAlign: 'center', padding: 32 }}>Carregando...</div>}

                {!loadingLists && (
                  <>
                    {/* Accordion: Reservas */}
                    <Card style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
                      <button
                        onClick={() => setListasAccordion(p => ({ ...p, reservas: !p.reservas }))}
                        style={{ width: '100%', background: 'none', border: 'none', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <span style={{ fontWeight: 700, fontSize: 15, color: C.txt }}>🪑 Reservas ({filteredRes.length})</span>
                        <span style={{ color: C.mut, fontSize: 16 }}>{listasAccordion.reservas ? '▼' : '▶'}</span>
                      </button>
                      {listasAccordion.reservas && (
                        <div style={{ padding: '0 16px 16px' }}>
                          {filteredRes.length === 0
                            ? <div style={{ color: C.mut, fontSize: 14, textAlign: 'center', padding: 32 }}>Nenhuma reserva encontrada</div>
                            : filteredRes.map(r => {
                                const arrived = r.status === 'arrived' || r.status === 'confirmado'
                                const guests = (r.reservation_guests ?? []) as ReservationGuest[]
                                const checkedGuests = guests.filter(g => g.checked_in).length
                                const reservaLink = `${window.location.origin}/reserva/${r.token}`
                                return (
                                  <div key={r.id} style={{ marginBottom: 12, border: `1px solid ${arrived ? C.grn + '44' : C.brd}`, borderRadius: 14, padding: 14 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                          <span style={{ color: C.txt, fontWeight: 800, fontSize: 16 }}>{r.name}</span>
                                          <span style={{ background: arrived ? C.grn + '22' : C.gold + '22', color: arrived ? C.grn : C.gold, border: `1px solid ${arrived ? C.grn : C.gold}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                                            {arrived ? '✅ Chegou' : '⏳ Aguardando'}
                                          </span>
                                        </div>
                                        <div style={{ color: C.mut, fontSize: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                                          {r.phone && <span>📱 {ftel(r.phone)}</span>}
                                          <span>👥 {r.people_count} pessoa{r.people_count !== 1 ? 's' : ''}</span>
                                          {r.location && <span>📍 {r.location}</span>}
                                          {r.expected_arrival && <span>🕐 {r.expected_arrival}</span>}
                                          {r.amount_cents > 0 && <span style={{ color: C.gold }}>💰 {fmtCurrency(r.amount_cents)}</span>}
                                        </div>
                                      </div>
                                      {!arrived && (
                                        <Btn onClick={() => confirmReservation(r.id)} style={{ marginLeft: 10, flexShrink: 0, fontSize: 12 }}>
                                          ✅ Chegou
                                        </Btn>
                                      )}
                                    </div>
                                    {guests.length > 0 ? (
                                      <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                          <span style={{ color: C.sub, fontSize: 11, fontWeight: 700 }}>
                                            CONVIDADOS — {checkedGuests}/{guests.length} entraram
                                          </span>
                                        </div>
                                        {[...guests].sort((a, b) => (a.checked_in ? 1 : 0) - (b.checked_in ? 1 : 0)).map(g => (
                                          <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 8, background: g.checked_in ? C.grn + '0d' : C.bg, marginBottom: 4, border: `1px solid ${g.checked_in ? C.grn + '33' : C.brd + '55'}` }}>
                                            <div>
                                              <span style={{ color: g.checked_in ? C.grn : C.txt, fontWeight: 600, fontSize: 14 }}>
                                                {g.checked_in ? '✅' : '○'} {g.name}
                                              </span>
                                              {g.gender && <span style={{ color: g.gender === 'feminino' ? '#f472b6' : C.acc, fontSize: 11, marginLeft: 6 }}>{g.gender === 'feminino' ? '♀' : '♂'}</span>}
                                              {g.phone && <span style={{ color: C.mut, fontSize: 11, marginLeft: 8 }}>📱 {ftel(g.phone)}</span>}
                                              {g.checked_in && g.checked_in_at && (
                                                <span style={{ color: C.grn, fontSize: 10, marginLeft: 8 }}>
                                                  {new Date(g.checked_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                              )}
                                            </div>
                                            {!g.checked_in && (
                                              <button onClick={() => { setPendingCI({ type: 'reserva', guest: g, reservation: r }); setListComanda(''); setListAmount(prefilledAmount(r, g)) }}
                                                style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, color: C.acc, borderRadius: 7, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                                                Entrada
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
                                        <div style={{ color: C.mut, fontSize: 12, marginBottom: 8 }}>
                                          ⚠️ Nenhum convidado pré-cadastrado. Compartilhe o link para o responsável preencher:
                                        </div>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                          <div style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', color: C.acc, fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {reservaLink}
                                          </div>
                                          <button onClick={() => navigator.clipboard.writeText(reservaLink).then(() => sT(setToast, '✅ Link copiado!', 'success'))}
                                            style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, color: C.acc, borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                                            📋 Copiar
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })
                          }
                        </div>
                      )}
                    </Card>

                    {/* Accordion: Promotores */}
                    <Card style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
                      <button
                        onClick={() => setListasAccordion(p => ({ ...p, promoters: !p.promoters }))}
                        style={{ width: '100%', background: 'none', border: 'none', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit' }}>
                        <span style={{ fontWeight: 700, fontSize: 15, color: C.txt }}>👤 Lista de Promoters ({filteredGuests.length})</span>
                        <span style={{ color: C.mut, fontSize: 16 }}>{listasAccordion.promoters ? '▼' : '▶'}</span>
                      </button>
                      {listasAccordion.promoters && (
                        <div style={{ padding: '0 16px 16px' }}>
                          {filteredGuests.length === 0
                            ? <div style={{ color: C.mut, fontSize: 14, textAlign: 'center', padding: 32 }}>Nenhum convidado encontrado</div>
                            : filteredGuests.map(g => {
                                const pl = g.promoter_lists as { id?: string; name?: string; token?: string; promoters?: { full_name?: string } } | undefined
                                const listaLink = pl?.token ? `${window.location.origin}/lista/${pl.token}` : null
                                return (
                                  <div key={g.id} style={{ marginBottom: 10, border: `1px solid ${g.checked_in ? C.grn + '44' : C.brd}`, borderRadius: 14, padding: 14 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                          <span style={{ color: C.txt, fontWeight: 800, fontSize: 15 }}>{g.full_name}</span>
                                          {g.gender && <span style={{ color: g.gender === 'feminino' ? '#f472b6' : C.acc, fontSize: 11, fontWeight: 700 }}>{g.gender === 'feminino' ? '♀' : '♂'}</span>}
                                          <span style={{ background: g.checked_in ? C.grn + '22' : C.brd + '88', color: g.checked_in ? C.grn : C.mut, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                                            {g.checked_in ? '✅ Entrou' : '⏳ Pendente'}
                                          </span>
                                        </div>
                                        <div style={{ color: C.mut, fontSize: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                                          {g.phone && <span>📱 {ftel(g.phone)}</span>}
                                          {pl?.name && <span>📋 {pl.name}</span>}
                                          {pl?.promoters?.full_name && <span>👤 {pl.promoters.full_name}</span>}
                                        </div>
                                        {g.checked_in && g.checked_in_at && (
                                          <div style={{ color: C.grn, fontSize: 11, marginTop: 4 }}>
                                            Entrada às {new Date(g.checked_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                          </div>
                                        )}
                                      </div>
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, marginLeft: 10 }}>
                                        {listaLink && (
                                          <button onClick={() => navigator.clipboard.writeText(listaLink).then(() => sT(setToast, '✅ Link copiado!', 'success'))}
                                            style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                                            title="Copiar link da lista">
                                            🔗
                                          </button>
                                        )}
                                        {!g.checked_in && (
                                          <Btn onClick={() => { setPendingCI({ type: 'promo', guest: g }); setListComanda('') }} style={{ fontSize: 13 }}>
                                            ✅ Entrada
                                          </Btn>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })
                          }
                        </div>
                      )}
                    </Card>
                  </>
                )}
              </>
            )
          }
        </div>
      )}

      {/* ── SCANNER ── */}
      {mode === 'scanner' && (
        <div>
          {scanMsg && (
            <div style={{ background: scanMsg.ok ? '#10b98122' : '#f8717122', border: `1px solid ${scanMsg.ok ? '#10b981' : '#f87171'}44`, borderRadius: 12, padding: '14px 18px', marginBottom: 20, color: scanMsg.ok ? '#10b981' : '#f87171', fontSize: 15, fontWeight: 700 }}>
              {scanMsg.text}
            </div>
          )}
          {scanned && !scanned.checked_in && (
            <Card style={{ marginBottom: 16 }}>
              <div style={{ color: C.txt, fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{scanned.ticket_orders?.buyer_name ?? scanned.holder_name}</div>
              <div style={{ color: C.mut, fontSize: 13, marginBottom: 12 }}>{scanned.events?.name} · Token {scanned.token.slice(0, 8).toUpperCase()}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn onClick={confirmTicketCheckin} style={{ flex: 1 }}>✅ Confirmar Entrada</Btn>
                <Btn onClick={() => setScanned(null)} variant="ghost">Cancelar</Btn>
              </div>
            </Card>
          )}
          {scanned && scanned.checked_in && (
            <Card style={{ marginBottom: 16, border: `1px solid ${C.red}44` }}>
              <div style={{ color: C.red, fontWeight: 800, fontSize: 16, marginBottom: 4 }}>⚠️ Ingresso já utilizado</div>
              <div style={{ color: C.mut, fontSize: 13, marginBottom: 12 }}>
                {scanned.ticket_orders?.buyer_name} · Entrada às {scanned.checked_in_at ? new Date(scanned.checked_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--'}
              </div>
              <Btn onClick={() => setScanned(null)} variant="ghost">Fechar</Btn>
            </Card>
          )}
          <button onClick={() => setScanning(true)}
            style={{ width: '100%', background: `linear-gradient(135deg,#1d4ed8,${C.acc})`, color: '#fff', border: 'none', borderRadius: 14, padding: 18, fontSize: 18, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
            📷 Escanear QR Code
          </button>
        </div>
      )}

      <FAB onClick={() => { setShowForm(true); setResult(null); setMode('checkin') }} icon="➕" title="Novo cliente" />

      {/* ── Modal Comanda + Confirmar Check-in ── */}
      {pendingCI && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setPendingCI(null)}>
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 20, width: '100%', maxWidth: 380, padding: 24 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 17, color: C.txt, marginBottom: 4 }}>
              {pendingCI.type === 'reserva' ? '✅ Confirmar Check-in' : '✅ Confirmar Entrada'}
            </div>
            <div style={{ color: C.acc, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              {'name' in pendingCI.guest ? pendingCI.guest.name : pendingCI.guest.full_name}
            </div>
            {pendingCI.reservation && pendingCI.reservation.list_type && (
              <div style={{ marginBottom: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: pendingCI.reservation.list_type === 'vip' ? '#f59e0b' : pendingCI.reservation.list_type === 'custom' ? '#a78bfa' : '#94a3b8', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>
                  {pendingCI.reservation.list_type === 'vip' ? '⭐ VIP · entrada gratuita' : pendingCI.reservation.list_type === 'custom' ? '💲 Valor combinado' : '📋 Lista normal'}
                </span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  🎫 Comanda <span style={{ fontWeight: 400 }}>(opcional)</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  style={{ ...SL, fontSize: 18, fontWeight: 700, textAlign: 'center', letterSpacing: 3 }}
                  placeholder="Ex: 42"
                  value={listComanda}
                  onChange={e => setListComanda(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.gold, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  💰 Valor Entrada <span style={{ fontWeight: 400, color: C.mut }}>(R$)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  style={{ ...SL, fontSize: 18, fontWeight: 700, textAlign: 'center', borderColor: C.gold + '55' }}
                  placeholder="0,00"
                  value={listAmount}
                  onChange={e => setListAmount(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={async () => {
                  const amtCents = Math.round((parseFloat(listAmount) || 0) * 100)
                  const g = { ...pendingCI.guest as ReservationGuest & PromoterGuest, comanda: listComanda || undefined, amount_cents: amtCents }
                  setPendingCI(null)
                  if (pendingCI.type === 'reserva') await checkInReservaGuest(g as ReservationGuest & { comanda?: string; amount_cents?: number })
                  else await checkInPromoGuest(g as PromoterGuest)
                }}
                style={{ flex: 1, background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 800, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                ✅ Confirmar Entrada
              </button>
              <button onClick={() => setPendingCI(null)}
                style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 16px', color: C.mut, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Completar Cadastro ── */}
      {completeGuest && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 20, width: '100%', maxWidth: 480, maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2 style={{ color: C.txt, fontWeight: 900, fontSize: 18, margin: 0 }}>✏️ Completar Cadastro</h2>
                <div style={{ color: C.mut, fontSize: 13, marginTop: 4 }}>{completeGuest.name}</div>
              </div>
              <button onClick={() => { stopCamera(); setCompleteGuest(null) }}
                style={{ background: 'none', border: 'none', color: C.mut, fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>TELEFONE</label>
                <input value={ftel(completeForm.phone)} onChange={e => setCompleteForm(p => ({ ...p, phone: cn(e.target.value).slice(0, 11) }))} placeholder="(00) 00000-0000"
                  style={{ ...SL }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>CPF</label>
                <input value={fcpf(completeForm.cpf)} onChange={e => setCompleteForm(p => ({ ...p, cpf: cn(e.target.value).slice(0, 11) }))} placeholder="000.000.000-00"
                  style={{ ...SL }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>DATA DE NASCIMENTO</label>
                <input type="date" value={completeForm.birth_date} onChange={e => setCompleteForm(p => ({ ...p, birth_date: e.target.value }))}
                  style={{ ...SL }} />
              </div>

              {/* Camera section */}
              <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 10 }}>FOTO</label>

                {completeForm.photoDataUrl ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                    <img src={completeForm.photoDataUrl} alt="Foto capturada" style={{ width: '100%', maxWidth: 280, borderRadius: 12, border: `1px solid ${C.brd}` }} />
                    <button onClick={() => setCompleteForm(p => ({ ...p, photoDataUrl: '' }))}
                      style={{ background: C.gold + '22', border: `1px solid ${C.gold}44`, color: C.gold, borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      🔄 Tirar Novamente
                    </button>
                  </div>
                ) : cameraStream ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                    <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxWidth: 280, borderRadius: 12, border: `1px solid ${C.brd}` }} />
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={capturePhoto}
                        style={{ background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, border: 'none', color: '#fff', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        📸 Capturar
                      </button>
                      <button onClick={stopCamera}
                        style={{ background: 'transparent', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={startCamera}
                    style={{ width: '100%', background: C.bg, border: `1px dashed ${C.brd}`, color: C.mut, borderRadius: 10, padding: '12px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                    📷 Tirar Foto
                  </button>
                )}
              </div>

              {/* Comanda + Valor */}
              <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🎫 COMANDA</label>
                  <input type="text" inputMode="numeric" value={completeForm.comanda}
                    onChange={e => setCompleteForm(p => ({ ...p, comanda: e.target.value }))}
                    placeholder="Ex: 42"
                    style={{ ...SL, textAlign: 'center', fontWeight: 700, fontSize: 16, letterSpacing: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: C.gold, fontWeight: 600, display: 'block', marginBottom: 4 }}>💰 VALOR ENTRADA (R$)</label>
                  <input type="number" min="0" step="0.01" value={completeForm.amount}
                    onChange={e => setCompleteForm(p => ({ ...p, amount: e.target.value }))}
                    placeholder="0,00"
                    style={{ ...SL, textAlign: 'center', fontWeight: 700, fontSize: 16, borderColor: C.gold + '55' }} />
                </div>
              </div>

              <button onClick={saveCompleteGuest}
                style={{ width: '100%', background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                ✅ Confirmar Check-in
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
