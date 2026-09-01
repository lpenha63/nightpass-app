import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { inicioDoDia, viradaDa, diaOperacionalStr } from '../utils/diaOperacional'
import { C } from '../constants/theme'
import { Card, Toast, Btn } from '../components/ui'
import { cn, fcpf, ftel, fmtCurrency, loyalTier } from '../utils/format'
import { sT, type ToastState } from '../utils/toast'
import { esperadoDaReserva } from '../utils/reservas'
import { sendWA } from '../utils/whatsapp'
import { useIsMobile } from '../hooks/useIsMobile'
import { QRScanner } from '../components/QRScanner'
import type { House, Client, Ticket } from '../types'
import { NASCIMENTO } from '../utils/limitesDeData'

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
  is_extra?: boolean
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
  deposit_cents?: number
  payment_status?: string
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
  birth_date?: string
  list_type?: string
  is_vip?: boolean
  list_value_cents?: number
  checked_in: boolean
  checked_in_at?: string
  promoter_confirmed: boolean
  list_id?: string
  promoter_lists?: { id: string; name: string; token?: string; entry_fee_cents?: number; entry_fee_male_cents?: number; entry_fee_female_cents?: number; cutoff_exempt?: boolean; cutoff_time?: string | null; early_male_cents?: number; early_female_cents?: number; promoters?: { full_name: string } }
  comanda?: string
  is_extra?: boolean
}

const PAY_METHODS = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'PIX' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'credito', label: 'Crédito' },
  { value: 'debito', label: 'Débito' },
  { value: 'cortesia', label: 'Cortesia' },
]

// Canais de aquisição — "como conheceu a casa?" (pesquisa no cadastro de cliente novo)
const REFERRAL_CHANNELS = [
  { value: 'instagram', label: 'Instagram', icon: '📸' },
  { value: 'google', label: 'Google', icon: '🔍' },
  { value: 'tiktok', label: 'TikTok', icon: '🎵' },
  { value: 'facebook', label: 'Facebook', icon: '👍' },
  { value: 'grupo_vip', label: 'Grupo VIP', icon: '⭐' },
  { value: 'panfleto', label: 'Panfleto', icon: '📄' },
  { value: 'indicacao', label: 'Indicação', icon: '🗣️' },
  { value: 'outro', label: 'Outro', icon: '❓' },
]

// Inferência de gênero pelo primeiro nome (padrão de nomes brasileiros).
// É um PALPITE: pré-seleciona e aplica o valor, mas o operador sempre pode corrigir num toque.
const GENDER_NAME_OVERRIDES: Record<string, 'masculino' | 'feminino'> = {
  // masculinos terminados em "a"
  luca: 'masculino', noa: 'masculino', josue: 'masculino', isaias: 'masculino', jeremias: 'masculino',
  elias: 'masculino', tobias: 'masculino', dimas: 'masculino', jonas: 'masculino', lucas: 'masculino',
  thomas: 'masculino', tomas: 'masculino', nicolas: 'masculino', matias: 'masculino', juba: 'masculino',
  // femininos não terminados em "a"
  beatriz: 'feminino', ines: 'feminino', agnes: 'feminino', mercedes: 'feminino', lourdes: 'feminino',
  lurdes: 'feminino', raquel: 'feminino', isabel: 'feminino', cristal: 'feminino', ester: 'feminino',
  esther: 'feminino', rute: 'feminino', ruth: 'feminino', doris: 'feminino', carmen: 'feminino',
  miriam: 'feminino', mirian: 'feminino', yasmin: 'feminino', jasmin: 'feminino', karen: 'feminino',
  caren: 'feminino', eloise: 'feminino', heloise: 'feminino', mel: 'feminino', liz: 'feminino',
  abigail: 'feminino', estefani: 'feminino', nicole: 'feminino', rachel: 'feminino',
}
function guessGenderFromName(fullName: string): 'masculino' | 'feminino' | '' {
  const first = (fullName || '').trim().split(/\s+/)[0] || ''
  if (first.length < 2) return ''
  const n = first.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (GENDER_NAME_OVERRIDES[n]) return GENDER_NAME_OVERRIDES[n]
  if (/(ne|ce|ze|lle|tte|ana|ina|ele|isa|ice)$/.test(n)) return 'feminino'
  const last = n.slice(-1)
  if (last === 'a') return 'feminino'
  if (last === 'o') return 'masculino'
  return ''
}

interface ScannedTicket extends Ticket {
  ticket_orders?: {
    buyer_name: string; quantity: number; amount_cents: number
    buyer_phone?: string; buyer_cpf?: string; payment_status?: string
    ticket_batches?: { name?: string } | null
  }
  events?: { name: string; event_date: string }
}

/** ***.456.789-** — dá para bater com o documento sem exibir o CPF inteiro na tela */
function maskCpf(cpf: string) {
  const d = cpf.replace(/\D/g, '')
  if (d.length < 11) return cpf
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
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

const EMPTY_TYPE = { name: '', description: '', default_price_cents: '', color: '#3b82f6', icon: '🎫', sort_order: '0' }
const ICON_OPTS = ['🎫','🎭','👑','🏅','⭐','🏆','🎯','🎮','🍽️','☀️','🏊','🎾','⚽','🏀','🏐','🎳','🎰','💼','🎪','🎡']

type Mode = 'checkin' | 'listas' | 'scanner' | 'equipe'

interface EventFreelancer {
  id: string
  freelancer_id: string
  role?: string
  entry_time?: string
  checkin_at?: string
  checkout_at?: string
  freelancers?: { full_name: string; phone?: string; work_types?: string[]; work_meta?: { shift_hours?: string } }
}

const TAB_BTN = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 10,
  border: `1px solid ${active ? C.acc : C.brd}`,
  background: active ? C.acc + '22' : 'transparent',
  color: active ? C.acc : C.mut,
  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
})

// Helpers puros (nível de módulo → referência estável, não invalida useMemo)
// Identifica a Lista da Casa para separá-la das listas de promoters
function isHouseGuest(g: PromoterGuest) {
  const pl = g.promoter_lists as { name?: string; promoters?: { full_name?: string } } | undefined
  return pl?.promoters?.full_name === 'Lista da Casa' || pl?.name === 'Lista da Casa'
}
function guestListKey(g: PromoterGuest) {
  const pl = g.promoter_lists as { promoters?: { full_name?: string }; name?: string } | undefined
  return (pl?.promoters?.full_name || pl?.name || '').toLowerCase()
}

export function CheckinPage({ house, user }: Props) {
  const isMobile = useIsMobile()
  const SL: React.CSSProperties = {
    width: '100%', background: C.bg, border: `1px solid ${C.brd}`,
    borderRadius: 10, padding: '10px 14px', color: C.txt,
    fontSize: 14, minHeight: 44, fontFamily: 'inherit',
  }
  const [mode, setMode] = useState<Mode>('checkin')

  // ── portaria ──
  const [scanning, setScanning] = useState(false)
  const [codeInput, setCodeInput] = useState('')
  const [buscandoCod, setBuscandoCod] = useState(false)
  const [scanned, setScanned] = useState<ScannedTicket | null>(null)
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<Client | null>(null)
  const [ciCount, setCiCount] = useState(0)
  const [events, setEvents] = useState<Array<{ id: string; name: string; event_date: string; price_male_cents?: number; price_female_cents?: number; capacity?: number; price_male_list_cents?: number; price_female_list_cents?: number; list_cutoff_time?: string | null; price_male_list_early_cents?: number; price_female_list_early_cents?: number }>>([])
  const [selEv, setSelEv] = useState('bar')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [ciReferral, setCiReferral] = useState('') // canal "como conheceu" opcional no check-in da porta
  const [nc, setNc] = useState({ full_name: '', cpf: '', phone: '', birth_date: '', gender: '', referral_source: '' })
  const [recent, setRecent] = useState<RecentCI[]>([])
  const [ciToday, setCiToday] = useState(0)
  const [payMethod, setPayMethod] = useState('dinheiro')
  const [payAmt, setPayAmt] = useState('')
  const [genderGuess, setGenderGuess] = useState<'masculino' | 'feminino' | ''>('')
  const [ncGenderTouched, setNcGenderTouched] = useState(false)
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
  const [completeGuest, setCompleteGuest] = useState<(ReservationGuest & { _promo?: PromoterGuest }) | null>(null)
  const [completeKind, setCompleteKind] = useState<'reserva' | 'promo'>('reserva')
  const [completeForm, setCompleteForm] = useState({ phone: '', cpf: '', birth_date: '', photoDataUrl: '', comanda: '', amount: '', gender: '', payment_method: 'dinheiro', referral_source: '' })
  // ── adicionar convidado extra (fora da lista) numa reserva, na hora do check-in ──
  const [addToRes, setAddToRes] = useState<Reservation | null>(null)
  const [addToList, setAddToList] = useState<{ id: string; name: string } | null>(null)
  const [addForm, setAddForm] = useState({ name: '', phone: '', cpf: '', birth_date: '', gender: '', comanda: '', amount: '', payment_method: 'cortesia', referral_source: '' })
  const [addSaving, setAddSaving] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ── accordion state ──
  const [portariaAccordion, setPortariaAccordion] = useState<{ reservas: boolean; promoters: boolean }>({ reservas: true, promoters: true })
  const [listasAccordion, setListasAccordion] = useState<{ reservas: boolean; promoters: boolean }>({ reservas: true, promoters: true })

  // ── filtro de lista de promoter ──
  const [selPromoList, setSelPromoList] = useState<string>('all')
  const [promoSearch, setPromoSearch] = useState('')
  // Janela de renderização — evita jogar milhares de nós no DOM de uma vez (listas grandes)
  const PAGE_STEP = 120
  const [guestShow, setGuestShow] = useState(PAGE_STEP)
  const [resShow, setResShow] = useState(60)
  // Reinicia a janela quando o filtro/busca muda (nova lista começa do topo)
  useEffect(() => { setGuestShow(PAGE_STEP) }, [promoSearch, selPromoList])
  useEffect(() => { setResShow(60) }, [listSearch])
  const moreBtn = (shown: number, total: number, onMore: () => void) => total > shown ? (
    <button onClick={onMore} style={{ width: '100%', marginTop: 6, background: C.acc + '14', border: `1px solid ${C.acc}33`, borderRadius: 8, padding: '8px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
      ▼ Mostrar mais ({total - shown} restantes)
    </button>
  ) : null
  // ── busca de reserva no card da portaria ──
  const [ciResSearch, setCiResSearch] = useState('')

  // Cadeado anti clique-duplo: impede que o mesmo check-in seja salvo 2x ao mesmo tempo
  const ciInFlight = useRef<Set<string>>(new Set())
  // ── comanda confirm ──
  const [pendingCI, setPendingCI] = useState<{ type: 'reserva' | 'promo'; guest: ReservationGuest | PromoterGuest; reservation?: Reservation } | null>(null)
  const [pendingReferral, setPendingReferral] = useState('') // canal de aquisição (novo cadastro) no modal de Entrada
  const [listComanda, setListComanda] = useState('')
  const [listAmount, setListAmount] = useState('')
  const [listPayMethod, setListPayMethod] = useState('dinheiro')
  // Recebimento do valor pendente da reserva (cai no caixa)
  const [payRes, setPayRes] = useState<Reservation | null>(null)
  const [payForm, setPayForm] = useState({ amount: '', method: 'dinheiro' })

  // ── checkin de freelancers (equipe) ──
  const [eventFreelancers, setEventFreelancers] = useState<EventFreelancer[]>([])
  const [loadingTeam, setLoadingTeam] = useState(false)
  const [teamSearch, setTeamSearch] = useState('')
  const [teamModalOpen, setTeamModalOpen] = useState(false) // check-in da equipe direto na Portaria
  const [teamAllBusy, setTeamAllBusy] = useState(false)

  async function loadTeam() {
    if (selEv === 'bar') { setEventFreelancers([]); return }
    setLoadingTeam(true)
    const { data } = await supabase.from('event_freelancers')
      .select('id,freelancer_id,role,entry_time,checkin_at,checkout_at,freelancers(full_name,phone,work_types,work_meta)')
      .eq('event_id', selEv).order('role')
    setEventFreelancers((data ?? []) as unknown as EventFreelancer[])
    setLoadingTeam(false)
  }

  async function teamCheckin(ef: EventFreelancer) {
    const now = new Date().toISOString()
    await supabase.from('event_freelancers').update({ checkin_at: now }).eq('id', ef.id)
    setEventFreelancers(p => p.map(x => x.id === ef.id ? { ...x, checkin_at: now } : x))
    sT(setToast, `✅ ${ef.freelancers?.full_name ?? 'Freelancer'} — entrada registrada!`, 'success')
  }

  // Marca entrada de toda a equipe que ainda não deu check-in (para aquele dia/evento)
  async function teamCheckinAll() {
    if (teamAllBusy) return
    const pend = eventFreelancers.filter(e => !e.checkin_at)
    if (pend.length === 0) { sT(setToast, 'Todos já registraram entrada.', 'success'); return }
    setTeamAllBusy(true)
    const now = new Date().toISOString()
    const ids = pend.map(e => e.id)
    const { error } = await supabase.from('event_freelancers').update({ checkin_at: now }).in('id', ids)
    setTeamAllBusy(false)
    if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); return }
    setEventFreelancers(p => p.map(x => x.checkin_at ? x : { ...x, checkin_at: now }))
    sT(setToast, `✅ Entrada registrada para ${pend.length} da equipe!`, 'success')
  }

  async function teamCheckout(ef: EventFreelancer) {
    const now = new Date().toISOString()
    await supabase.from('event_freelancers').update({ checkout_at: now }).eq('id', ef.id)
    setEventFreelancers(p => p.map(x => x.id === ef.id ? { ...x, checkout_at: now } : x))
    sT(setToast, `👋 ${ef.freelancers?.full_name ?? 'Freelancer'} — saída registrada!`, 'success')
  }

  // Registra saída de todos que estão presentes e ainda não saíram (fim da noite)
  async function teamCheckoutAll() {
    if (teamAllBusy) return
    const pend = eventFreelancers.filter(e => e.checkin_at && !e.checkout_at)
    if (pend.length === 0) { sT(setToast, 'Ninguém pendente de saída.', 'success'); return }
    setTeamAllBusy(true)
    const now = new Date().toISOString()
    const ids = pend.map(e => e.id)
    const { error } = await supabase.from('event_freelancers').update({ checkout_at: now }).in('id', ids)
    setTeamAllBusy(false)
    if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); return }
    setEventFreelancers(p => p.map(x => (x.checkin_at && !x.checkout_at) ? { ...x, checkout_at: now } : x))
    sT(setToast, `👋 Saída registrada para ${pend.length} da equipe!`, 'success')
  }

  async function teamUndo(ef: EventFreelancer) {
    await supabase.from('event_freelancers').update({ checkin_at: null, checkout_at: null }).eq('id', ef.id)
    setEventFreelancers(p => p.map(x => x.id === ef.id ? { ...x, checkin_at: undefined, checkout_at: undefined } : x))
  }

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
    loadTeam()
    setSelPromoList('all')
    setPromoSearch('')
    // Em dia de evento, a entrada "Normal" (preço padrão do evento) já vem selecionada
    const ev = events.find(e => e.id === selEv)
    const evPrice = ev ? ((ev.price_male_cents ?? 0) || (ev.price_female_cents ?? 0)) : 0
    if (selEv !== 'bar' && evPrice > 0) {
      setSelTypeId('event-default')
      setPayAmt(eventPriceFor(''))
      setPayMethod('dinheiro')
    } else {
      setSelTypeId(null)
      setPayAmt('')
    }
  }, [selEv])

  function loadTypes() {
    supabase.from('checkin_types').select('*').eq('house_id', house.id).eq('active', true).order('sort_order')
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

  async function deleteType(id: string) {
    if (!confirm('Remover este tipo de check-in?')) return
    // Tenta apagar de fato; se não remover (em uso / RLS), desativa para sumir da lista
    const { data: del, error } = await supabase.from('checkin_types').delete().eq('id', id).select('id')
    if (!error && del && del.length > 0) { sT(setToast, 'Tipo removido', 'success'); loadTypes(); return }
    const { error: e2 } = await supabase.from('checkin_types').update({ active: false }).eq('id', id)
    if (e2) { sT(setToast, 'Erro ao remover: ' + e2.message, 'error'); return }
    sT(setToast, 'Tipo removido', 'success'); loadTypes()
  }

  async function loadRecent() {
    const now = new Date()
    const opDate = now.getHours() < 8 ? new Date(now.getTime() - 86400000) : now
    // meia-noite local em UTC para filtrar corretamente no Supabase (que armazena em UTC)
    const startOfDay = new Date(opDate.getFullYear(), opDate.getMonth(), opDate.getDate(), 0, 0, 0).toISOString()
    const { data } = await supabase.from('checkins').select('*,clients(full_name),events(name)')
      .eq('house_id', house.id).gte('created_at', startOfDay).order('created_at', { ascending: false }).limit(10)
    setRecent(data ?? [])
    const { count } = await supabase.from('checkins').select('id', { count: 'exact', head: true })
      .eq('house_id', house.id).gte('created_at', startOfDay)
    setCiToday(count ?? 0)
  }

  // Valor pré-preenchido para convidado de promoter/lista da casa.
  // Prioridade: VIP grátis → valor explícito do convidado → valor da própria lista (por gênero)
  //             → preço de lista do evento (por gênero). Garante que o valor RELATIVO da lista seja cobrado.
  // Virada de preço da lista por horário. Retorna os centavos vigentes AGORA
  // (dia operacional: horários após meia-noite contam como "depois"). null = evento sem virada.
  function listCutoffCentsNow(ev: { list_cutoff_time?: string | null; price_male_list_cents?: number; price_female_list_cents?: number; price_male_list_early_cents?: number; price_female_list_early_cents?: number } | undefined, fem: boolean): number | null {
    const t = ev?.list_cutoff_time
    if (!t) return null
    const [cH, cM] = t.split(':').map(Number)
    if (isNaN(cH)) return null
    const toMin = (h: number, m: number) => ((h < 12 ? h + 24 : h) * 60 + m) // 12h como divisor do dia operacional
    const now = new Date()
    const before = toMin(now.getHours(), now.getMinutes()) <= toMin(cH, cM || 0)
    const early = fem ? (ev?.price_female_list_early_cents ?? 0) : (ev?.price_male_list_early_cents ?? 0)
    const full = fem ? (ev?.price_female_list_cents ?? 0) : (ev?.price_male_list_cents ?? 0)
    return before ? early : full
  }

  // Virada própria da LISTA (ex.: "VIP até 20:30, depois R$ 20") — tem prioridade sobre o evento
  function listOwnCutoffNow(pl: { cutoff_time?: string | null; early_male_cents?: number; early_female_cents?: number; entry_fee_male_cents?: number; entry_fee_female_cents?: number; entry_fee_cents?: number } | undefined, fem: boolean): number | null {
    const t = pl?.cutoff_time
    if (!t) return null
    const [cH, cM] = t.split(':').map(Number)
    if (isNaN(cH)) return null
    const toMin = (h: number, m: number) => ((h < 12 ? h + 24 : h) * 60 + m)
    const now = new Date()
    const before = toMin(now.getHours(), now.getMinutes()) <= toMin(cH, cM || 0)
    if (before) return fem ? (pl?.early_female_cents ?? 0) : (pl?.early_male_cents ?? 0)
    const full = fem ? (pl?.entry_fee_female_cents ?? 0) : (pl?.entry_fee_male_cents ?? 0)
    return full > 0 ? full : (pl?.entry_fee_cents ?? 0)
  }

  function promoPrefill(g: PromoterGuest): string {
    const fem = g.gender === 'feminino' || g.gender === 'F'
    // Lista VIP "sem horário": sempre grátis, ignora qualquer virada
    if ((g.promoter_lists as { cutoff_exempt?: boolean } | undefined)?.cutoff_exempt) return '0'
    // 1º: virada da PRÓPRIA lista (mais específica que a do evento)
    const ownCut = listOwnCutoffNow(g.promoter_lists as Parameters<typeof listOwnCutoffNow>[0], fem)
    if (ownCut !== null) return String(ownCut / 100)
    // 2º: virada de preço por horário do evento (vale para todas as listas)
    const evCut = events.find(e => e.id === selEv)
    const cutCents = listCutoffCentsNow(evCut, fem)
    if (cutCents !== null) return String(cutCents / 100)
    if (g.is_vip) return '0'
    // Lista marcada como VIP (ex: "Lista de Fulano · VIP") → entrada gratuita
    if (/\bvip\b/i.test(g.promoter_lists?.name ?? '')) return '0'
    // 1. Valor definido individualmente para o convidado (ex: lista de campanha)
    if ((g.list_value_cents ?? 0) > 0) return String((g.list_value_cents ?? 0) / 100)
    // 2. Valor próprio da lista do promoter, por gênero (cai no valor geral/legado se gênero não definido)
    const pl = g.promoter_lists
    const genderVal = fem ? (pl?.entry_fee_female_cents ?? 0) : (pl?.entry_fee_male_cents ?? 0)
    const listCents = genderVal > 0 ? genderVal : (pl?.entry_fee_cents ?? 0)
    if (listCents > 0) return String(listCents / 100)
    // 3. Fallback: preço de lista do evento, por gênero
    const ev = events.find(e => e.id === selEv) as { price_male_list_cents?: number; price_female_list_cents?: number } | undefined
    const evCents = (fem ? ev?.price_female_list_cents : ev?.price_male_list_cents) ?? 0
    return evCents > 0 ? String(evCents / 100) : ''
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
      .eq('house_id', house.id).order('name')

    if (selEv !== 'bar') {
      resvQuery = resvQuery.or(`reservation_date.eq.${today},event_id.eq.${selEv}`)
    } else {
      resvQuery = resvQuery.eq('reservation_date', today)
    }

    const [resv, guests] = await Promise.all([
      resvQuery,
      selEv !== 'bar'
        ? supabase.from('promoter_list_guests').select('*,promoter_lists(id,name,token,entry_fee_cents,entry_fee_male_cents,entry_fee_female_cents,cutoff_exempt,cutoff_time,early_male_cents,early_female_cents,promoters(full_name))').eq('house_id', house.id).eq('event_id', selEv).order('full_name')
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
    const res = reservations.find(r => r.id === id)
    const already = res?.status === 'arrived' || res?.status === 'confirmado'
    await supabase.from('reservations').update({ status: 'arrived', arrived_at: new Date().toISOString() }).eq('id', id)

    // Registra o CHECK-IN do titular (dono da reserva) — sem valor (cortesia),
    // pois o valor da reserva já entra no caixa por outra via. Assim o titular
    // conta na entrada e aparece na lista de check-ins. Guarda contra duplicar.
    if (res && !already) {
      let clientId: string | null = null
      const phoneClean = res.phone?.replace(/\D/g, '') ?? ''
      if (phoneClean) {
        const { data: existing } = await supabase.from('clients').select('id')
          .eq('house_id', house.id).eq('phone', phoneClean).limit(1).maybeSingle()
        clientId = existing?.id ?? null
        if (!clientId) {
          const { data: created } = await supabase.from('clients').insert({
            house_id: house.id, full_name: res.name, phone: phoneClean || null,
            status: 'active', created_by: user.id,
          }).select('id').single()
          clientId = created?.id ?? null
        }
      }
      await supabase.from('checkins').insert({
        house_id: house.id,
        // vincula ao evento da própria reserva (mesmo no modo Balcão)
        event_id: (res as Reservation & { event_id?: string }).event_id || (selEv !== 'bar' ? selEv : null),
        client_id: clientId,
        source: 'lista_reserva',
        operator_user_id: user.id,
        amount_cents: 0,
        checkin_type: 'lista',
        payment_method: 'cortesia',
      })
    }

    sT(setToast, already ? '✅ Reserva confirmada!' : '✅ Titular na casa — check-in registrado!', 'success')
    loadLists()
    loadRecent()
  }

  // Registra o recebimento do valor pendente da reserva (atualiza sinal/status + forma de pgto → caixa)
  async function receberReserva() {
    if (!payRes) return
    const total = payRes.amount_cents ?? 0
    const already = payRes.deposit_cents ?? 0
    const received = Math.round((parseFloat(payForm.amount.replace(',', '.')) || 0) * 100)
    if (received <= 0) { sT(setToast, 'Informe o valor recebido', 'warn'); return }
    const newDeposit = Math.min(total, already + received)
    const status = newDeposit >= total ? 'paid' : 'partial'
    const { error } = await supabase.from('reservations').update({ deposit_cents: newDeposit, payment_status: status, payment_method: payForm.method }).eq('id', payRes.id)
    if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); return }
    sT(setToast, status === 'paid' ? '✅ Reserva quitada — entrou no caixa!' : '✅ Pagamento parcial registrado', 'success')
    setPayRes(null)
    loadLists()
  }

  async function checkInPromoGuest(g: PromoterGuest) {
    // Trava anti clique-duplo: mesma pessoa+evento não entra 2x concorrente
    const lockKey = `promo:${g.id}:${selEv}`
    if (ciInFlight.current.has(lockKey)) return
    ciInFlight.current.add(lockKey)
    try {
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

    const referral = (g as PromoterGuest & { referral_source?: string }).referral_source || null

    // 2. se não existe, cria automaticamente (com o canal de aquisição, se informado)
    if (!clientId) {
      const { data: created } = await supabase.from('clients').insert({
        house_id: house.id,
        full_name: g.full_name,
        cpf: cpfClean || null,
        phone: phoneClean || null,
        birth_date: g.birth_date || null,
        referral_source: referral,
        status: 'active',
        created_by: user.id,
      }).select('id').single()
      clientId = created?.id ?? null
    } else if (referral) {
      // cliente já existe: preenche o canal só se ainda estiver vazio (não sobrescreve)
      await supabase.from('clients').update({ referral_source: referral }).eq('id', clientId).is('referral_source', null)
    }

    // Evento: vincula ao evento da LISTA do convidado (mesmo se a portaria estiver no
    // modo Balcão). promoter_list_guests.event_id é sempre preenchido; senão cai no selEv.
    const promoEventId = (g as PromoterGuest & { event_id?: string }).event_id || (selEv !== 'bar' ? selEv : null)

    // 3. registra check-in sempre
    await supabase.from('checkins').insert({
      house_id: house.id,
      event_id: promoEventId,
      client_id: clientId,
      source: 'lista_promoter',
      operator_user_id: user.id,
      amount_cents: (g as PromoterGuest & { amount_cents?: number }).amount_cents ?? 0,
      checkin_type: 'lista',
      payment_method: (g as PromoterGuest & { amount_cents?: number; payment_method?: string }).payment_method ?? (((g as PromoterGuest & { amount_cents?: number }).amount_cents ?? 0) > 0 ? 'dinheiro' : 'cortesia'),
      comanda: g.comanda || null,
    })

    // 4. marca convidado como presente
    await supabase.from('promoter_list_guests').update({ checked_in: true, checked_in_at: now, client_id: clientId }).eq('id', g.id)

    sT(setToast, `✅ ${g.full_name} entrou${clientId ? ' · cliente cadastrado' : ''}!`, 'success')
    setListSearch('') // limpa a busca após o check-in
    await loadLists()
    await loadRecent()
    } finally { ciInFlight.current.delete(lockKey) }
  }

  // Check-in de convidado de lista: exige telefone + nascimento.
  // Sem esses dados, abre o "Completar Cadastro" antes de liberar a entrada.
  function startPromoCheckin(g: PromoterGuest) {
    const pa = promoPrefill(g)
    if (!g.phone || !g.birth_date) {
      const gg = g.gender || guessGenderFromName(g.full_name)
      setCompleteKind('promo')
      setCompleteGuest({ ...(g as unknown as ReservationGuest), name: g.full_name, _promo: g })
      setCompleteForm({ phone: g.phone ?? '', cpf: g.cpf ?? '', birth_date: g.birth_date ?? '', photoDataUrl: '', comanda: '', amount: pa, gender: gg, payment_method: parseFloat(pa) > 0 ? 'dinheiro' : 'cortesia', referral_source: '' })
      return
    }
    setPendingCI({ type: 'promo', guest: g }); setPendingReferral(''); setListComanda(''); setListAmount(pa); setListPayMethod(parseFloat(pa) > 0 ? 'dinheiro' : 'cortesia')
  }

  async function checkInReservaGuest(g: { id: string; name: string; phone?: string; cpf?: string; birth_date?: string; gender?: string; comanda?: string; amount_cents?: number; payment_method?: string; referral_source?: string }, photo_url?: string) {
    const lockKey = `reserva:${g.id}:${selEv}`
    if (ciInFlight.current.has(lockKey)) return
    ciInFlight.current.add(lockKey)
    try {
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
        gender: g.gender || null,
        referral_source: g.referral_source || null,
        status: 'active',
        created_by: user.id,
        ...(photo_url ? { photo_url } : {}),
      }).select('id').single()
      clientId = created?.id ?? null
    } else {
      // cliente já existe: completa gênero/foto se vieram preenchidos agora
      const upd: Record<string, unknown> = {}
      if (g.gender) upd.gender = g.gender
      if (photo_url) upd.photo_url = photo_url
      if (Object.keys(upd).length) await supabase.from('clients').update(upd).eq('id', clientId)
      // canal de aquisição: preenche só se ainda estiver vazio (não sobrescreve)
      if (g.referral_source) await supabase.from('clients').update({ referral_source: g.referral_source }).eq('id', clientId).is('referral_source', null)
    }

    // Evento: vincula ao evento da RESERVA (mesmo se a portaria estiver no modo Balcão).
    // reservation_guests não guarda event_id, então buscamos pela reserva.
    let reservaEventId: string | null = selEv !== 'bar' ? selEv : null
    const rid = (g as { reservation_id?: string }).reservation_id
    if (rid) {
      const { data: rr } = await supabase.from('reservations').select('event_id').eq('id', rid).maybeSingle()
      if (rr?.event_id) reservaEventId = rr.event_id as string
    }

    // 3. registra check-in sempre (clientId pode ser null se criação falhou)
    await supabase.from('checkins').insert({
      house_id: house.id,
      event_id: reservaEventId,
      client_id: clientId,
      source: 'lista_reserva',
      operator_user_id: user.id,
      amount_cents: g.amount_cents ?? 0,
      checkin_type: 'lista',
      payment_method: g.payment_method ?? ((g.amount_cents ?? 0) > 0 ? 'dinheiro' : 'cortesia'),
      comanda: g.comanda || null,
    })

    // 4. marca convidado como presente
    await supabase.from('reservation_guests')
      .update({ checked_in: true, checked_in_at: now, client_id: clientId })
      .eq('id', g.id)

    sT(setToast, `✅ ${g.name} entrou${clientId ? ' · cliente cadastrado' : ''}!`, 'success')
    setListSearch('') // limpa a busca após o check-in
    await loadLists()
    await loadRecent()
    } finally { ciInFlight.current.delete(lockKey) }
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
    // Dados básicos obrigatórios para o check-in: celular + data de nascimento
    if (cn(completeForm.phone).length < 10) { sT(setToast, 'Celular obrigatório para o check-in', 'warn'); return }
    if (!completeForm.birth_date) { sT(setToast, 'Data de nascimento obrigatória para o check-in', 'warn'); return }

    // Grava os dados na tabela correta (reserva x lista de promoter)
    const table = completeKind === 'promo' ? 'promoter_list_guests' : 'reservation_guests'
    await supabase.from(table).update({
      phone: completeForm.phone || null,
      cpf: completeForm.cpf || null,
      birth_date: completeForm.birth_date || null,
      gender: completeForm.gender || null,
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

    const amount_cents = completeForm.payment_method === 'cortesia' ? 0 : Math.round((parseFloat(completeForm.amount) || 0) * 100)

    if (completeKind === 'promo' && completeGuest._promo) {
      // Convidado de lista: check-in de promoter com os dados completados
      const gp = {
        ...completeGuest._promo,
        phone: completeForm.phone || completeGuest._promo.phone,
        cpf: completeForm.cpf || completeGuest._promo.cpf,
        birth_date: completeForm.birth_date || completeGuest._promo.birth_date,
        gender: completeForm.gender || completeGuest._promo.gender,
        comanda: completeForm.comanda || undefined,
        amount_cents,
        payment_method: completeForm.payment_method,
        referral_source: completeForm.referral_source || undefined,
      }
      await checkInPromoGuest(gp as PromoterGuest)
    } else {
      const updatedGuest = {
        ...completeGuest,
        phone: completeForm.phone || completeGuest.phone,
        cpf: completeForm.cpf || completeGuest.cpf,
        birth_date: completeForm.birth_date || completeGuest.birth_date,
        gender: completeForm.gender || completeGuest.gender,
        comanda: completeForm.comanda || undefined,
        amount_cents,
        payment_method: completeForm.payment_method,
        referral_source: completeForm.referral_source || undefined,
      }
      await checkInReservaGuest(updatedGuest, photoUrl)
    }
    stopCamera()
    setCompleteGuest(null)
  }

  const EMPTY_ADD = { name: '', phone: '', cpf: '', birth_date: '', gender: '', comanda: '', amount: '', payment_method: 'cortesia', referral_source: '' }

  // Abre o modal de "adicionar convidado extra" para uma reserva
  function openAddGuest(r: Reservation) {
    setAddToList(null); setAddToRes(r); setAddForm(EMPTY_ADD)
  }

  // Abre o modal de "adicionar convidado extra" para uma lista de promoter
  function openAddListGuest(list: { id: string; name: string }) {
    setAddToRes(null); setAddToList(list); setAddForm(EMPTY_ADD)
  }

  // Cria um convidado NOVO (fora da lista) vinculado à reserva e já faz o check-in dele,
  // contando para a reserva do contratante.
  async function saveAddGuest() {
    if (!addToRes || addSaving) return
    if (!addForm.name.trim()) { sT(setToast, 'Nome obrigatório', 'warn'); return }
    if (cn(addForm.phone).length < 10) { sT(setToast, 'Celular obrigatório para o check-in', 'warn'); return }
    if (!addForm.birth_date) { sT(setToast, 'Data de nascimento obrigatória', 'warn'); return }
    setAddSaving(true)
    try {
      const gender = addForm.gender || guessGenderFromName(addForm.name)
      const evId = (addToRes as Reservation & { event_id?: string }).event_id ?? (selEv !== 'bar' ? selEv : null)
      // 1. cria o convidado na reserva (marcado como extra via observação implícita: fora da lista)
      const { data: ng, error } = await supabase.from('reservation_guests').insert({
        reservation_id: addToRes.id,
        house_id: house.id,
        event_id: evId,
        name: addForm.name.trim(),
        phone: cn(addForm.phone) || null,
        cpf: cn(addForm.cpf) || null,
        birth_date: addForm.birth_date || null,
        gender,
        is_extra: true,
      }).select('id').single()
      if (error || !ng) { sT(setToast, 'Erro ao adicionar convidado', 'error'); return }
      // 2. check-in do convidado recém-criado (conta para a reserva)
      const amount_cents = addForm.payment_method === 'cortesia' ? 0 : Math.round((parseFloat(addForm.amount.replace(',', '.')) || 0) * 100)
      await checkInReservaGuest({
        id: ng.id, name: addForm.name.trim(), phone: cn(addForm.phone), cpf: cn(addForm.cpf),
        birth_date: addForm.birth_date, gender, comanda: addForm.comanda || undefined,
        amount_cents, payment_method: addForm.payment_method,
        referral_source: addForm.referral_source || undefined,
        reservation_id: addToRes.id,
      } as Parameters<typeof checkInReservaGuest>[0])
      setAddToRes(null)
    } finally { setAddSaving(false) }
  }

  // Cria um convidado NOVO (fora da lista) vinculado a uma LISTA de promoter e já faz check-in.
  async function saveAddListGuest() {
    if (!addToList || addSaving) return
    if (!addForm.name.trim()) { sT(setToast, 'Nome obrigatório', 'warn'); return }
    if (cn(addForm.phone).length < 10) { sT(setToast, 'Celular obrigatório para o check-in', 'warn'); return }
    if (!addForm.birth_date) { sT(setToast, 'Data de nascimento obrigatória', 'warn'); return }
    setAddSaving(true)
    try {
      const gender = addForm.gender || guessGenderFromName(addForm.name)
      const evId = selEv !== 'bar' ? selEv : null
      // 1. cria o convidado na lista
      const { data: ng, error } = await supabase.from('promoter_list_guests').insert({
        list_id: addToList.id,
        house_id: house.id,
        event_id: evId,
        full_name: addForm.name.trim(),
        phone: cn(addForm.phone) || null,
        cpf: cn(addForm.cpf) || null,
        birth_date: addForm.birth_date || null,
        gender,
        is_extra: true,
      }).select('id').single()
      if (error || !ng) { sT(setToast, 'Erro ao adicionar convidado', 'error'); return }
      // 2. check-in do convidado recém-criado (conta para a lista/promoter)
      const amount_cents = addForm.payment_method === 'cortesia' ? 0 : Math.round((parseFloat(addForm.amount.replace(',', '.')) || 0) * 100)
      await checkInPromoGuest({
        id: ng.id, full_name: addForm.name.trim(), phone: cn(addForm.phone), cpf: cn(addForm.cpf),
        birth_date: addForm.birth_date, gender, event_id: evId ?? undefined,
        comanda: addForm.comanda || undefined, amount_cents, payment_method: addForm.payment_method,
        referral_source: addForm.referral_source || undefined,
      } as unknown as PromoterGuest)
      setAddToList(null)
    } finally { setAddSaving(false) }
  }

  function doSearch() {
    if (!search.trim()) return
    setLoading(true); setResult(null); setShowForm(false); setGenderGuess('')
    const q = cn(search)
    // Número (10–11 dígitos) é tratado como CELULAR por padrão (primeira entrada
    // mais comum). Busca casa tanto em phone quanto em cpf, para achar de qualquer jeito.
    const isNumeric = /^\d+$/.test(q) && q.length >= 10 && q.length <= 11
    const pr = isNumeric
      ? supabase.from('clients').select('*').eq('house_id', house.id).or(`phone.eq.${q},cpf.eq.${q}`).limit(1).maybeSingle()
      : supabase.from('clients').select('*').eq('house_id', house.id).ilike('full_name', `%${search}%`).limit(1).maybeSingle()
    pr.then(r => {
      if (r.data) {
        setResult(r.data)
        // Gênero efetivo: o do cadastro, ou um palpite pelo primeiro nome (para aplicar o valor certo sem digitar)
        const effGender = r.data.gender || guessGenderFromName(r.data.full_name ?? '')
        if (!r.data.gender) setGenderGuess(guessGenderFromName(r.data.full_name ?? ''))
        if (!selTypeId || selTypeId === 'event-default') setPayAmt(eventPriceFor(effGender))
        supabase.from('checkins').select('id', { count: 'exact', head: true })
          .eq('house_id', house.id).eq('client_id', r.data.id)
          .then(rc => setCiCount(rc.count ?? 0))
      } else {
        setShowForm(true)
        sT(setToast, 'Cliente não encontrado. Preencha o cadastro abaixo.', 'warn')
        // Se a busca foi por nome, já preenche o nome e infere o gênero pelo primeiro nome
        const guessed = isNumeric ? '' : guessGenderFromName(search)
        setNcGenderTouched(false)
        setNc(prev => ({ ...prev, full_name: isNumeric ? prev.full_name : search, cpf: '', phone: isNumeric ? q : '', gender: guessed, referral_source: '' }))
        if (!selTypeId || selTypeId === 'event-default') setPayAmt(eventPriceFor(guessed))
      }
      setLoading(false)
    })
  }

  function doCheckin(c: Client) {
    if (!selEv) { sT(setToast, 'Selecione o evento ou Entrada Livre', 'warn'); return }
    const isBar = selEv === 'bar'
    // Trava anti clique-duplo (na porta): mesmo cliente+evento não é salvo 2x concorrente
    const lockKey = `door:${c.id}:${selEv}`
    if (ciInFlight.current.has(lockKey)) return
    ciInFlight.current.add(lockKey)
    const releaseLock = () => setTimeout(() => ciInFlight.current.delete(lockKey), 1200)
    // Cortesia é entrada grátis → nunca grava valor
    const cents = payMethod === 'cortesia' ? 0 : Math.round((parseFloat(payAmt) || 0) * 100)

    function doInsert() {
      const selType = ciTypes.find(t => t.id === selTypeId)
      const row: Record<string, unknown> = {
        house_id: house.id, client_id: c.id, source: 'door',
        operator_user_id: user.id, amount_cents: cents,
        checkin_type: selType ? selType.name : (selTypeId === 'event-default' ? 'normal' : 'portaria'),
        checkin_type_id: selType ? selTypeId : null,
        payment_method: payMethod || 'dinheiro',
        comanda: comanda.trim() || null,
      }
      if (!isBar) row.event_id = selEv
      // Persiste o gênero inferido pelo nome se o cadastro ainda não tinha (não pergunta de novo no futuro)
      if (!c.gender && genderGuess) supabase.from('clients').update({ gender: genderGuess }).eq('id', c.id).then(() => {})
      // Grava o canal "como conheceu" só se o cliente ainda não tem (não sobrescreve resposta anterior)
      if (ciReferral) supabase.from('clients').update({ referral_source: ciReferral }).eq('id', c.id).is('referral_source', null).then(() => {})
      supabase.from('checkins').insert(row).then(r => {
        releaseLock()
        if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }
        sT(setToast, `✅ Check-in de ${c.full_name}!${comanda ? ` · Comanda ${comanda}` : ''}`, 'success')
        sendWA(house.id, 'checkin_confirm', c.phone ?? '', c.full_name, {}, c.id, isBar ? null : selEv)
        setResult(null); setSearch(''); setComanda(''); setCiCount(0); setGenderGuess(''); setCiReferral('')
        // Volta ao padrão "Normal" do evento para o próximo da fila (sem precisar redigitar)
        const evReset = events.find(e => e.id === selEv)
        const evResetPrice = evReset ? ((evReset.price_male_cents ?? 0) || (evReset.price_female_cents ?? 0)) : 0
        if (!isBar && evResetPrice > 0) { setSelTypeId('event-default'); setPayAmt(eventPriceFor('')) }
        else { setSelTypeId(null); setPayAmt('') }
        loadRecent()
      })
    }

    // Anti-duplicidade robusta (count, não maybeSingle — que falharia se já houvesse duplicata):
    if (isBar) {
      // Entrada livre / bar: bloqueia se já entrou HOJE (dia operacional começa às 6h)
      const dayStart = inicioDoDia(viradaDa(house)).toISOString()
      supabase.from('checkins').select('id', { count: 'exact', head: true }).eq('house_id', house.id).eq('client_id', c.id).gte('created_at', dayStart)
        .then(({ count }) => {
          if ((count ?? 0) > 0) { releaseLock(); sT(setToast, `✅ Check-in já feito — ${c.full_name} já entrou hoje!`, 'warn'); return }
          doInsert()
        })
      return
    }
    supabase.from('checkins').select('id', { count: 'exact', head: true }).eq('event_id', selEv).eq('client_id', c.id)
      .then(({ count }) => {
        if ((count ?? 0) > 0) { releaseLock(); sT(setToast, `✅ Check-in já feito — ${c.full_name} já está neste evento!`, 'warn'); return }
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
    setNcGenderTouched(true)
    setNc(p => ({ ...p, gender }))
    if (!selTypeId || selTypeId === 'event-default') setPayAmt(eventPriceFor(gender))
  }

  function saveNew() {
    if (!nc.full_name || (!nc.cpf && !nc.phone)) {
      sT(setToast, 'Nome e CPF ou celular obrigatórios', 'warn'); return
    }
    supabase.from('clients').insert({
      full_name: nc.full_name, cpf: cn(nc.cpf) || null, phone: cn(nc.phone) || null,
      birth_date: nc.birth_date || null, gender: nc.gender || null, house_id: house.id, status: 'active', created_by: user.id,
      referral_source: nc.referral_source || null,
    }).select().single().then(r => {
      if (r.error) { sT(setToast, 'Erro: ' + r.error.message, 'error'); return }
      doCheckin(r.data)
      setShowForm(false)
    })
  }

  async function buscarPorCodigo() {
    const code = codeInput.trim()
    if (code.length < 8) { setScanMsg({ text: 'Digite os 8 caracteres do código', ok: false }); return }
    setBuscandoCod(true); setScanMsg(null); setScanned(null)
    // RPC restrita à casa do operador — a tabela `tickets` não é lida direto pelo cliente
    const { data, error } = await supabase.rpc('find_ticket_by_code', { p_house_id: house.id, p_code: code })
    setBuscandoCod(false)
    if (error) { setScanMsg({ text: `❌ Erro na busca: ${error.message}`, ok: false }); return }
    const achados = (data ?? []) as { token: string }[]
    if (achados.length === 0) { setScanMsg({ text: '❌ Nenhum ingresso com esse código', ok: false }); return }
    if (achados.length > 1) { setScanMsg({ text: '⚠️ Mais de um ingresso com esse código — use a câmera', ok: false }); return }
    setCodeInput('')
    await handleScan(achados[0].token)
  }

  async function handleScan(token: string) {
    setScanning(false); setScanMsg(null)
    const { data: tk, error: tkErr } = await supabase
      .from('tickets')
      .select('*,ticket_orders(buyer_name,quantity,amount_cents,buyer_phone,buyer_cpf,payment_status,ticket_batches(name)),events(name,event_date)')
      .eq('token', token).eq('house_id', house.id).maybeSingle()

    // O erro era descartado: qualquer falha (rede, permissão, consulta) virava
    // "ingresso inválido" e não havia como descobrir a causa na porta.
    if (tkErr) { setScanMsg({ text: `❌ Erro ao consultar o ingresso: ${tkErr.message}`, ok: false }); return }

    if (!tk) {
      // Antes de acusar o ingresso, conferir se ele não é de OUTRA casa: com mais de uma
      // unidade na conta, dá para estar com a casa errada selecionada e o QR ser válido.
      const { data: outra } = await supabase.from('tickets')
        .select('house_id,houses(name)').eq('token', token).maybeSingle()
      const nomeOutra = (outra as { houses?: { name?: string } } | null)?.houses?.name
      setScanMsg({
        text: outra && nomeOutra
          ? `❌ Este ingresso é da unidade "${nomeOutra}". Você está em "${house.name}" — troque a unidade no menu.`
          : '❌ Ingresso inválido ou não encontrado',
        ok: false,
      })
      return
    }
    // Pedido estornado/cancelado mantinha o QR funcionando — a pessoa entrava com ingresso devolvido
    const st = (tk as ScannedTicket).ticket_orders?.payment_status
    if (st && st !== 'paid') {
      setScanMsg({ text: st === 'cancelled' ? '❌ Pedido cancelado — ingresso sem validade' : '⚠️ Pagamento não confirmado para este ingresso', ok: false })
      return
    }
    // Validade: o ingresso vale no DIA DO EVENTO dele. Antes qualquer QR pago entrava
    // em qualquer noite — um ingresso de um evento que já passou abria a porta hoje.
    // Usa o dia operacional da casa, então evento que vira a madrugada continua valendo.
    const dataEv = (tk as ScannedTicket).events?.event_date
    const hoje = diaOperacionalStr(viradaDa(house))
    if (dataEv && dataEv !== hoje) {
      const fmt = (d: string) => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
      setScanMsg({
        text: dataEv < hoje
          ? `❌ Ingresso do evento de ${fmt(dataEv)} — já passou. Hoje é ${fmt(hoje)}.`
          : `❌ Ingresso só vale em ${fmt(dataEv)}. Hoje é ${fmt(hoje)}.`,
        ok: false,
      })
      return
    }
    setScanned(tk as ScannedTicket)
  }

  async function confirmTicketCheckin() {
    if (!scanned) return
    if (scanned.checked_in) { setScanMsg({ text: '⚠️ Ingresso já utilizado', ok: false }); setScanned(null); return }
    const ord = scanned.ticket_orders
    const nome = ord?.buyer_name ?? scanned.holder_name

    // 1. cliente: reaproveita o cadastro por CPF/telefone da compra, senão cria (igual aos outros fluxos)
    const cpfClean = ord?.buyer_cpf?.replace(/\D/g, '') ?? ''
    const phoneClean = ord?.buyer_phone?.replace(/\D/g, '') ?? ''
    let clientId: string | null = null
    if (cpfClean || phoneClean) {
      const orParts = [cpfClean ? `cpf.eq.${cpfClean}` : null, phoneClean ? `phone.eq.${phoneClean}` : null].filter(Boolean).join(',')
      const { data: existing } = await supabase.from('clients').select('id').eq('house_id', house.id).or(orParts).limit(1).maybeSingle()
      clientId = existing?.id ?? null
    }
    if (!clientId && nome) {
      const { data: created } = await supabase.from('clients').insert({
        house_id: house.id, full_name: nome,
        cpf: cpfClean || null, phone: phoneClean || null,
        referral_source: 'ingresso_online', status: 'active', created_by: user.id,
      }).select('id').single()
      clientId = created?.id ?? null
    }

    // 2. o check-in de verdade — sem isso a venda online não entrava no total do evento.
    //    amount_cents = 0 de propósito: a receita já vem de ticket_orders no DRE
    //    (pnlRev = rev_checkins + rev_tickets), então cobrar aqui contaria o dinheiro duas vezes.
    //    Este registro serve para contar a PESSOA. Mesma lógica do check-in de reserva.
    const { data: ci, error: ciErr } = await supabase.from('checkins').insert({
      house_id: house.id,
      event_id: scanned.event_id,
      client_id: clientId,
      source: 'ingresso',
      operator_user_id: user.id,
      amount_cents: 0,
      checkin_type: 'ingresso',
      payment_method: 'online',
      notes: ord?.buyer_name ? `Ingresso online — pedido de ${ord.buyer_name}` : null,
    }).select('id').single()
    if (ciErr) { setScanMsg({ text: `❌ Erro ao registrar check-in: ${ciErr.message}`, ok: false }); return }

    // 3. só então marca o ingresso como usado, apontando para o check-in criado
    const { error } = await supabase.from('tickets')
      .update({ checked_in: true, checked_in_at: new Date().toISOString(), checkin_id: ci?.id ?? null })
      .eq('id', scanned.id)
    if (error) { setScanMsg({ text: '❌ Erro ao dar entrada', ok: false }); return }

    setScanMsg({ text: `✅ Entrada confirmada! — ${nome}`, ok: true })
    setScanned(null)
    loadRecent()
  }

  const tier = result ? loyalTier(ciCount) : null

  // Memoizado: só re-ordena quando as reservas ou a busca mudam (não a cada tecla/render)
  const filteredRes = useMemo(() => reservations
    .filter(r => !listSearch || r.name.toLowerCase().includes(listSearch.toLowerCase()) || r.phone?.includes(listSearch))
    .map(r => ({
      ...r,
      reservation_guests: [...(r.reservation_guests ?? [])].sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR')
      )
    }))
    .sort((a, b) => {
      // Reservas com convidados não checados sobem; dentro do mesmo grupo, ordem alfabética
      const aUnchecked = (a.reservation_guests ?? []).filter((g: ReservationGuest) => !g.checked_in).length
      const bUnchecked = (b.reservation_guests ?? []).filter((g: ReservationGuest) => !g.checked_in).length
      if (bUnchecked !== aUnchecked) return bUnchecked - aUnchecked
      return a.name.localeCompare(b.name, 'pt-BR')
    }), [reservations, listSearch])

  // Lista única de promoter lists para o dropdown
  const promoLists = useMemo(() => {
    const seen = new Set<string>()
    const lists: Array<{ id: string; name: string; promoter?: string }> = []
    promoGuests.forEach(g => {
      const pl = g.promoter_lists as { id?: string; name?: string; promoters?: { full_name?: string } } | undefined
      if (pl?.id && !seen.has(pl.id)) {
        seen.add(pl.id)
        lists.push({ id: pl.id, name: pl.name ?? 'Lista', promoter: pl.promoters?.full_name })
      }
    })
    return lists
  }, [promoGuests])

  // Memoizado: filtra + ordena os convidados só quando a fonte/busca/lista muda
  const filteredGuests = useMemo(() => promoGuests
    .filter(g => {
      if (selPromoList !== 'all' && g.list_id !== selPromoList) return false
      const s = promoSearch.toLowerCase()
      return !s || g.full_name.toLowerCase().includes(s) || (g.phone ?? '').includes(s)
    })
    // Agrupa por lista (cada promoter individual); a Lista da Casa vai por último
    .sort((a, b) => {
      const ah = isHouseGuest(a) ? 1 : 0, bh = isHouseGuest(b) ? 1 : 0
      if (ah !== bh) return ah - bh
      const ak = guestListKey(a), bk = guestListKey(b)
      if (ak !== bk) return ak.localeCompare(bk)
      const ci = (a.checked_in ? 1 : 0) - (b.checked_in ? 1 : 0)
      if (ci !== 0) return ci
      return a.full_name.localeCompare(b.full_name, 'pt-BR')
    }), [promoGuests, selPromoList, promoSearch])

  // Contagem por lista (para os cabeçalhos de grupo)
  const countByList = useMemo(() => {
    const m = new Map<string, number>()
    filteredGuests.forEach(g => { const id = (g.promoter_lists?.id ?? g.list_id ?? ''); m.set(id, (m.get(id) ?? 0) + 1) })
    return m
  }, [filteredGuests])

  // Cabeçalho de grupo de lista — só aparece quando muda a lista (separa cada promoter e a Lista da Casa)
  // Linha de convidado de reserva — reusada na reserva selecionada e na busca por nome (todas as reservas)
  function reservaGuestRow(g: ReservationGuest, res: Reservation, showRes = false) {
    const hasBirth = !!g.birth_date
    const hasBasic = !!(g.phone && g.birth_date)
    return (
      <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, marginBottom: 6, background: g.checked_in ? C.grn + '0d' : C.bg, border: `1px solid ${g.checked_in ? C.grn + '33' : C.brd + '55'}` }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: g.checked_in ? C.grn : C.mut, flexShrink: 0, boxShadow: g.checked_in ? `0 0 6px ${C.grn}` : 'none' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: g.checked_in ? C.grn : C.txt, fontWeight: 600, fontSize: 13 }}>
            {g.name}
            {g.gender && <span style={{ color: g.gender === 'feminino' ? '#f472b6' : C.acc, fontSize: 11, marginLeft: 5 }}>{g.gender === 'feminino' ? '♀' : '♂'}</span>}
          </div>
          <div style={{ color: C.mut, fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {showRes && <span style={{ color: '#a78bfa' }}>🪑 {res.name}</span>}
            {g.phone && <span>📱 {ftel(g.phone)}</span>}
            {hasBirth && <span style={{ color: C.acc }}>🎂 {new Date(g.birth_date! + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>}
            {!hasBasic && <span style={{ color: C.gold }}>⚠️ falta cel/nascimento</span>}
          </div>
        </div>
        {g.checked_in
          ? <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ color: C.grn, fontSize: 11, fontWeight: 700 }}>✅ Entrou</div>
              {g.checked_in_at && <div style={{ color: C.acc, fontSize: 11, fontWeight: 700 }}>🕐 {new Date(g.checked_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>}
            </div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
              {hasBasic
                ? <button
                    onClick={() => { setPendingCI({ type: 'reserva', guest: g, reservation: res }); setPendingReferral(''); setListComanda(''); const pa = prefilledAmount(res, g); setListAmount(pa); setListPayMethod(parseFloat(pa) > 0 ? 'dinheiro' : 'cortesia') }}
                    style={{ background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(59,130,246,0.4)' }}>
                    ✅ Check-in
                  </button>
                : <button
                    onClick={() => { const gg = g.gender || guessGenderFromName(g.name); const pa = prefilledAmount(res, { ...g, gender: gg }); setCompleteKind('reserva'); setCompleteGuest(g); setCompleteForm({ phone: g.phone ?? '', cpf: g.cpf ?? '', birth_date: g.birth_date ?? '', photoDataUrl: '', comanda: '', amount: pa, gender: gg, payment_method: parseFloat(pa) > 0 ? 'dinheiro' : 'cortesia', referral_source: '' }) }}
                    style={{ background: C.gold + '11', border: `1px solid ${C.gold}44`, borderRadius: 8, padding: '6px 12px', color: C.gold, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    📝 Completar p/ entrar
                  </button>
              }
            </div>
        }
      </div>
    )
  }

  function listGroupHeader(g: PromoterGuest, prev?: PromoterGuest) {
    const id = g.promoter_lists?.id ?? g.list_id ?? ''
    const prevId = prev ? (prev.promoter_lists?.id ?? prev.list_id ?? '') : null
    if (selPromoList !== 'all') return null
    if (id === prevId) return null
    const house = isHouseGuest(g)
    const pl = g.promoter_lists as { name?: string; promoters?: { full_name?: string } } | undefined
    const main = house ? 'Lista da Casa' : (pl?.promoters?.full_name || pl?.name || 'Lista')
    const sub = !house && pl?.name && pl.name !== main ? ` · ${pl.name}` : ''
    const count = countByList.get(id) ?? 0
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px', padding: '5px 10px', borderRadius: 8, background: house ? '#10b98114' : '#7c3aed14', border: `1px solid ${house ? '#10b98133' : '#7c3aed33'}` }}>
        <span style={{ fontSize: 13 }}>{house ? '🏠' : '📣'}</span>
        <span style={{ color: house ? '#10b981' : '#a78bfa', fontSize: 12, fontWeight: 800 }}>{main}{sub}</span>
        <span style={{ color: C.mut, fontSize: 11, fontWeight: 700, marginLeft: 'auto' }}>{count} convidado{count !== 1 ? 's' : ''}</span>
      </div>
    )
  }

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
              <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
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
      <div className="r-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isMobile ? 16 : 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, color: C.txt, marginBottom: 2 }}>🚪 Check-in</h1>
          <div style={{ color: C.mut, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {evLabel ? (
              <>
                <span style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44`, borderRadius: 6, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>HOJE</span>
                <span>{new Date(evLabel.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })} · <strong style={{ color: C.sub }}>{evLabel.name}</strong></span>
              </>
            ) : '🍺 Entrada Livre · sem evento hoje'}
          </div>
        </div>
        <div className="ci-tabs" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={TAB_BTN(mode === 'checkin')} onClick={() => { setMode('checkin'); setScanMsg(null); setScanned(null) }}>🚪 Portaria</button>
          <button style={TAB_BTN(mode === 'listas')} onClick={() => setMode('listas')}>📋 {isMobile ? 'Listas' : 'Listas do Dia'}</button>
          <button style={TAB_BTN(mode === 'scanner')} onClick={() => { setMode('scanner'); setScanMsg(null); setScanned(null) }}>🎫 Scanner</button>
          <button style={TAB_BTN(mode === 'equipe')} onClick={() => setMode('equipe')}>👷 Equipe</button>
          <button onClick={() => { loadTypes(); setTypesModal(true) }}
            style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.brd}`, background: 'transparent', color: C.mut, fontSize: 16, cursor: 'pointer', flexShrink: 0 }}
            title="Configurar tipos de check-in">⚙️</button>
        </div>
      </div>

      {/* Resumo do dia — faixa compacta segmentada */}
      {(() => {
        const pend = reservations.filter(r => r.status !== 'cancelled')
        // Faltando = total de convidados na lista − já fizeram check-in
        const expectedPeople = pend.reduce((s, r) => {
          const guests = r.reservation_guests ?? []
          const checkedIn = guests.filter((g: { checked_in?: boolean }) => g.checked_in).length
          return s + Math.max(0, esperadoDaReserva(r) - checkedIn)
        }, 0)
        // Convidados em listas (Casa + promoters)
        const listTotal = promoGuests.length
        // Total de pessoas previstas nas reservas (independente de já terem entrado).
        // Antes usava os nomes cadastrados quando existiam, e uma reserva de 80 com 12 nomes
        // contava 12 — por isso a portaria mostrava bem menos que o Dashboard.
        const resPeopleTotal = pend.reduce((s, r) => s + esperadoDaReserva(r), 0)
        const expectedTotal = listTotal + resPeopleTotal       // todos previstos (listas + reservas)
        const cap = events.find(e => e.id === selEv)?.capacity ?? 0
        const occPct = cap > 0 ? Math.round(ciToday / cap * 100) : 0
        // ── CELULAR: faixa compacta segmentada ──
        if (isMobile) {
          const cards = [
            { label: 'Esperado', val: String(expectedTotal), sub: `${listTotal} list. · ${resPeopleTotal} res.`, color: C.acc },
            { label: 'Entraram', val: String(ciToday), sub: 'hoje', color: C.grn },
            { label: 'Reservas', val: String(expectedPeople), sub: `${pend.length} reserva${pend.length === 1 ? '' : 's'}`, color: C.gold },
            ...(cap > 0 ? [{ label: 'Lotação', val: `${occPct}%`, sub: `${ciToday}/${cap}`, color: occPct >= 90 ? C.red : occPct >= 60 ? C.gold : C.acc }] : []),
          ]
          return (
            <div style={{ display: 'flex', alignItems: 'stretch', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 14, padding: '12px 6px', marginBottom: 16 }}>
              {cards.map((c, i) => (
                <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '0 6px', borderLeft: i ? `1px solid ${C.brd}` : 'none' }}>
                  <div style={{ color: c.color, fontSize: 23, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap' }}>{c.val}</div>
                  <div style={{ color: C.sub, fontSize: 11.5, fontWeight: 700, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{c.label}</div>
                  <div style={{ color: C.mut, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{c.sub}</div>
                </div>
              ))}
            </div>
          )
        }
        // ── DESKTOP: cards originais ──
        const cards = [
          { icon: '👥', label: 'Esperado total', val: `${expectedTotal} pessoas`, sub: `${listTotal} em listas · ${resPeopleTotal} em reservas`, color: C.acc },
          { icon: '✅', label: 'Já entraram', val: `${ciToday} check-ins`, sub: 'hoje', color: C.grn },
          { icon: '🪑', label: 'Reservas aguardando', val: `${expectedPeople} pessoas`, sub: `${pend.length} reserva${pend.length === 1 ? '' : 's'}`, color: C.gold },
          ...(cap > 0 ? [{ icon: '🏠', label: 'Lotação', val: `${occPct}%`, sub: `${ciToday}/${cap}`, color: occPct >= 90 ? C.red : occPct >= 60 ? C.gold : C.acc }] : []),
        ]
        return (
          <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            {cards.map((c, i) => (
              <div key={i} style={{ flex: '1 1 200px', background: C.bg, border: `1px solid ${c.color}33`, borderTop: `3px solid ${c.color}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 26 }}>{c.icon}</span>
                <div>
                  <div style={{ color: c.color, fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{c.val}</div>
                  <div style={{ color: C.mut, fontSize: 11, fontWeight: 600, marginTop: 3 }}>{c.label}{c.sub ? ` · ${c.sub}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ── PORTARIA ── */}
      {mode === 'checkin' && (
        <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isMobile ? 12 : 16 }}>
          <Card style={isMobile ? { padding: '14px 13px' } : undefined}>
            {/* Search */}
            <div className="ci-search" style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
                autoFocus placeholder="CPF, celular ou nome completo"
                style={{ flex: 1, minWidth: 0, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }} />
              <Btn onClick={doSearch} disabled={loading}>{loading ? '...' : '🔍 Buscar'}</Btn>
            </div>
            {isMobile && !showForm && !result && (
              <button onClick={() => { setShowForm(true); setResult(null); setNc({ full_name: search.trim() && !/^\d+$/.test(cn(search)) ? search.trim() : '', cpf: '', phone: '', birth_date: '', gender: '', referral_source: '' }) }}
                style={{ background: 'transparent', border: `1px dashed ${C.brd}`, borderRadius: 10, padding: '9px', width: '100%', color: C.mut, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 14 }}>
                ➕ Cadastrar cliente novo
              </button>
            )}

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

            {/* Check-in da equipe de trabalho do dia (abre modal, sem trocar de aba) */}
            {selEv !== 'bar' && eventFreelancers.length > 0 && (() => {
              const present = eventFreelancers.filter(e => e.checkin_at).length
              const total = eventFreelancers.length
              return (
                <button onClick={() => setTeamModalOpen(true)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: C.acc + '14', border: `1px solid ${C.acc}44`, borderRadius: 10, padding: '10px 14px', color: C.acc, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 14 }}>
                  <span>👷 Check-in da Equipe</span>
                  <span style={{ background: present === total ? C.grn + '22' : C.acc + '22', color: present === total ? C.grn : C.acc, borderRadius: 8, padding: '2px 10px', fontSize: 12, fontWeight: 800 }}>{present}/{total} presentes</span>
                </button>
              )
            })()}

            {/* Tipos de Check-in */}
            {(() => {
              const ev = events.find(e => e.id === selEv)
              const pm = ev?.price_male_cents ?? 0, pf = ev?.price_female_cents ?? 0
              const evPrice = pm || pf
              const showNormal = selEv !== 'bar' && evPrice > 0
              if (!showNormal && ciTypes.length === 0) return null
              const normalActive = selTypeId === 'event-default'
              return (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>TIPO DE CHECK-IN</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {showNormal && (
                    <button onClick={() => normalActive ? setSelTypeId(null) : (setSelTypeId('event-default'), setPayAmt(eventPriceFor(result?.gender ?? nc.gender ?? '')), setPayMethod('dinheiro'))}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, border: `2px solid ${normalActive ? C.acc : C.acc + '44'}`, background: normalActive ? C.acc + '22' : 'transparent', color: normalActive ? C.acc : C.mut, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: normalActive ? 700 : 500, transition: 'all 0.15s' }}>
                      <span style={{ fontSize: 18 }}>🎫</span>
                      <div style={{ textAlign: 'left' }}>
                        <div>Normal</div>
                        <div style={{ fontSize: 11, opacity: 0.8 }}>
                          {pm > 0 && pf > 0 && pm !== pf ? `♂ ${fmtCurrency(pm)} · ♀ ${fmtCurrency(pf)}` : fmtCurrency(evPrice)}
                        </div>
                      </div>
                    </button>
                  )}
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
              )
            })()}

            {/* Valor + Pagamento + Comanda */}
            <div className={isMobile ? undefined : 'r-stack'} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 110px' : '1fr 1fr 120px', gap: 10, marginBottom: isMobile ? 10 : 14 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>VALOR</label>
                <input value={payAmt} onChange={e => setPayAmt(e.target.value)} placeholder="R$ 0,00" type="number" step="0.01"
                  style={{ ...SL }} />
              </div>
              {isMobile ? (
                <div>
                  <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>COMANDA</label>
                  <input value={comanda} onChange={e => setComanda(e.target.value)} placeholder="Nº"
                    style={{ ...SL, textAlign: 'center', fontWeight: 700, fontSize: 16 }} />
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>PAGAMENTO</label>
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={SL}>
                    {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              )}
              {!isMobile && (
                <div>
                  <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>COMANDA</label>
                  <input value={comanda} onChange={e => setComanda(e.target.value)} placeholder="Nº"
                    style={{ ...SL, textAlign: 'center', fontWeight: 700, fontSize: 16 }} />
                </div>
              )}
              {isMobile && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>PAGAMENTO</label>
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={SL}>
                    {PAY_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              )}
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
                {/* Cliente sem gênero + evento com preço diferenciado → palpite pelo nome + confirmação */}
                {(() => {
                  const ev = events.find(e => e.id === selEv)
                  const pm = ev?.price_male_cents ?? 0, pf = ev?.price_female_cents ?? 0
                  if (result.gender || selEv === 'bar' || !(pm > 0 && pf > 0 && pm !== pf)) return null
                  return (
                    <div style={{ background: C.gold + '12', border: `1px solid ${C.gold}33`, borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginBottom: 6 }}>
                        {genderGuess ? '✨ Gênero sugerido pelo nome — confirme ou corrija' : '⚠️ Selecione o gênero para aplicar o valor correto'}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {([['masculino', `♂ ${fmtCurrency(pm)}`, C.acc], ['feminino', `♀ ${fmtCurrency(pf)}`, '#f472b6']] as const).map(([gv, label, col]) => {
                          const on = genderGuess === gv
                          return (
                          <button key={gv} type="button"
                            onClick={async () => {
                              setGenderGuess(gv)
                              if (!selTypeId || selTypeId === 'event-default') setPayAmt(eventPriceFor(gv))
                              await supabase.from('clients').update({ gender: gv }).eq('id', result.id)
                              setResult(r => r ? { ...r, gender: gv } : r)
                            }}
                            style={{ flex: 1, padding: '8px', borderRadius: 8, border: `2px solid ${on ? col : col + '55'}`, background: on ? col + '22' : 'transparent', color: col, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 }}>
                            {label}
                          </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
                {/* Como conheceu a casa — opcional; grava no cliente só se ainda não tiver */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: C.mut, fontWeight: 600, marginBottom: 5 }}>📣 Como conheceu a casa? <span style={{ color: C.brd, fontWeight: 400 }}>(opcional)</span></div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {REFERRAL_CHANNELS.map(ch => {
                      const on = ciReferral === ch.value
                      return (
                        <button key={ch.value} type="button" onClick={() => setCiReferral(on ? '' : ch.value)}
                          style={{ padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${on ? C.gold : C.brd}`, background: on ? C.gold + '22' : 'transparent', color: on ? C.gold : C.mut, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {ch.icon} {ch.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
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
                  <input value={nc.full_name} onChange={e => { const name = e.target.value; setNc(p => ({ ...p, full_name: name, ...(ncGenderTouched ? {} : { gender: guessGenderFromName(name) }) })); if (!ncGenderTouched && (!selTypeId || selTypeId === 'event-default')) setPayAmt(eventPriceFor(guessGenderFromName(name))) }} placeholder="Nome completo *"
                    style={{ background: C.bg2, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit', width: '100%' }} />
                  <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <input value={fcpf(nc.cpf)} onChange={e => setNc(p => ({ ...p, cpf: cn(e.target.value).slice(0, 11) }))} placeholder="CPF"
                      style={{ background: C.bg2, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }} />
                    <input value={ftel(nc.phone)} onChange={e => setNc(p => ({ ...p, phone: cn(e.target.value).slice(0, 11) }))} placeholder="Celular"
                      style={{ background: C.bg2, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, minHeight: 44, fontFamily: 'inherit' }} />
                  </div>
                  <input type="date" min={NASCIMENTO.min} max={NASCIMENTO.max} value={nc.birth_date} onChange={e => setNc(p => ({ ...p, birth_date: e.target.value }))}
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
                  {/* Pesquisa: como conheceu a casa? (opcional, só no cadastro novo) */}
                  <div>
                    <div style={{ fontSize: 12, color: C.mut, fontWeight: 600, marginBottom: 6 }}>📣 Como conheceu a casa? <span style={{ color: C.brd, fontWeight: 400 }}>(opcional)</span></div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {REFERRAL_CHANNELS.map(ch => {
                        const on = nc.referral_source === ch.value
                        return (
                          <button key={ch.value} type="button" onClick={() => setNc(p => ({ ...p, referral_source: on ? '' : ch.value }))}
                            style={{ padding: '8px 12px', borderRadius: 8, border: `2px solid ${on ? C.gold : C.brd}`, background: on ? C.gold + '22' : 'transparent', color: on ? C.gold : C.mut, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', minHeight: 40 }}>
                            {ch.icon} {ch.label}
                          </button>
                        )
                      })}
                    </div>
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
                    : (() => {
                      // Busca pelo nome do CONVIDADO em todas as reservas do evento
                      const q = ciResSearch.trim().toLowerCase()
                      const matches: { g: ReservationGuest; res: Reservation }[] = q
                        ? reservations.flatMap(r => ((r.reservation_guests ?? []) as ReservationGuest[])
                            .filter(g => (g.name ?? '').toLowerCase().includes(q) || (g.phone ?? '').includes(q))
                            .map(g => ({ g, res: r })))
                          .sort((a, b) => {
                            const ci = (a.g.checked_in ? 1 : 0) - (b.g.checked_in ? 1 : 0)
                            return ci !== 0 ? ci : (a.g.name ?? '').localeCompare(b.g.name ?? '', 'pt-BR')
                          })
                        : []
                      return (
                      <>
                        <input value={ciResSearch} onChange={e => setCiResSearch(e.target.value)}
                          placeholder="🔍 Buscar convidado por nome..."
                          style={{ ...SL, width: '100%', marginBottom: q ? 8 : 12, fontSize: 13 }} />

                        {/* Modo busca: convidados de TODAS as reservas que batem com o nome */}
                        {q ? (
                          matches.length === 0
                            ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Nenhum convidado encontrado</div>
                            : <div className="r-scroll-y" style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 2, overscrollBehavior: 'contain' }}>
                                {matches.map(({ g, res }) => reservaGuestRow(g, res, true))}
                              </div>
                        ) : (<>
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
                                    {/* Quem chega sem estar na lista mas entra na contagem.
                                        A funcao ja existia nas outras telas de reserva; faltava aqui. */}
                                    <button onClick={() => openAddGuest(res)} title="Adicionar quem chegou fora da lista"
                                      style={{ background: C.acc + '22', border: `1px solid ${C.acc}55`, borderRadius: 8, width: 30, height: 26, color: C.acc, fontSize: 16, fontWeight: 800, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                      +
                                    </button>
                                  </div>
                                </div>
                                <div style={{ color: C.mut, fontSize: 12, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  {res.phone && <span>📱 {ftel(res.phone)}</span>}
                                  {res.expected_arrival && <span>🕐 {res.expected_arrival.slice(0,5)}</span>}
                                  {res.people_count > 0 && <span>👥 {res.people_count} pessoas</span>}
                                </div>
                                {(() => {
                                  const remaining = (res.amount_cents ?? 0) - (res.deposit_cents ?? 0)
                                  const open = (res.payment_status === 'unpaid' || res.payment_status === 'partial') && remaining > 0
                                  if (!open) return null
                                  return (
                                    <div onClick={() => { setPayRes(res); setPayForm({ amount: (remaining / 100).toFixed(2), method: 'dinheiro' }) }}
                                      title="Registrar recebimento" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, background: '#f8717118', border: '1px solid #f8717155', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                                      <span style={{ color: C.red, fontSize: 13, fontWeight: 800 }}>⚠️ A receber: {fmtCurrency(remaining)}</span>
                                      {(res.deposit_cents ?? 0) > 0 && <span style={{ color: C.mut, fontSize: 11 }}>sinal {fmtCurrency(res.deposit_cents ?? 0)} pago</span>}
                                      <span style={{ marginLeft: 'auto', color: C.grn, fontSize: 12, fontWeight: 800 }}>💵 Receber ›</span>
                                    </div>
                                  )
                                })()}
                              </div>
                              {guests.length === 0
                                ? <div style={{ color: C.mut, fontSize: 12, textAlign: 'center', padding: '14px 0' }}>
                                    <div style={{ fontStyle: 'italic', marginBottom: 8 }}>Nenhum convidado cadastrado nesta reserva</div>
                                    <button onClick={() => openAddGuest(res)}
                                      style={{ background: C.acc + '22', border: `1px solid ${C.acc}55`, borderRadius: 8, padding: '7px 14px', color: C.acc, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                      + Adicionar quem chegou
                                    </button>
                                  </div>
                                : <div className="r-scroll-y" style={{ maxHeight: 308, overflowY: 'auto', paddingRight: 2, overscrollBehavior: 'contain' }}>
                                  {[...guests].sort((a, b) => { const ci = (a.checked_in ? 1 : 0) - (b.checked_in ? 1 : 0); return ci !== 0 ? ci : (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR') }).map(g => reservaGuestRow(g, res))}
                                  </div>
                              }
                            </div>
                          )
                        })()}
                        </>)}
                      </>
                      )
                    })()
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
                    : <>
                        {/* Filtro de lista + busca */}
                        <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                          <select value={selPromoList} onChange={e => setSelPromoList(e.target.value)} style={{ ...SL, fontSize: 12 }}>
                            <option value="all">📋 Todas as listas ({promoGuests.length})</option>
                            {promoLists.map(l => (
                              <option key={l.id} value={l.id}>
                                {l.name}{l.promoter ? ` · ${l.promoter}` : ''}
                              </option>
                            ))}
                          </select>
                          <input value={promoSearch} onChange={e => setPromoSearch(e.target.value)}
                            placeholder="🔍 Buscar nome..." style={{ ...SL, fontSize: 12 }} />
                        </div>
                        {selPromoList !== 'all' && (
                          <div style={{ marginBottom: 10 }}>
                            <button onClick={() => { const l = promoLists.find(x => x.id === selPromoList); if (l) openAddListGuest({ id: l.id, name: l.name }) }}
                              style={{ background: C.acc + '18', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              ➕ Convidado nesta lista
                            </button>
                          </div>
                        )}
                        {filteredGuests.length === 0
                          ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Nenhum convidado encontrado</div>
                          : <div className="r-scroll-y" style={{ maxHeight: 308, overflowY: 'auto', paddingRight: 2, overscrollBehavior: 'contain' }}>
                            {filteredGuests.slice(0, guestShow).map((g, i, arr) => {
                        const pl = g.promoter_lists as { id?: string; name?: string; token?: string; promoters?: { full_name?: string } } | undefined
                        return (
                          <Fragment key={g.id}>
                          {listGroupHeader(g, arr[i - 1])}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10, marginBottom: 6, background: g.checked_in ? C.grn + '0d' : C.bg, border: `1px solid ${g.checked_in ? C.grn + '33' : C.brd + '55'}` }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: g.checked_in ? C.grn : C.mut, flexShrink: 0, boxShadow: g.checked_in ? `0 0 6px ${C.grn}` : 'none' }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: g.checked_in ? C.grn : C.txt, fontWeight: 600, fontSize: 13 }}>
                                {g.full_name}
                                {g.gender && <span style={{ color: g.gender === 'feminino' ? '#f472b6' : C.acc, fontSize: 11, marginLeft: 5 }}>{g.gender === 'feminino' ? '♀' : '♂'}</span>}
                                {g.is_vip && <span style={{ color: C.gold, fontSize: 10, fontWeight: 800, marginLeft: 5 }}>⭐ VIP</span>}
                              </div>
                              <div style={{ color: C.mut, fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {g.phone && <span>📱 {ftel(g.phone)}</span>}
                                {pl?.name && <span>📋 {pl.name}</span>}
                              </div>
                            </div>
                            {g.checked_in
                              ? <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                  <div style={{ color: C.grn, fontSize: 11, fontWeight: 700 }}>✅ Entrou</div>
                                  {g.checked_in_at && <div style={{ color: C.acc, fontSize: 11, fontWeight: 700 }}>🕐 {new Date(g.checked_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>}
                                </div>
                              : (!g.phone || !g.birth_date)
                                ? <button
                                    onClick={() => startPromoCheckin(g)}
                                    style={{ background: C.gold + '22', border: `1px solid ${C.gold}66`, borderRadius: 8, padding: '6px 12px', color: C.gold, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                                    📝 Completar p/ entrar
                                  </button>
                                : <button
                                    onClick={() => startPromoCheckin(g)}
                                    style={{ background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, boxShadow: '0 2px 8px rgba(59,130,246,0.4)' }}>
                                    ✅ Entrada
                                  </button>
                            }
                          </div>
                          </Fragment>
                        )
                      })}
                            {moreBtn(guestShow, filteredGuests.length, () => setGuestShow(n => n + PAGE_STEP))}
                          </div>
                        }
                      </>
                  }
                </div>
              )}
            </Card>

            {/* Recentes — compacto abaixo */}
            <Card style={{ padding: '14px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.txt, marginBottom: 10 }}>⏱ Recentes</div>
              {recent.length === 0
                ? <div style={{ color: C.mut, fontSize: 12 }}>Nenhum ainda</div>
                : recent.slice(0, 8).map((ci, i) => {
                  const dt = new Date(ci.created_at)
                  const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  const mins = Math.floor((Date.now() - dt.getTime()) / 60000)
                  const cl = ci.clients as { full_name?: string } | undefined
                  return (
                    <div key={ci.id || i} style={{ padding: '7px 0', borderBottom: i < Math.min(recent.length, 8) - 1 ? `1px solid ${C.brd}` : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{cl?.full_name ?? 'Visitante'}</div>
                        <div style={{ color: C.mut, fontSize: 11, display: 'flex', gap: 8, marginTop: 1 }}>
                          <span style={{ color: C.acc, fontWeight: 700 }}>🕐 {timeStr}</span>
                          <span>há {mins < 60 ? `${mins}min` : `${Math.floor(mins / 60)}h`}</span>
                        </div>
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
                        <div className="r-scroll-y" style={{ padding: '0 16px 16px', maxHeight: 'min(68vh, 780px)', overflowY: 'scroll', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
                          {filteredRes.length === 0
                            ? <div style={{ color: C.mut, fontSize: 14, textAlign: 'center', padding: 32 }}>Nenhuma reserva encontrada</div>
                            : filteredRes.slice(0, resShow).map(r => {
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
                                        {(() => {
                                          const remaining = (r.amount_cents ?? 0) - (r.deposit_cents ?? 0)
                                          const open = (r.payment_status === 'unpaid' || r.payment_status === 'partial') && remaining > 0
                                          if (!open) return null
                                          return (
                                            <div onClick={() => { setPayRes(r); setPayForm({ amount: (remaining / 100).toFixed(2), method: 'dinheiro' }) }}
                                              title="Registrar recebimento" style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, background: '#f8717118', border: '1px solid #f8717155', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>
                                              <span style={{ color: C.red, fontSize: 12, fontWeight: 800 }}>⚠️ A receber: {fmtCurrency(remaining)}</span>
                                              {(r.deposit_cents ?? 0) > 0 && <span style={{ color: C.mut, fontSize: 11 }}>(sinal {fmtCurrency(r.deposit_cents ?? 0)} pago)</span>}
                                              <span style={{ color: C.grn, fontSize: 11, fontWeight: 800 }}>💵 Receber ›</span>
                                            </div>
                                          )
                                        })()}
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
                                          <button onClick={() => openAddGuest(r)} title="Adicionar convidado fora da lista"
                                            style={{ background: C.acc + '18', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            ➕ Convidado
                                          </button>
                                        </div>
                                        {[...guests].sort((a, b) => { const ci = (a.checked_in ? 1 : 0) - (b.checked_in ? 1 : 0); return ci !== 0 ? ci : (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR') }).map(g => (
                                          <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderRadius: 8, background: g.checked_in ? C.grn + '0d' : C.bg, marginBottom: 4, border: `1px solid ${g.checked_in ? C.grn + '33' : C.brd + '55'}` }}>
                                            <div>
                                              <span style={{ color: g.checked_in ? C.grn : C.txt, fontWeight: 600, fontSize: 14 }}>
                                                {g.checked_in ? '✅' : '○'} {g.name}
                                              </span>
                                              {g.gender && <span style={{ color: g.gender === 'feminino' ? '#f472b6' : C.acc, fontSize: 11, marginLeft: 6 }}>{g.gender === 'feminino' ? '♀' : '♂'}</span>}
                                              {g.is_extra && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: C.acc, background: C.acc + '22', border: `1px solid ${C.acc}55`, borderRadius: 5, padding: '1px 5px', textTransform: 'uppercase' }}>extra</span>}
                                              {g.phone && <span style={{ color: C.mut, fontSize: 11, marginLeft: 8 }}>📱 {ftel(g.phone)}</span>}
                                              {g.checked_in && g.checked_in_at && (
                                                <span style={{ color: C.grn, fontSize: 10, marginLeft: 8 }}>
                                                  {new Date(g.checked_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                              )}
                                            </div>
                                            {!g.checked_in && (
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                                                {(g.phone && g.birth_date)
                                                  ? <button onClick={() => { setPendingCI({ type: 'reserva', guest: g, reservation: r }); setPendingReferral(''); setListComanda(''); const pa = prefilledAmount(r, g); setListAmount(pa); setListPayMethod(parseFloat(pa) > 0 ? 'dinheiro' : 'cortesia') }}
                                                      style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, color: C.acc, borderRadius: 7, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                                      Entrada
                                                    </button>
                                                  : <button onClick={() => { const gg = g.gender || guessGenderFromName(g.name); const pa = prefilledAmount(r, { ...g, gender: gg }); setCompleteKind('reserva'); setCompleteGuest(g); setCompleteForm({ phone: g.phone ?? '', cpf: g.cpf ?? '', birth_date: g.birth_date ?? '', photoDataUrl: '', comanda: '', amount: pa, gender: gg, payment_method: parseFloat(pa) > 0 ? 'dinheiro' : 'cortesia', referral_source: '' }) }}
                                                      style={{ background: C.gold + '11', border: `1px solid ${C.gold}44`, color: C.gold, borderRadius: 7, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                                      📝 Completar p/ entrar
                                                    </button>
                                                }
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                          <div style={{ color: C.mut, fontSize: 12 }}>
                                            ⚠️ Nenhum convidado pré-cadastrado. Compartilhe o link ou adicione na hora:
                                          </div>
                                          <button onClick={() => openAddGuest(r)} title="Adicionar convidado fora da lista"
                                            style={{ background: C.acc + '18', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            ➕ Convidado
                                          </button>
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
                          {moreBtn(resShow, filteredRes.length, () => setResShow(n => n + 60))}
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
                          {/* Aviso de virada de preço da lista (VIP até X, depois cobra) */}
                          {(() => {
                            const ev = events.find(e => e.id === selEv)
                            if (!ev?.list_cutoff_time) return null
                            const cutM = listCutoffCentsNow(ev, false) // masc como referência p/ status
                            const cutF = listCutoffCentsNow(ev, true)
                            const [cH, cM] = ev.list_cutoff_time.split(':').map(Number)
                            const toMin = (h: number, m: number) => ((h < 12 ? h + 24 : h) * 60 + m)
                            const now = new Date()
                            const before = toMin(now.getHours(), now.getMinutes()) <= toMin(cH, cM || 0)
                            const fmtC = (c: number | null) => (c ?? 0) === 0 ? 'grátis' : fmtCurrency(c ?? 0)
                            return (
                              <div style={{ background: before ? C.grn + '14' : C.gold + '14', border: `1px solid ${before ? C.grn : C.gold}44`, borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 12 }}>
                                <div style={{ fontWeight: 800, color: before ? C.grn : C.gold, marginBottom: 2 }}>
                                  {before ? `⭐ Lista promocional até ${ev.list_cutoff_time}` : `💲 Após ${ev.list_cutoff_time} — cobrando preço cheio`}
                                </div>
                                <div style={{ color: C.mut }}>
                                  Agora: ♂ {fmtC(cutM)} · ♀ {fmtC(cutF)} <span style={{ opacity: 0.7 }}>(pré-preenchido no check-in)</span>
                                </div>
                              </div>
                            )
                          })()}
                          {/* Nível 1: escolher a lista (como as reservas). Nível 2: convidados da lista escolhida. */}
                          {promoGuests.length === 0 ? (
                            <div style={{ color: C.mut, fontSize: 14, textAlign: 'center', padding: 32 }}>Nenhum convidado nas listas ainda.</div>
                          ) : selPromoList === 'all' ? (
                            <div style={{ display: 'grid', gap: 8 }}>
                              {promoLists.map(l => {
                                const gs = promoGuests.filter(g => g.list_id === l.id)
                                const entered = gs.filter(g => g.checked_in).length
                                return (
                                  <button key={l.id} onClick={() => { setSelPromoList(l.id); setPromoSearch(''); setGuestShow(PAGE_STEP) }}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📋 {l.name}</div>
                                      {l.promoter && <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>👤 {l.promoter}</div>}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                                      <span style={{ background: C.grn + '18', color: C.grn, border: `1px solid ${C.grn}44`, borderRadius: 8, padding: '3px 10px', fontSize: 12, fontWeight: 800 }}>{entered}/{gs.length}</span>
                                      <span style={{ color: C.mut, fontSize: 16 }}>▶</span>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                <button onClick={() => { setSelPromoList('all'); setPromoSearch('') }}
                                  style={{ background: 'none', border: `1px solid ${C.brd}`, color: C.txt, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>← Listas</button>
                                <span style={{ color: C.txt, fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📋 {promoLists.find(x => x.id === selPromoList)?.name ?? 'Lista'}</span>
                                <button onClick={() => { const l = promoLists.find(x => x.id === selPromoList); if (l) openAddListGuest({ id: l.id, name: l.name }) }}
                                  style={{ background: C.acc + '18', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}>➕ Convidado</button>
                              </div>
                              <input value={promoSearch} onChange={e => setPromoSearch(e.target.value)}
                                placeholder="🔍 Buscar nome ou telefone" style={{ ...SL, fontSize: 12, width: '100%', boxSizing: 'border-box', marginBottom: 12 }} />
                            </>
                          )}
                          {selPromoList !== 'all' && <div className="r-scroll-y" style={{ maxHeight: 'min(70vh, 1240px)', overflowY: 'scroll', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
                          {filteredGuests.length === 0
                            ? <div style={{ color: C.mut, fontSize: 14, textAlign: 'center', padding: 32 }}>Nenhum convidado encontrado</div>
                            : filteredGuests.slice(0, guestShow).map((g, i, arr) => {
                                const pl = g.promoter_lists as { id?: string; name?: string; token?: string; promoters?: { full_name?: string } } | undefined
                                const listaLink = pl?.token ? `${window.location.origin}/lista/${pl.token}` : null
                                return (
                                  <Fragment key={g.id}>
                                  {listGroupHeader(g, arr[i - 1])}
                                  <div style={{ marginBottom: 10, border: `1px solid ${g.checked_in ? C.grn + '44' : C.brd}`, borderRadius: 14, padding: 14 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                          <span style={{ color: C.txt, fontWeight: 800, fontSize: 15 }}>{g.full_name}</span>
                                          {g.gender && <span style={{ color: g.gender === 'feminino' ? '#f472b6' : C.acc, fontSize: 11, fontWeight: 700 }}>{g.gender === 'feminino' ? '♀' : '♂'}</span>}
                                          {g.is_vip && <span style={{ color: C.gold, fontSize: 10, fontWeight: 800 }}>⭐ VIP</span>}
                                          {g.is_extra && <span style={{ fontSize: 9, fontWeight: 800, color: C.acc, background: C.acc + '22', border: `1px solid ${C.acc}55`, borderRadius: 5, padding: '1px 5px', textTransform: 'uppercase' }}>extra</span>}
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
                                        {!g.checked_in && ((!g.phone || !g.birth_date)
                                          ? <button onClick={() => startPromoCheckin(g)} style={{ background: C.gold + '22', border: `1px solid ${C.gold}66`, borderRadius: 8, padding: '7px 12px', color: C.gold, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📝 Completar p/ entrar</button>
                                          : <Btn onClick={() => startPromoCheckin(g)} style={{ fontSize: 13 }}>✅ Entrada</Btn>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  </Fragment>
                                )
                              })
                          }
                          {moreBtn(guestShow, filteredGuests.length, () => setGuestShow(n => n + PAGE_STEP))}
                          </div>}
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
              <div style={{ color: C.txt, fontWeight: 800, fontSize: 18, marginBottom: 2 }}>{scanned.ticket_orders?.buyer_name ?? scanned.holder_name}</div>
              {/* CPF mascarado: o porteiro confere contra o documento sem o app expor o número inteiro */}
              {scanned.ticket_orders?.buyer_cpf && (
                <div style={{ color: C.gold, fontSize: 14, fontWeight: 700, fontFamily: 'monospace', marginBottom: 6 }}>
                  🪪 {maskCpf(scanned.ticket_orders.buyer_cpf)}
                </div>
              )}
              {scanned.ticket_orders?.ticket_batches?.name && (
                <div style={{ display: 'inline-block', background: C.acc + '1f', border: `1px solid ${C.acc}55`, color: C.acc, borderRadius: 999, padding: '3px 12px', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
                  {scanned.ticket_orders.ticket_batches.name}
                </div>
              )}
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

          {/* Plano B: câmera sem permissão, tela do cliente trincada, QR ilegível.
              O código de 8 caracteres aparece embaixo do QR na tela do comprador. */}
          <Card style={{ marginTop: 16 }}>
            <div style={{ color: C.mut, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
              CÂMERA NÃO FUNCIONOU? DIGITE O CÓDIGO
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8))}
                onKeyDown={e => { if (e.key === 'Enter') buscarPorCodigo() }}
                placeholder="ex: A1B2C3D4"
                style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 14px', color: C.txt, fontSize: 16, fontFamily: 'monospace', letterSpacing: '0.12em', textTransform: 'uppercase' as const, boxSizing: 'border-box' as const }}
              />
              <Btn onClick={buscarPorCodigo} disabled={codeInput.length < 8 || buscandoCod}>
                {buscandoCod ? '...' : '🔎'}
              </Btn>
            </div>
            <div style={{ color: C.mut, fontSize: 11, marginTop: 8 }}>
              São os 8 caracteres que aparecem abaixo do QR code, na tela do cliente.
            </div>
          </Card>
        </div>
      )}

      {/* ── EQUIPE / FREELANCERS ── */}
      {mode === 'equipe' && (
        <div>
          {selEv === 'bar' ? (
            <Card>
              <div style={{ color: C.mut, fontSize: 14, textAlign: 'center', padding: 30 }}>
                Selecione um evento na aba Portaria para ver a equipe escalada.
              </div>
            </Card>
          ) : (
            <>
              {/* Resumo da equipe */}
              {(() => {
                const total = eventFreelancers.length
                const present = eventFreelancers.filter(e => e.checkin_at).length
                const out = eventFreelancers.filter(e => e.checkout_at).length
                const cards = [
                  { icon: '👷', label: 'Escalados', val: String(total), color: C.acc },
                  { icon: '🟢', label: 'Presentes', val: String(present), color: C.grn },
                  { icon: '👋', label: 'Saíram', val: String(out), color: C.gold },
                ]
                return (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
                    {cards.map((c, i) => (
                      <div key={i} style={{ flex: '1 1 150px', background: C.bg, border: `1px solid ${c.color}33`, borderTop: `3px solid ${c.color}`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 24 }}>{c.icon}</span>
                        <div>
                          <div style={{ color: c.color, fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{c.val}</div>
                          <div style={{ color: C.mut, fontSize: 11, fontWeight: 600, marginTop: 3 }}>{c.label}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}

              <Card>
                <input value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
                  placeholder="🔍 Buscar freelancer por nome ou função..."
                  style={{ ...SL, marginBottom: 14 }} />

                {loadingTeam ? (
                  <div style={{ color: C.mut, textAlign: 'center', padding: 24 }}>Carregando equipe...</div>
                ) : eventFreelancers.length === 0 ? (
                  <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0', border: `1px dashed ${C.brd}`, borderRadius: 10 }}>
                    Nenhum freelancer escalado para este evento. Escale a equipe na aba Eventos › Produção.
                  </div>
                ) : (
                  eventFreelancers
                    .filter(ef => {
                      const s = teamSearch.toLowerCase()
                      return !s || (ef.freelancers?.full_name ?? '').toLowerCase().includes(s) || (ef.role ?? '').toLowerCase().includes(s)
                    })
                    .map((ef, i, arr) => {
                      const present = !!ef.checkin_at
                      const out = !!ef.checkout_at
                      const inTime = ef.checkin_at ? new Date(ef.checkin_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
                      const outTime = ef.checkout_at ? new Date(ef.checkout_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
                      const shift = ef.freelancers?.work_meta?.shift_hours
                      return (
                        <div key={ef.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < arr.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
                          <div style={{ width: 42, height: 42, borderRadius: '50%', background: (out ? C.gold : present ? C.grn : C.acc) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                            {out ? '👋' : present ? '🟢' : '👷'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>{ef.freelancers?.full_name ?? 'Freelancer'}</div>
                            <div style={{ color: C.mut, fontSize: 12, marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {ef.role && <span style={{ background: C.acc + '18', color: C.acc, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{ef.role}</span>}
                              {shift && <span>⏱ {shift}h</span>}
                              {ef.entry_time && <span>🕐 prev. {ef.entry_time.slice(0, 5)}</span>}
                              {inTime && <span style={{ color: C.grn, fontWeight: 600 }}>✅ Entrou {inTime}</span>}
                              {outTime && <span style={{ color: C.gold, fontWeight: 600 }}>👋 Saiu {outTime}</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            {!present ? (
                              <Btn onClick={() => teamCheckin(ef)} small>✅ Entrada</Btn>
                            ) : !out ? (
                              <Btn onClick={() => teamCheckout(ef)} small variant="secondary">👋 Saída</Btn>
                            ) : (
                              <span style={{ color: C.grn, fontSize: 12, fontWeight: 700, alignSelf: 'center' }}>✔ Completo</span>
                            )}
                            {present && (
                              <Btn onClick={() => teamUndo(ef)} small variant="ghost" title="Desfazer">↩</Btn>
                            )}
                          </div>
                        </div>
                      )
                    })
                )}
              </Card>
            </>
          )}
        </div>
      )}


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
            <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
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
                  💰 Valor Entrada
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  style={{ ...SL, fontSize: 18, fontWeight: 700, textAlign: 'center', borderColor: C.gold + '55' }}
                  placeholder="R$ 0,00"
                  value={listAmount}
                  onChange={e => {
                    // permite apenas números e vírgula/ponto
                    const raw = e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')
                    setListAmount(raw)
                    setListPayMethod(raw && parseFloat(raw) > 0 ? listPayMethod : 'cortesia')
                  }}
                />
              </div>
            </div>
            {/* Forma de pagamento */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>FORMA DE PAGAMENTO</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PAY_METHODS.map(m => (
                  <button key={m.value} onClick={() => {
                    setListPayMethod(m.value)
                    if (m.value === 'cortesia') setListAmount('0')
                  }}
                    style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${listPayMethod === m.value ? C.acc : C.brd}`, background: listPayMethod === m.value ? C.acc + '22' : 'transparent', color: listPayMethod === m.value ? C.acc : C.mut, fontSize: 12, fontWeight: listPayMethod === m.value ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Canal de aquisição — "como conheceu?" (grava só p/ cliente novo) */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>📣 COMO CONHECEU? <span style={{ fontWeight: 400 }}>(cliente novo)</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {REFERRAL_CHANNELS.map(ch => (
                  <button key={ch.value} type="button" onClick={() => setPendingReferral(p => p === ch.value ? '' : ch.value)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${pendingReferral === ch.value ? C.acc : C.brd}`, background: pendingReferral === ch.value ? C.acc + '22' : 'transparent', color: pendingReferral === ch.value ? C.acc : C.mut, fontSize: 12, fontWeight: pendingReferral === ch.value ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {ch.icon} {ch.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={async () => {
                  const amtCents = listPayMethod === 'cortesia' ? 0 : Math.round((parseFloat(listAmount) || 0) * 100)
                  const g = { ...pendingCI.guest as ReservationGuest & PromoterGuest, comanda: listComanda || undefined, amount_cents: amtCents, payment_method: listPayMethod, referral_source: pendingReferral || undefined }
                  setPendingCI(null)
                  if (pendingCI.type === 'reserva') await checkInReservaGuest(g as ReservationGuest & { comanda?: string; amount_cents?: number; payment_method?: string })
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

      {/* ── Modal Receber valor da reserva ── */}
      {payRes && (() => {
        const total = payRes.amount_cents ?? 0
        const already = payRes.deposit_cents ?? 0
        const remaining = total - already
        const methods: Array<[string, string]> = [['dinheiro', '💵 Dinheiro'], ['pix', '⚡ Pix'], ['cartao', '💳 Cartão']]
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
            onClick={() => setPayRes(null)}>
            <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 20, width: '100%', maxWidth: 380, padding: 24 }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontWeight: 800, fontSize: 17, color: C.txt, marginBottom: 2 }}>💵 Receber reserva</div>
              <div style={{ color: C.acc, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{payRes.name}</div>
              <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.mut }}><span>Total da reserva</span><span style={{ fontWeight: 700, color: C.txt }}>{fmtCurrency(total)}</span></div>
                {already > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.mut }}><span>Sinal pago</span><span style={{ fontWeight: 700 }}>{fmtCurrency(already)}</span></div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: C.red, fontWeight: 700 }}>A receber</span><span style={{ fontWeight: 800, color: C.red }}>{fmtCurrency(remaining)}</span></div>
              </div>
              <label style={{ fontSize: 12, color: C.gold, fontWeight: 600, display: 'block', marginBottom: 6 }}>💰 Valor recebido (R$)</label>
              <input type="number" min="0" step="0.01" autoFocus value={payForm.amount}
                onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                style={{ ...SL, fontSize: 18, fontWeight: 700, textAlign: 'center', borderColor: C.gold + '55', marginBottom: 16 }} placeholder="0,00" />
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>Forma de pagamento</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                {methods.map(([k, lbl]) => (
                  <button key={k} onClick={() => setPayForm(p => ({ ...p, method: k }))}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: `2px solid ${payForm.method === k ? C.acc : C.brd}`, background: payForm.method === k ? C.acc + '22' : 'transparent', color: payForm.method === k ? C.acc : C.mut, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {lbl}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={receberReserva}
                  style={{ flex: 1, background: 'linear-gradient(135deg,#10b981,#059669)', border: 'none', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 800, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✅ Confirmar recebimento
                </button>
                <button onClick={() => setPayRes(null)}
                  style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 16px', color: C.mut, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Modal: adicionar convidado extra (fora da lista) a uma reserva ou lista ── */}
      {(addToRes || addToList) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setAddToRes(null); setAddToList(null) }}>
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 20, width: '100%', maxWidth: 460, maxHeight: '90vh', overflow: 'auto', padding: 24 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 17, color: C.txt }}>➕ Adicionar convidado</div>
              <button onClick={() => { setAddToRes(null); setAddToList(null) }} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ color: C.acc, fontWeight: 700, fontSize: 13, marginBottom: 16 }}>{addToRes ? `🪑 Reserva de ${addToRes.name}` : `📋 Lista ${addToList?.name}`}</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>NOME *</label>
                <input value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))} placeholder="Nome do convidado" style={{ ...SL }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>CELULAR *</label>
                  <input value={ftel(addForm.phone)} onChange={e => setAddForm(p => ({ ...p, phone: cn(e.target.value).slice(0, 11) }))} placeholder="(00) 00000-0000" style={{ ...SL }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>NASCIMENTO *</label>
                  <input type="date" min={NASCIMENTO.min} max={NASCIMENTO.max} value={addForm.birth_date} onChange={e => setAddForm(p => ({ ...p, birth_date: e.target.value }))} style={{ ...SL }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>CPF (opcional)</label>
                <input value={fcpf(addForm.cpf)} onChange={e => setAddForm(p => ({ ...p, cpf: cn(e.target.value).slice(0, 11) }))} placeholder="000.000.000-00" style={{ ...SL }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>GÊNERO</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([['masculino', '♂ Masculino', C.acc], ['feminino', '♀ Feminino', '#f472b6']] as const).map(([gv, label, col]) => {
                    const on = addForm.gender === gv
                    return (
                      <button key={gv} type="button" onClick={() => setAddForm(p => ({ ...p, gender: gv }))}
                        style={{ flex: 1, padding: '10px', borderRadius: 10, border: `2px solid ${on ? col : C.brd}`, background: on ? col + '22' : 'transparent', color: on ? col : C.mut, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 500 }}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🎫 COMANDA</label>
                  <input value={addForm.comanda} onChange={e => setAddForm(p => ({ ...p, comanda: e.target.value }))} placeholder="Ex: 42" style={{ ...SL, textAlign: 'center', fontWeight: 700, fontSize: 16, letterSpacing: 3 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: C.gold, fontWeight: 600, display: 'block', marginBottom: 4 }}>💰 VALOR ENTRADA</label>
                  <input value={addForm.amount} inputMode="decimal"
                    onChange={e => { const raw = e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'); setAddForm(p => ({ ...p, amount: raw, payment_method: raw && parseFloat(raw) > 0 ? (p.payment_method === 'cortesia' ? 'dinheiro' : p.payment_method) : 'cortesia' })) }}
                    placeholder="R$ 0,00" style={{ ...SL, textAlign: 'center', fontWeight: 700, fontSize: 16, borderColor: C.gold + '55' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>FORMA DE PAGAMENTO</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PAY_METHODS.map(m => (
                    <button key={m.value} type="button" onClick={() => setAddForm(p => ({ ...p, payment_method: m.value, amount: m.value === 'cortesia' ? '0' : p.amount }))}
                      style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${addForm.payment_method === m.value ? C.acc : C.brd}`, background: addForm.payment_method === m.value ? C.acc + '22' : 'transparent', color: addForm.payment_method === m.value ? C.acc : C.mut, fontSize: 12, fontWeight: addForm.payment_method === m.value ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>📣 COMO CONHECEU? <span style={{ fontWeight: 400 }}>(cliente novo)</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {REFERRAL_CHANNELS.map(ch => (
                    <button key={ch.value} type="button" onClick={() => setAddForm(p => ({ ...p, referral_source: p.referral_source === ch.value ? '' : ch.value }))}
                      style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${addForm.referral_source === ch.value ? C.acc : C.brd}`, background: addForm.referral_source === ch.value ? C.acc + '22' : 'transparent', color: addForm.referral_source === ch.value ? C.acc : C.mut, fontSize: 12, fontWeight: addForm.referral_source === ch.value ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {ch.icon} {ch.label}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => addToRes ? saveAddGuest() : saveAddListGuest()} disabled={addSaving}
                style={{ width: '100%', background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 800, cursor: addSaving ? 'default' : 'pointer', opacity: addSaving ? 0.6 : 1, fontFamily: 'inherit', marginTop: 4 }}>
                {addSaving ? 'Salvando…' : '✅ Adicionar e dar entrada'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Check-in da Equipe (aberto pela Portaria) ── */}
      {teamModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setTeamModalOpen(false)}>
          <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 20, width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 20 }}
            onClick={e => e.stopPropagation()}>
            {(() => {
              const present = eventFreelancers.filter(e => e.checkin_at).length
              const total = eventFreelancers.length
              const pend = total - present
              return (<>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ fontWeight: 800, fontSize: 17, color: C.txt }}>👷 Check-in da Equipe</div>
                  <button onClick={() => setTeamModalOpen(false)} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>
                <div style={{ color: C.mut, fontSize: 12, marginBottom: 12 }}>{present}/{total} presentes · equipe escalada para o evento</div>
                {(() => {
                  const outPend = eventFreelancers.filter(e => e.checkin_at && !e.checkout_at).length
                  if (pend === 0 && outPend === 0) return null
                  return (
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      {pend > 0 && (
                        <button onClick={teamCheckinAll} disabled={teamAllBusy}
                          style={{ flex: 1, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px', fontSize: 13.5, fontWeight: 800, cursor: teamAllBusy ? 'default' : 'pointer', opacity: teamAllBusy ? 0.6 : 1, fontFamily: 'inherit' }}>
                          {teamAllBusy ? '…' : `✅ Entrada de todos (${pend})`}
                        </button>
                      )}
                      {outPend > 0 && (
                        <button onClick={teamCheckoutAll} disabled={teamAllBusy}
                          style={{ flex: 1, background: C.gold + '22', color: C.gold, border: `1px solid ${C.gold}55`, borderRadius: 10, padding: '11px', fontSize: 13.5, fontWeight: 800, cursor: teamAllBusy ? 'default' : 'pointer', opacity: teamAllBusy ? 0.6 : 1, fontFamily: 'inherit' }}>
                          {teamAllBusy ? '…' : `👋 Saída de todos (${outPend})`}
                        </button>
                      )}
                    </div>
                  )
                })()}
                <input value={teamSearch} onChange={e => setTeamSearch(e.target.value)} placeholder="🔍 Buscar por nome ou função..."
                  style={{ ...SL, marginBottom: 12 }} />
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {eventFreelancers.length === 0
                    ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>Nenhum freelancer escalado. Escale a equipe em Eventos › Produção.</div>
                    : eventFreelancers
                        .filter(ef => { const s = teamSearch.toLowerCase(); return !s || (ef.freelancers?.full_name ?? '').toLowerCase().includes(s) || (ef.role ?? '').toLowerCase().includes(s) })
                        .map((ef, i, arr) => {
                          const isIn = !!ef.checkin_at; const isOut = !!ef.checkout_at
                          const inT = ef.checkin_at ? new Date(ef.checkin_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
                          const outT = ef.checkout_at ? new Date(ef.checkout_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
                          const worked = (ef.checkin_at && ef.checkout_at) ? (new Date(ef.checkout_at).getTime() - new Date(ef.checkin_at).getTime()) / 3600000 : null
                          return (
                            <div key={ef.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < arr.length - 1 ? `1px solid ${C.brd}55` : 'none' }}>
                              <span style={{ fontSize: 18, flexShrink: 0 }}>{isOut ? '👋' : isIn ? '🟢' : '👷'}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ef.freelancers?.full_name ?? 'Freelancer'}</div>
                                <div style={{ color: C.mut, fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                                  {ef.role && <span style={{ background: C.acc + '18', color: C.acc, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{ef.role}</span>}
                                  {inT && <span style={{ color: C.grn, fontWeight: 600 }}>✅ {inT}</span>}
                                  {outT && <span style={{ color: C.gold, fontWeight: 600 }}>👋 {outT}</span>}
                                  {worked != null && <span style={{ color: C.acc, fontWeight: 700 }}>⏱ {worked.toFixed(1)}h</span>}
                                </div>
                              </div>
                              <div style={{ flexShrink: 0 }}>
                                {!isIn ? <Btn onClick={() => teamCheckin(ef)} small>✅ Entrada</Btn>
                                  : !isOut ? <Btn onClick={() => teamCheckout(ef)} small variant="secondary">👋 Saída</Btn>
                                  : <span style={{ color: C.grn, fontSize: 12, fontWeight: 700 }}>✔ Completo</span>}
                              </div>
                            </div>
                          )
                        })}
                </div>
              </>)
            })()}
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
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>TELEFONE *</label>
                <input value={ftel(completeForm.phone)} onChange={e => setCompleteForm(p => ({ ...p, phone: cn(e.target.value).slice(0, 11) }))} placeholder="(00) 00000-0000"
                  style={{ ...SL }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>CPF</label>
                <input value={fcpf(completeForm.cpf)} onChange={e => setCompleteForm(p => ({ ...p, cpf: cn(e.target.value).slice(0, 11) }))} placeholder="000.000.000-00"
                  style={{ ...SL }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>DATA DE NASCIMENTO *</label>
                <input type="date" min={NASCIMENTO.min} max={NASCIMENTO.max} value={completeForm.birth_date} onChange={e => setCompleteForm(p => ({ ...p, birth_date: e.target.value }))}
                  style={{ ...SL }} />
              </div>

              {/* Gênero — define o valor por gênero quando a lista cobra preços diferentes */}
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>GÊNERO</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([['masculino', '♂ Masculino', C.acc], ['feminino', '♀ Feminino', '#f472b6']] as const).map(([gv, label, col]) => {
                    const on = completeForm.gender === gv
                    return (
                      <button key={gv} type="button"
                        onClick={() => {
                          const res = reservations.find(r => (r.reservation_guests ?? []).some(x => x.id === completeGuest.id))
                          const newAmount = res ? prefilledAmount(res, { ...completeGuest, gender: gv } as ReservationGuest) : completeForm.amount
                          setCompleteForm(p => ({ ...p, gender: gv, amount: newAmount }))
                        }}
                        style={{ flex: 1, padding: '10px', borderRadius: 10, border: `2px solid ${on ? col : C.brd}`, background: on ? col + '22' : 'transparent', color: on ? col : C.mut, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: on ? 700 : 500 }}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Camera section */}
              <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 10 }}>FOTO</label>

                {completeForm.photoDataUrl ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                    <img loading="lazy" decoding="async" src={completeForm.photoDataUrl} alt="Foto capturada" style={{ width: '100%', maxWidth: 280, borderRadius: 12, border: `1px solid ${C.brd}` }} />
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
                  <label style={{ fontSize: 11, color: C.gold, fontWeight: 600, display: 'block', marginBottom: 4 }}>💰 VALOR ENTRADA</label>
                  <input type="text" inputMode="decimal" value={completeForm.amount}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.')
                      setCompleteForm(p => ({ ...p, amount: raw, payment_method: raw && parseFloat(raw) > 0 ? (p.payment_method === 'cortesia' ? 'dinheiro' : p.payment_method) : 'cortesia' }))
                    }}
                    placeholder="R$ 0,00"
                    style={{ ...SL, textAlign: 'center', fontWeight: 700, fontSize: 16, borderColor: C.gold + '55' }} />
                </div>
              </div>

              {/* Forma de pagamento */}
              <div style={{ marginTop: 4 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>FORMA DE PAGAMENTO</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PAY_METHODS.map(m => (
                    <button key={m.value} type="button" onClick={() => {
                      setCompleteForm(p => ({ ...p, payment_method: m.value, amount: m.value === 'cortesia' ? '0' : p.amount }))
                    }}
                      style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${completeForm.payment_method === m.value ? C.acc : C.brd}`, background: completeForm.payment_method === m.value ? C.acc + '22' : 'transparent', color: completeForm.payment_method === m.value ? C.acc : C.mut, fontSize: 12, fontWeight: completeForm.payment_method === m.value ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Canal de aquisição — "como conheceu?" (grava só p/ cliente novo) */}
              <div style={{ borderTop: `1px solid ${C.brd}`, paddingTop: 14 }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>📣 COMO CONHECEU? <span style={{ fontWeight: 400 }}>(cliente novo)</span></label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {REFERRAL_CHANNELS.map(ch => (
                    <button key={ch.value} type="button" onClick={() => setCompleteForm(p => ({ ...p, referral_source: p.referral_source === ch.value ? '' : ch.value }))}
                      style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${completeForm.referral_source === ch.value ? C.acc : C.brd}`, background: completeForm.referral_source === ch.value ? C.acc + '22' : 'transparent', color: completeForm.referral_source === ch.value ? C.acc : C.mut, fontSize: 12, fontWeight: completeForm.referral_source === ch.value ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {ch.icon} {ch.label}
                    </button>
                  ))}
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
