import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal, Pill } from '../components/ui'
import { fd, fmtCurrency } from '../utils/format'
import { fmtWAPhone, sendWADirect, notifyTaskAssigned } from '../utils/whatsapp'
import { parseGuestsXlsx } from '../utils/importGuests'
import { sT, _err, type ToastState } from '../utils/toast'
import { esperadoDaReserva } from '../utils/reservas'
import type { House, Event, ArtistEntry, PromotionEntry, PromoterPriceMode, Freelancer, EventFreelancer, TicketBatch, TicketOrder } from '../types'
import { DEFAULT_AREAS, areaMeta, type WorkArea } from '../constants/areas'
import { canUseFeature } from '../constants/permissions'

function fmtMoneyInput(v: number | string): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')) || 0
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function parseMoneyInput(raw: string): number {
  return parseInt(raw.replace(/\D/g, '') || '0', 10) / 100
}
// Mostra "R$ x,xx" quando preenchido; vazio quando 0 (para o placeholder de exemplo aparecer)
function moneyVal(v: number | string): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')) || 0
  return n > 0 ? `R$ ${fmtMoneyInput(n)}` : ''
}

interface Props { house: House; role?: string; allowedPages?: string[]; onGoToReservas?: (date: string, eventId: string) => void }

/**
 * Contadores calculados na tela para os cards. NAO sao colunas de `events`.
 *
 * Ficam em uma interface propria porque o formulario de edicao carrega o evento
 * inteiro (`setForm({ ...ev })`) e o payload de gravacao precisa remove-los: o
 * PostgREST recusa o UPDATE INTEIRO se receber um campo que nao e coluna, com a
 * mensagem "Could not find the 'X' column of 'events' in the schema cache".
 */
interface EventUiCounts {
  checkinCount?: number
  pagantesCount?: number
  cortesiasCount?: number
  resCount?: number
  resPeople?: number
  listGuests?: number
  tasksTotal?: number
  tasksDone?: number
  teamTotal?: number
  teamOk?: number
  teamByArea?: Record<string, number>
}

interface EventWithCounts extends Event, EventUiCounts {}

/**
 * Campos removidos do payload antes de gravar.
 *
 * Antes isso era uma lista solta dentro do save(), e apodreceu: ao entrar os
 * contadores de equipe ninguem lembrou de atualiza-la, e `teamByArea` passou a
 * derrubar toda edicao de evento em producao. A checagem de cobertura logo abaixo
 * transforma esse esquecimento em erro de compilacao.
 */
const CAMPOS_SO_DA_TELA = [
  'checkinCount', 'pagantesCount', 'cortesiasCount', 'resCount', 'resPeople',
  'listGuests', 'tasksTotal', 'tasksDone', 'teamTotal', 'teamOk', 'teamByArea',
] as const

// Se um campo novo entrar em EventUiCounts e nao entrar na lista acima, esta linha
// para de compilar. E o ponto: falhar no build, nao na porta da casa.
type FaltandoNaLista = Exclude<keyof EventUiCounts, typeof CAMPOS_SO_DA_TELA[number]>
const _todosCobertos: FaltandoNaLista extends never ? true : never = true
void _todosCobertos

interface Guest {
  id?: string
  list_id?: string
  full_name: string
  phone?: string
  gender?: string
  birth_date?: string
  list_type?: string
  is_vip?: boolean
  checked_in?: boolean
  promoter_id?: string
  invite_token?: string
  list_value_cents?: number
  max_plus_ones?: number
  invited_by?: string
  confirmed_at?: string
}

interface ResItem {
  id: string
  name: string
  people_count?: number
  location?: string
  amount_cents?: number
  expected_arrival?: string
  status: string
  arrived_at?: string
}

interface EventTask {
  id: string; event_id: string; area: string; area_icon: string
  title: string; description?: string; deadline?: string
  assignee_name?: string; assignee_phone?: string
  status: 'pending' | 'done'; notes?: string; token: string
  freelancer_id?: string; estimated_cost_cents?: number; actual_cost_cents?: number
  sort_order: number; completed_at?: string; completed_by?: string
}
interface ProdReservation {
  id: string; name: string; location?: string; people_count?: number
  amount_cents?: number; status: string; observations?: string
  archived_at?: string | null
  reservation_items?: Array<{ name: string; quantity: number; unit_cost_cents: number }>
}

const GENRES = ['Sertanejo', 'Samba', 'Pagode', 'Forró', 'Funk', 'Eletrônico', 'Axé', 'MPB', 'Pop', 'Rock', 'Outros']
const REPT = [
  { v: 'none', l: 'Sem repetição' },
  { v: 'weekly', l: 'Semanal' },
  { v: 'biweekly', l: 'Quinzenal' },
  { v: 'monthly', l: 'Mensal' },
]

const STATUS_COLOR: Record<string, string> = { pending: '#f59e0b', confirmed: '#10b981', arrived: '#3b82f6', cancelled: '#f87171' }
const STATUS_LABEL: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', arrived: 'Chegou', cancelled: 'Cancelado' }

const DEF = {
  name: '', event_date: '', genre: 'Sertanejo', start_time: '22:00', end_time: '04:00',
  price_male_cents: 0, price_female_cents: 0, price_male_list_cents: 0, price_female_list_cents: 0,
  list_cutoff_time: '', price_male_list_early_cents: 0, price_female_list_early_cents: 0,
  promotions: '', repeat_rule: 'none', capacity: '', birthday_list_enabled: false, house_list_enabled: false,
  promoter_enabled: false, promoter_invites: [] as string[], promoter_price_mode: 'list', promoter_price_cents: 0,
  attractions: '', flyer_url: '', observations: '',
  artist_fee_cents: 0, artist_fee_type: 'fixed', artist_fee_percent: 0,
  consumption_cents: 0, production_cost_cents: 0, status: 'ativo',
}
const RDEF2 = { name: '', people_count: '2', location: '', amount_cents: '', expected_arrival: '22:00' }

function evStatusColor(s: string) {
  return s === 'ativo' ? C.grn : s === 'cancelado' ? C.red : C.mut
}

/** 'YYYY-MM-DD' de hoje no fuso local. toISOString() daria UTC e viraria o dia
 *  depois das 21h (BRT) — justamente o horário de operação da casa. */
function hojeLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Reserva arquivada saiu da operação (é assim que a aba Reservas "exclui").
 *  Só desconsidera em evento de hoje/futuro: no passado o arquivamento é automático
 *  por data (Reservas.autoArchivePast) e descartar zeraria o histórico. */
function reservaConta(r: { archived_at?: string | null }, evDate: string) {
  return !r.archived_at || evDate < hojeLocal()
}

/** timestamptz do banco → 'YYYY-MM-DDTHH:mm' local, formato que o input datetime-local aceita */
function toLocalInput(iso: string) {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function EventsPage({ house, role, allowedPages, onGoToReservas }: Props) {
  // Admin/super_admin têm acesso total; demais respeitam as sub-permissões da página Eventos
  const isFullAccess = role === 'admin' || role === 'super_admin'
  const canFeat = (feature: string) => isFullAccess || canUseFeature(allowedPages, 'events', feature)
  const [events, setEvents] = useState<EventWithCounts[]>([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Record<string, unknown>>(DEF)
  const [editing, setEditing] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [ldg, setLdg] = useState(true)
  const [selDate, setSelDate] = useState<string | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const [calY, setCalY] = useState(new Date().getFullYear())
  const [calM, setCalM] = useState(new Date().getMonth())
  // Modal de confirmação com senha para cancelar/excluir evento
  const [cancelConfirm, setCancelConfirm] = useState<{ ev: EventWithCounts; action: 'cancel' | 'delete' | 'close' } | null>(null)
  const [cancelPin, setCancelPin] = useState('')

  // Guest modal
  const [guestEv, setGuestEv] = useState<EventWithCounts | null>(null)
  const [guests, setGuests] = useState<Guest[]>([])
  const [guestListToken, setGuestListToken] = useState<string | null>(null)
  const [guestListId, setGuestListId] = useState<string | null>(null)
  const [guestListPromoId, setGuestListPromoId] = useState<string | null>(null)
  const [guestAddForm, setGuestAddForm] = useState({ name: '', phone: '', gender: '', birth_date: '' })
  const [guestAdding, setGuestAdding] = useState(false)
  // Mini-dashboard da aba Lista: corpo mostra só a visão selecionada
  const [listaView, setListaView] = useState<'casa' | 'promoters' | 'reservas'>('casa')
  const [selPromoter, setSelPromoter] = useState<string | null>(null) // promoter_list id selecionado
  const [selHouseListId, setSelHouseListId] = useState<string | null>(null) // lista da casa selecionada
  const [newHouseListOpen, setNewHouseListOpen] = useState(false)
  // cut/earlyM/earlyF = virada de horário: até o horário vale o valor "antes", depois o cheio
  const [nhlForm, setNhlForm] = useState({ name: '', male: '', female: '', vip: false, cut: '', earlyM: '', earlyF: '' })
  // Editar parâmetros de uma lista (preços ♂/♀ + VIP sem horário) direto no modal Listas
  const [editListOpen, setEditListOpen] = useState<{ id: string; label: string } | null>(null)
  const [editListForm, setEditListForm] = useState({ male: '', female: '', cutoff_exempt: false, fixed: '', minEntries: '', consumacao: '' })
  const [editListSaving, setEditListSaving] = useState(false)
  // Reservas dentro do modal de listas (interação completa)
  interface RReserva { id: string; name: string; phone?: string; location?: string; people_count?: number; status: string; expected_arrival?: string; observations?: string; amount_cents?: number; list_type?: string; list_male_value_cents?: number; list_female_value_cents?: number; list_custom_value_cents?: number }
  interface RGuestRow { id: string; name: string; phone?: string; birth_date?: string; checked_in?: boolean; confirmed?: boolean }
  const [listReservas, setListReservas] = useState<RReserva[]>([])
  const [selReserva, setSelReserva] = useState<string | null>(null)
  const [reservaGuests, setReservaGuests] = useState<Record<string, RGuestRow[]>>({})
  const [reservaGuestForm, setReservaGuestForm] = useState({ name: '', phone: '' })
  const [importingList, setImportingList] = useState(false)
  // Completar cadastro (telefone + nascimento) antes de liberar check-in de convidado de reserva
  const [completeRGuest, setCompleteRGuest] = useState<{ resId: string; guest: RGuestRow } | null>(null)
  const [completeRGForm, setCompleteRGForm] = useState({ phone: '', birth_date: '' })
  // Resumo de TODAS as listas geradas para o evento (casa, promoters, aniversário, reservas)
  interface ListSummaryRow { key: string; kind: 'list' | 'birthday' | 'res'; listId?: string; token?: string; promoterId?: string; isHouse?: boolean; icon: string; label: string; count: number; people?: number; entryFee?: number; entryMale?: number; entryFemale?: number; consumacao?: number; minEntries?: number }
  const [listSummary, setListSummary] = useState<ListSummaryRow[]>([])
  const [remindBusy, setRemindBusy] = useState<string | null>(null)

  // Gerenciar série de repetição
  const [serieModal, setSerieModal] = useState(false)
  const [serieFutures, setSerieFutures] = useState<EventWithCounts[]>([])
  const [serieDeleting, setSerieDeleting] = useState<Set<string>>(new Set())

  async function openSerieModal() {
    const evName = String(form.name ?? '').trim()
    const evDate = String(form.event_date ?? '')
    if (!evName || !evDate) return
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase.from('events')
      .select('id,name,event_date,status')
      .eq('house_id', house.id)
      .ilike('name', evName)
      .gt('event_date', evDate)
      .gte('event_date', today)
      .order('event_date')
    setSerieFutures((data ?? []) as EventWithCounts[])
    setSerieDeleting(new Set())
    setSerieModal(true)
  }

  async function deleteSerieFutures() {
    if (serieDeleting.size === 0) return
    if (!confirm(`Excluir ${serieDeleting.size} evento(s) da série?`)) return
    await supabase.from('events').delete().in('id', [...serieDeleting])
    setSerieFutures(p => p.filter(e => !serieDeleting.has(e.id)))
    setSerieDeleting(new Set())
    load()
    st2(`${serieDeleting.size} evento(s) excluído(s)`)
  }

  // Espaços da casa para preços por evento
  interface HouseSpace { id: string; name: string; price_cents?: number }
  const [houseSpaces, setHouseSpaces] = useState<HouseSpace[]>([])
  const [spacePrices, setSpacePrices] = useState<Record<string, number>>({})
  const [spaceSel, setSpaceSel] = useState('')

  async function loadHouseSpaces() {
    const { data } = await supabase.from('house_spaces').select('id,name,price_cents').eq('house_id', house.id).eq('active', true).order('sort_order').order('name')
    setHouseSpaces((data ?? []) as HouseSpace[])
  }

  // House list link in event form

  // Freelancers
  const [allFreelancers, setAllFreelancers] = useState<Freelancer[]>([])
  const [workAreas, setWorkAreas] = useState<WorkArea[]>(DEFAULT_AREAS)
  const wlabel = (key: string) => { const m = areaMeta(workAreas, key); return `${m.icon} ${m.label}` }
  const [evFreelancers, setEvFreelancers] = useState<EventFreelancer[]>([])
  const [frModal, setFrModal] = useState<EventWithCounts | null>(null)
  // Promoters da casa (para convidar específicos a um evento)
  const [housePromoters, setHousePromoters] = useState<Array<{ id: string; full_name: string; phone?: string }>>([])
  const [invitingPromoter, setInvitingPromoter] = useState<string | null>(null)

  // ── Montagem: envia todas as reservas do dia a um montador ──
  const [montagemEv, setMontagemEv] = useState<EventWithCounts | null>(null)
  const [montagemFr, setMontagemFr] = useState('')
  // Escalados do dia. Antes a lista trazia a equipe inteira (49 pessoas), incluindo
  // quem nem trabalha naquela data — e o montador saia escolhido de um catalogo.
  const [montagemEscala, setMontagemEscala] = useState<Array<{ id: string; full_name: string; phone?: string; role?: string }>>([])
  const [montagemMsg, setMontagemMsg] = useState('')

  // Budget modal
  const [budgetEv, setBudgetEv] = useState<EventWithCounts | null>(null)
  const [budgetFreelancers, setBudgetFreelancers] = useState<EventFreelancer[]>([])

  /**
   * Quanto custa uma pessoa neste evento. Ordem: valor FECHADO na folha (paid_cents) >
   * diária customizada > diária do cadastro — sempre menos o desconto lançado.
   * Antes o Budget usava só a diária: mostrava um número e a folha outro, para a mesma
   * noite, porque o cálculo da folha depende de chaves que vivem só naquela tela.
   */
  const custoFr = (ef: EventFreelancer) => {
    const pago = (ef as { paid_cents?: number | null }).paid_cents
    if (pago != null) return pago
    const bruto = (ef as { custom_fee_cents?: number | null }).custom_fee_cents ?? ef.freelancers?.daily_rate_cents ?? 0
    return Math.max(0, bruto - ((ef as { discount_cents?: number | null }).discount_cents ?? 0))
  }
  interface BudgetPromoterList { id: string; name: string; fixed_fee_cents: number; min_entries: number; entry_fee_cents: number; consumacao_cents: number; guest_count: number; promoters?: { full_name: string } }
  interface BudgetResItem { name: string; quantity: number; unit_cost_cents: number; reservations?: { name: string } }
  const [budgetPromoters, setBudgetPromoters] = useState<BudgetPromoterList[]>([])
  const [budgetResItems, setBudgetResItems] = useState<BudgetResItem[]>([])

  // Tickets modal
  const [ticketEv, setTicketEv] = useState<EventWithCounts | null>(null)
  const [batches, setBatches] = useState<TicketBatch[]>([])
  const [orders, setOrders] = useState<TicketOrder[]>([])
  const [batchForm, setBatchForm] = useState({ name: '', gender: 'both', price_cents: '', quantity: '', expires_at: '', service_fee_pct: '', nominal: false })
  const [addingBatch, setAddingBatch] = useState(false)
  const [savingBatch, setSavingBatch] = useState(false)
  const [editingBatch, setEditingBatch] = useState<TicketBatch | null>(null)
  const [batchEvId, setBatchEvId] = useState<string | null>(null)
  const [openBatch, setOpenBatch] = useState<string | null>(null)  // lote expandido mostrando compradores
  // Visão geral de ingressos (todos os eventos) — o modal por evento não mostra
  // pedidos pendentes de outros dias, que ficavam esperando confirmação sem ninguém ver
  const [allTk, setAllTk] = useState(false)
  const [allBatches, setAllBatches] = useState<(TicketBatch & { events?: { name: string; event_date: string } })[]>([])
  const [allOrders, setAllOrders] = useState<(TicketOrder & { events?: { name: string }; ticket_batches?: { name?: string } })[]>([])
  const [allTkLdg, setAllTkLdg] = useState(false)
  const [pendCount, setPendCount] = useState(0)
  const [tkQuery, setTkQuery] = useState('')
  const [tkDate, setTkDate] = useState('')
  const [tkScope, setTkScope] = useState<'prox' | 'enc' | 'todos'>('prox')
  // Sem PIX nem Mercado Pago a casa até cria o lote, mas o comprador trava na hora de pagar
  const [payCfg, setPayCfg] = useState<{ pix: boolean; mp: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  // Production panel
  const [prodEv, setProdEv] = useState<EventWithCounts | null>(null)
  const [prodTasks, setProdTasks] = useState<EventTask[]>([])
  const [prodRes, setProdRes] = useState<ProdReservation[]>([])
  const [prodTab, setProdTab] = useState<'tasks' | 'freelancers' | 'budget' | 'layout'>('tasks')
  const [prodFr, setProdFr] = useState<EventFreelancer[]>([])
  const [prodStaffing, setProdStaffing] = useState<Record<string, number>>({})
  const [teamArea, setTeamArea] = useState<string | null>(null)
  const [endMenu, setEndMenu] = useState<string | null>(null) // menu Encerrar (arquivar/excluir) por evento
  const [frModalArea, setFrModalArea] = useState<string | null>(null)
  // Busca por nome no modal Equipe: com 14 áreas, achar alguém pela área dá muita volta
  const [frBusca, setFrBusca] = useState('')
  const [addingArea, setAddingArea] = useState(false)
  const [newAreaIcon, setNewAreaIcon] = useState('📋')
  const [newAreaName, setNewAreaName] = useState('')
  const [taskFormArea, setTaskFormArea] = useState<string | null>(null)
  const [taskForm, setTaskForm] = useState({ title: '', deadline: '', assignee_name: '', assignee_phone: '', estimated_cost_cents: '', description: '', assignee_id: '' })
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const [actualCostEdit, setActualCostEdit] = useState<{ id: string; val: string } | null>(null)
  const [frFeeEdit, setFrFeeEdit] = useState<{ id: string; val: string } | null>(null)

  // Artists
  const [artists, setArtists] = useState<ArtistEntry[]>([])
  function addArtist() { setArtists(a => [...a, { name: '', fee_type: 'fixed', fee_cents: 0, fee_percent: 0, consumption_cents: 0 }]) }
  function removeArtist(i: number) { setArtists(a => a.filter((_, idx) => idx !== i)) }
  function setArtist(i: number, patch: Partial<ArtistEntry>) { setArtists(a => a.map((ar, idx) => idx === i ? { ...ar, ...patch } : ar)) }

  // Promoções (várias por evento, com valor que entra na produção)
  const [promos, setPromos] = useState<PromotionEntry[]>([])
  function addPromo() { setPromos(p => [...p, { label: '', value_cents: 0 }]) }
  function removePromo(i: number) { setPromos(p => p.filter((_, idx) => idx !== i)) }
  function setPromo(i: number, patch: Partial<PromotionEntry>) { setPromos(p => p.map((pr, idx) => idx === i ? { ...pr, ...patch } : pr)) }

  // Checklist do card — checagem das tarefas adicionadas na Produção
  const [checkEv, setCheckEv] = useState<EventWithCounts | null>(null)
  const [checkTasks, setCheckTasks] = useState<EventTask[]>([])

  // Outras despesas do evento (budget)
  interface EventExpense { id: string; event_id: string; description: string; amount_cents: number; kind?: string; area?: string | null }
  const [budgetExpenses, setBudgetExpenses] = useState<EventExpense[]>([])
  const [budgetRes, setBudgetRes] = useState<ProdReservation[]>([])
  const [budgetTasks, setBudgetTasks] = useState<EventTask[]>([])
  const [budgetCheckinRev, setBudgetCheckinRev] = useState(0)
  const [expForm, setExpForm] = useState({ description: '', amount: '', area: '' })
  const [expAdding, setExpAdding] = useState(false)
  const [revForm, setRevForm] = useState({ description: '', amount: '' })
  const [revAdding, setRevAdding] = useState(false)
  // Ajustes manuais de valores do budget (override por linha, persiste em event_budget_overrides)
  interface BudgetOverride { id: string; event_id: string; row_key: string; label: string | null; amount_cents: number }
  const [budgetOverrides, setBudgetOverrides] = useState<Record<string, BudgetOverride>>({})
  const [editKey, setEditKey] = useState<string | null>(null) // linha em edição (row_key) ou 'exp:<id>'
  const [editVal, setEditVal] = useState('')

  // Reservations modal
  const [resEv, setResEv] = useState<EventWithCounts | null>(null)
  const [resList, setResList] = useState<ResItem[]>([])
  const [resAddOpen, setResAddOpen] = useState(false)
  const [resForm, setResForm] = useState(RDEF2)
  const [resEdit, setResEdit] = useState<string | null>(null)

  // Consulta de reservas do card (somente leitura + impressão)
  interface ResView { id: string; name: string; location?: string; people_count?: number; observations?: string; status: string; expected_arrival?: string; archived_at?: string | null }
  const [resViewEv, setResViewEv] = useState<EventWithCounts | null>(null)
  const [resViewList, setResViewList] = useState<ResView[]>([])

  // Enviar flyer (broadcast WhatsApp)
  interface FlyerClient { id: string; full_name: string; phone?: string; gender?: string }
  // Avaliação de equipe
  interface RatingEntry { freelancer_id: string; full_name: string; role: string; rating: number; comment: string; existing_id?: string }
  const [ratingEv, setRatingEv] = useState<EventWithCounts | null>(null)
  const [ratingEntries, setRatingEntries] = useState<RatingEntry[]>([])
  const [ratingSaving, setRatingSaving] = useState(false)

  async function openRating(ev: EventWithCounts) {
    setRatingEv(ev)
    const { data: efs } = await supabase
      .from('event_freelancers')
      .select('freelancer_id, role, freelancers(full_name)')
      .eq('event_id', ev.id)
    const { data: existing } = await supabase
      .from('team_ratings')
      .select('id, freelancer_id, rating, comment')
      .eq('event_id', ev.id)
    const existingMap = new Map((existing ?? []).map(r => [r.freelancer_id, r]))
    const entries: RatingEntry[] = (efs ?? []).map(ef => {
      const ex = existingMap.get(ef.freelancer_id)
      return {
        freelancer_id: ef.freelancer_id,
        full_name: (ef.freelancers as { full_name?: string } | null)?.full_name ?? 'Sem nome',
        role: ef.role ?? '',
        rating: ex?.rating ?? 0,
        comment: ex?.comment ?? '',
        existing_id: ex?.id,
      }
    })
    setRatingEntries(entries)
  }

  async function saveRatings() {
    if (!ratingEv) return
    setRatingSaving(true)
    const toSave = ratingEntries.filter(e => e.rating > 0)
    for (const e of toSave) {
      if (e.existing_id) {
        await supabase.from('team_ratings').update({ rating: e.rating, comment: e.comment }).eq('id', e.existing_id)
      } else {
        await supabase.from('team_ratings').insert({ house_id: ratingEv.house_id, event_id: ratingEv.id, freelancer_id: e.freelancer_id, rating: e.rating, comment: e.comment || null })
      }
    }
    setRatingSaving(false)
    st2(`✅ ${toSave.length} avaliação(ões) salvas!`, 'success')
    setRatingEv(null)
  }

  const [flyerEv, setFlyerEv] = useState<EventWithCounts | null>(null)
  const [flyerClients, setFlyerClients] = useState<FlyerClient[]>([])
  const [flyerSel, setFlyerSel] = useState<Set<string>>(new Set())
  const [flyerMsg, setFlyerMsg] = useState('')
  const [flyerSearch, setFlyerSearch] = useState('')
  const [flyerGender, setFlyerGender] = useState<'all' | 'masculino' | 'feminino'>('all')
  const [flyerSending, setFlyerSending] = useState(false)
  const [flyerProgress, setFlyerProgress] = useState({ sent: 0, total: 0 })
  const [flyerMaxFriends, setFlyerMaxFriends] = useState(3)
  const [flyerFriendsOn, setFlyerFriendsOn] = useState(true)
  const [flyerVip, setFlyerVip] = useState(false)
  const [flyerListRec, setFlyerListRec] = useState<{ token: string; listId: string; promoterId: string } | null>(null)

  function st2(m: string, t?: string) { sT(setToast, m, t as 'success' | 'error' | 'warn') }

  // Detalhes do evento (valores, atrações e promoções) para incluir nos convites enviados
  function eventDetailsText(ev: EventWithCounts): string {
    const lines: string[] = []
    const hasList = (ev.price_male_list_cents ?? 0) > 0 || (ev.price_female_list_cents ?? 0) > 0
    if (hasList) {
      const parts: string[] = []
      if ((ev.price_male_list_cents ?? 0) > 0) parts.push(`♂ ${fmtCurrency(ev.price_male_list_cents ?? 0)}`)
      if ((ev.price_female_list_cents ?? 0) > 0) parts.push(`♀ ${fmtCurrency(ev.price_female_list_cents ?? 0)}`)
      lines.push(`💵 Lista: ${parts.join(' · ')}`)
    } else {
      const parts: string[] = []
      if ((ev.price_male_cents ?? 0) > 0) parts.push(`♂ ${fmtCurrency(ev.price_male_cents ?? 0)}`)
      if ((ev.price_female_cents ?? 0) > 0) parts.push(`♀ ${fmtCurrency(ev.price_female_cents ?? 0)}`)
      if (parts.length) lines.push(`💵 Entrada: ${parts.join(' · ')}`)
    }
    const artistNames = (ev.artists ?? []).map(a => a.name).filter(n => n && n.trim())
    if (artistNames.length) lines.push(`🎤 ${artistNames.join(' · ')}`)
    const promos = (ev.promotions_list ?? []).map(p => p.label).filter(l => l && l.trim())
    const promoText = promos.length ? promos : (ev.promotions ? [ev.promotions] : [])
    if (promoText.length) lines.push(`🎉 ${promoText.join(' · ')}`)
    return lines.length ? '\n\n' + lines.join('\n') : ''
  }

  async function openProd(ev: EventWithCounts) {
    setProdEv(ev); setProdTasks([]); setProdRes([]); setProdTab('tasks'); setProdFr([]); setTeamArea(null); setProdStaffing(ev.staffing_needs ?? {})
    const [tasksR, resR, frR] = await Promise.all([
      supabase.from('event_tasks').select('*').eq('event_id', ev.id).order('area').order('sort_order'),
      supabase.from('reservations').select('*, reservation_items(name, quantity, unit_cost_cents)')
        .eq('house_id', house.id).eq('reservation_date', ev.event_date).neq('status', 'cancelled'),
      supabase.from('event_freelancers').select('*, freelancers(full_name, work_types, daily_rate_cents, phone)').eq('event_id', ev.id),
    ])
    setProdTasks((tasksR.data ?? []) as EventTask[])
    setProdRes(((resR.data ?? []) as ProdReservation[]).filter(r => reservaConta(r, ev.event_date)))
    setProdFr((frR.data ?? []) as EventFreelancer[])
  }

  async function reloadProdFr() {
    if (!prodEv) return
    const { data } = await supabase.from('event_freelancers')
      .select('*, freelancers(full_name, work_types, daily_rate_cents, phone)').eq('event_id', prodEv.id)
    setProdFr((data ?? []) as EventFreelancer[])
  }

  async function addProdFreelancer(freelancerId: string, role: string) {
    if (!prodEv) return
    await supabase.from('event_freelancers').insert({ event_id: prodEv.id, freelancer_id: freelancerId, confirmed: false, role: resolveRole(freelancerId, role) })
    await reloadProdFr()
  }

  async function removeProdFreelancer(id: string) {
    await supabase.from('event_freelancers').delete().eq('id', id)
    setProdFr(p => p.filter(f => f.id !== id))
  }

  // Quota: número de freelancers necessário por área (planejamento do gestor)
  async function saveStaffingNeed(areaKey: string, value: number) {
    if (!prodEv) return
    const next = { ...prodStaffing }
    if (value > 0) next[areaKey] = value; else delete next[areaKey]
    setProdStaffing(next)
    setProdEv(p => (p ? { ...p, staffing_needs: next } : p))
    setEvents(prev => prev.map(e => e.id === prodEv.id ? { ...e, staffing_needs: next } : e))
    await supabase.from('events').update({ staffing_needs: next }).eq('id', prodEv.id)
  }

  // Área de escala: se a pessoa atua na seção escolhida, mantém a seção.
  // Se for de outra área, grava a área do CADASTRO dela (senão todos caem na mesma seção).
  function resolveRole(freelancerId: string, sectionArea: string): string {
    const f = allFreelancers.find(x => x.id === freelancerId)
    const wt = ((f?.work_types ?? []) as string[]).filter(Boolean)
    if (wt.length === 0) return sectionArea
    return wt.includes(sectionArea) ? sectionArea : wt[0]
  }

  // Associação de freelancers pelo modal Equipe do card (recrutamento)
  async function addEvFreelancer(freelancerId: string, role: string) {
    if (!frModal) return
    const finalRole = resolveRole(freelancerId, role)
    await supabase.from('event_freelancers').insert({ event_id: frModal.id, freelancer_id: freelancerId, confirmed: false, role: finalRole })
    if (finalRole !== role) st2(`Escalado em ${wlabel(finalRole)} (área do cadastro).`, 'success')
    loadEvFreelancers(frModal)
  }
  async function removeEvFreelancer(id: string) {
    if (!frModal) return
    await supabase.from('event_freelancers').delete().eq('id', id)
    loadEvFreelancers(frModal)
  }
  async function toggleEvFrConfirmed(ef: EventFreelancer) {
    if (!frModal) return
    await supabase.from('event_freelancers').update({ confirmed: !ef.confirmed }).eq('id', ef.id)
    loadEvFreelancers(frModal)
  }
  async function saveEvFrEntryTime(id: string, val: string) {
    await supabase.from('event_freelancers').update({ entry_time: val || null }).eq('id', id)
    setEvFreelancers(p => p.map(f => f.id === id ? { ...f, entry_time: val || null } : f))
  }

  // Impressão da escala do dia + folha de ponto (assinatura)
  function printEscala(ev: EventWithCounts) {
    const roleOf = (ef: EventFreelancer) => (ef.role || ef.freelancers?.work_types?.[0] || 'outros')
    const sorted = [...evFreelancers].sort((a, b) => {
      const ra = wlabel(roleOf(a)), rb = wlabel(roleOf(b))
      if (ra !== rb) return ra.localeCompare(rb)
      return (a.entry_time || '').localeCompare(b.entry_time || '')
    })
    const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    const rows = sorted.map(ef => `<tr>
      <td>${wlabel(roleOf(ef))}</td>
      <td><strong>${ef.freelancers?.full_name ?? '—'}</strong></td>
      <td class="c">${ef.entry_time ? ef.entry_time.slice(0, 5) : '—'}</td>
      <td></td><td></td><td></td>
    </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Escala — ${ev.name}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 28px; max-width: 900px; margin: 0 auto; color: #111; }
      h1 { font-size: 22px; margin: 0 0 4px; } .sub { color: #666; font-size: 13px; margin-bottom: 20px; text-transform: capitalize; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; color: #555; font-size: 11px; text-transform: uppercase; padding: 8px; border-bottom: 2px solid #333; }
      td { padding: 12px 8px; border-bottom: 1px solid #ddd; }
      td.c, th.c { text-align: center; }
      .sig { min-width: 150px; }
      .footer { margin-top: 28px; font-size: 12px; color: #999; text-align: center; }
      @media print { body { padding: 12px; } }
    </style></head><body>
    <h1>👷 Escala do Dia — ${ev.name}</h1>
    <div class="sub">📅 ${dateStr} &nbsp;·&nbsp; ${sorted.length} profissionais</div>
    <table>
      <thead><tr><th style="width:110px">Área</th><th>Nome</th><th class="c" style="width:70px">Entrada</th><th class="sig">Assin. Entrada</th><th class="sig">Assin. Saída</th><th class="c" style="width:70px">Saída</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px">Nenhum profissional escalado</td></tr>'}</tbody>
    </table>
    <div class="footer">Folha de ponto — assinaturas confirmam presença · Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
    <script>window.onload = () => window.print()</script>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  async function toggleProdFrConfirmed(fr: EventFreelancer) {
    await supabase.from('event_freelancers').update({ confirmed: !fr.confirmed }).eq('id', fr.id)
    setProdFr(p => p.map(f => f.id === fr.id ? { ...f, confirmed: !f.confirmed } : f))
  }

  async function addProdArea() {
    if (!newAreaName.trim() || !prodEv) return
    setAddingArea(false); setNewAreaName(''); setNewAreaIcon('📋')
    // Just opens the task form for this new area
    setTaskFormArea(newAreaName.trim() + '|||' + newAreaIcon)
    setTaskForm({ title: '', deadline: '', assignee_name: '', assignee_phone: '', estimated_cost_cents: '', description: '', assignee_id: '' })
  }

  async function addProdTask(area: string, icon: string, delegateLater = false) {
    if (!taskForm.title.trim() || !prodEv) return
    const sort = prodTasks.filter(t => t.area === area).length
    // Vincula o freelancer_id do executor escolhido. Usa o ID exato selecionado (não re-resolve por
    // telefone) — senão, com dois cadastros de mesmo telefone, cairia no cadastro errado.
    const assigneePhone = delegateLater ? '' : (taskForm.assignee_phone || '')
    const assigneeFr = delegateLater
      ? undefined
      : (taskForm.assignee_id ? allFreelancers.find(f => f.id === taskForm.assignee_id) : undefined)
        ?? (assigneePhone ? allFreelancers.find(f => (f.phone ?? '').replace(/\D/g, '') && (f.phone ?? '').replace(/\D/g, '') === assigneePhone.replace(/\D/g, '')) : undefined)
    const { data } = await supabase.from('event_tasks').insert({
      event_id: prodEv.id, house_id: house.id,
      area, area_icon: icon, title: taskForm.title.trim(),
      description: taskForm.description || null,
      deadline: taskForm.deadline || null,
      assignee_name: delegateLater ? null : (taskForm.assignee_name || null),
      assignee_phone: delegateLater ? null : (taskForm.assignee_phone || null),
      freelancer_id: assigneeFr?.id ?? null,
      estimated_cost_cents: taskForm.estimated_cost_cents ? Math.round(parseFloat(taskForm.estimated_cost_cents) * 100) : null,
      sort_order: sort, status: 'pending',
    }).select().single()
    if (data) {
      setProdTasks(p => [...p, data as EventTask])
      // Notifica o responsável no WhatsApp (segundo plano) quando a tarefa foi vinculada a um freelancer
      if (assigneeFr && !delegateLater) notifyTaskAssigned(house.id, house.name, assigneeFr.id, taskForm.title.trim(), { eventName: prodEv?.name ?? null, deadline: taskForm.deadline || null })
      setTaskForm({ title: '', deadline: '', assignee_name: '', assignee_phone: '', estimated_cost_cents: '', description: '', assignee_id: '' }); setTaskFormArea(null)
    }
  }

  async function toggleProdTask(task: EventTask) {
    const done = task.status !== 'done'
    const update: Record<string, unknown> = { status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : null, completed_by: done ? 'operador' : null }
    if (!done) update.actual_cost_cents = null
    await supabase.from('event_tasks').update(update).eq('id', task.id)
    setProdTasks(p => p.map(t => t.id === task.id ? { ...t, ...update } as EventTask : t))
  }

  async function saveProdActualCost(id: string, val: string) {
    const cents = val ? Math.round(parseFloat(val) * 100) : null
    await supabase.from('event_tasks').update({ actual_cost_cents: cents }).eq('id', id)
    setProdTasks(p => p.map(t => t.id === id ? { ...t, actual_cost_cents: cents ?? undefined } : t))
    setActualCostEdit(null)
  }

  async function deleteProdTask(id: string) {
    if (!confirm('Remover tarefa?')) return
    await supabase.from('event_tasks').delete().eq('id', id)
    setProdTasks(p => p.filter(t => t.id !== id))
  }

  function exportProdCostsCsv() {
    if (!prodEv) return
    const rows: string[][] = [['Área', 'Tarefa', 'Responsável', 'Prazo', 'Status', 'Custo Estimado', 'Custo Real']]
    prodTasks.forEach(t => rows.push([
      t.area, t.title, t.assignee_name ?? '',
      t.deadline ? new Date(t.deadline).toLocaleString('pt-BR') : '',
      t.status === 'done' ? 'Concluída' : 'Pendente',
      ((t.estimated_cost_cents ?? 0) / 100).toFixed(2).replace('.', ','),
      ((t.actual_cost_cents ?? 0) / 100).toFixed(2).replace('.', ','),
    ]))
    const totEst = prodTasks.reduce((s, t) => s + (t.estimated_cost_cents ?? 0), 0)
    const totReal = prodTasks.reduce((s, t) => s + (t.actual_cost_cents ?? 0), 0)
    rows.push([''])
    rows.push(['', '', '', '', 'TOTAL', (totEst / 100).toFixed(2).replace('.', ','), (totReal / 100).toFixed(2).replace('.', ',')])
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `producao-${prodEv.name}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function printProdCosts() {
    if (!prodEv) return
    const grouped: Record<string, { icon: string; tasks: EventTask[] }> = {}
    prodTasks.forEach(t => { if (!grouped[t.area]) grouped[t.area] = { icon: t.area_icon, tasks: [] }; grouped[t.area].tasks.push(t) })
    const totEst = prodTasks.reduce((s, t) => s + (t.estimated_cost_cents ?? 0), 0)
    const totReal = prodTasks.reduce((s, t) => s + (t.actual_cost_cents ?? 0), 0)
    const fmt = (c: number) => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Produção — ${prodEv.name}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 32px; max-width: 900px; margin: 0 auto; color: #111; }
      h1 { font-size: 22px; margin: 0 0 4px; } .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
      h2 { font-size: 14px; color: #444; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin: 22px 0 6px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; color: #888; font-size: 11px; text-transform: uppercase; padding: 6px 8px; border-bottom: 1px solid #eee; }
      td { padding: 7px 8px; border-bottom: 1px solid #f2f2f2; }
      td.num, th.num { text-align: right; white-space: nowrap; }
      .done { color: #999; text-decoration: line-through; }
      .areatot { font-weight: 700; color: #555; }
      .grand { margin-top: 26px; border-top: 2px solid #333; padding-top: 12px; display: flex; justify-content: flex-end; gap: 40px; font-size: 15px; }
      .grand b { font-size: 18px; }
      .footer { margin-top: 32px; font-size: 12px; color: #999; text-align: center; }
      @media print { body { padding: 16px; } }
    </style></head><body>
    <h1>🏭 Produção — ${prodEv.name}</h1>
    <div class="sub">📅 ${new Date(prodEv.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
    ${Object.entries(grouped).map(([area, { icon, tasks }]) => {
      const aEst = tasks.reduce((s, t) => s + (t.estimated_cost_cents ?? 0), 0)
      const aReal = tasks.reduce((s, t) => s + (t.actual_cost_cents ?? 0), 0)
      return `<h2>${icon} ${area}</h2>
      <table><thead><tr><th>Tarefa</th><th>Responsável</th><th>Prazo</th><th class="num">Estimado</th><th class="num">Real</th></tr></thead><tbody>
      ${tasks.map(t => `<tr>
        <td class="${t.status === 'done' ? 'done' : ''}">${t.title}</td>
        <td>${t.assignee_name ?? '—'}</td>
        <td>${t.deadline ? new Date(t.deadline).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
        <td class="num">${fmt(t.estimated_cost_cents ?? 0)}</td>
        <td class="num">${(t.actual_cost_cents ?? 0) > 0 ? fmt(t.actual_cost_cents ?? 0) : '—'}</td>
      </tr>`).join('')}
      <tr class="areatot"><td colspan="3">Subtotal ${area}</td><td class="num">${fmt(aEst)}</td><td class="num">${aReal > 0 ? fmt(aReal) : '—'}</td></tr>
      </tbody></table>`
    }).join('')}
    <div class="grand"><span>Custo estimado: <b>${fmt(totEst)}</b></span>${totReal > 0 ? `<span>Custo real: <b>${fmt(totReal)}</b></span>` : ''}</div>
    <div class="footer">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
    <script>window.onload = () => window.print()</script>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  async function sendTaskWA(task: EventTask) {
    const url = `${window.location.origin}/tarefa.html?t=${task.token}`
    const deadline = task.deadline ? new Date(task.deadline).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
    const lines = [
      `📋 *${task.area}* — ${task.title}`,
      prodEv ? `🎭 Evento: ${prodEv.name}` : '',
      deadline ? `⏰ Prazo: ${deadline}` : '',
      task.description ? `📝 ${task.description}` : '',
      '',
      '👇 Acesse para marcar como concluído:',
      url,
    ].filter(Boolean).join('\n')
    if (!task.assignee_phone) { st2('Tarefa sem responsável com telefone', 'warn'); return }
    const r = await sendWADirect(house.id, task.assignee_phone, lines, { eventId: prodEv?.id, type: 'task_delegate' })
    st2(r.viaApi ? '✅ Tarefa enviada pela API' : '📲 Abrindo WhatsApp...', 'success')
  }

  async function saveFrFee(id: string, val: string) {
    const cents = val ? Math.round(parseFloat(val) * 100) : null
    await supabase.from('event_freelancers').update({ custom_fee_cents: cents }).eq('id', id)
    setProdFr(p => p.map(f => f.id === id ? { ...f, custom_fee_cents: cents } as EventFreelancer : f))
    setFrFeeEdit(null)
  }

  async function convocateFrWA(fr: EventFreelancer) {
    const frData = (fr as any).freelancers
    if (!frData?.phone) { st2('Freelancer sem telefone cadastrado', 'warn'); return }
    const lines = [
      `Olá ${frData?.full_name ?? ''}! 👋`,
      prodEv ? `Temos uma vaga para você no evento *${prodEv.name}* — ${new Date(prodEv.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}` : '',
      `Confirme sua disponibilidade respondendo esta mensagem.`,
    ].filter(Boolean).join('\n')
    const r = await sendWADirect(house.id, frData.phone, lines, { eventId: prodEv?.id, type: 'fr_convocate' })
    st2(r.viaApi ? '✅ Convocação enviada pela API' : '📲 Abrindo WhatsApp...', 'success')
  }

  function openCheck(ev: EventWithCounts) {
    setCheckEv(ev); setCheckTasks([])
    supabase.from('event_tasks').select('*').eq('event_id', ev.id).order('area').order('sort_order')
      .then(r => setCheckTasks((r.data ?? []) as EventTask[]))
  }

  async function toggleCheckTask(task: EventTask) {
    const done = task.status !== 'done'
    await supabase.from('event_tasks').update({ status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : null, completed_by: done ? 'operador' : null }).eq('id', task.id)
    setCheckTasks(p => {
      const next = p.map(t => t.id === task.id ? { ...t, status: done ? 'done' : 'pending' } as EventTask : t)
      if (checkEv) {
        const doneCount = next.filter(t => t.status === 'done').length
        setEvents(prev => prev.map(e => e.id === checkEv.id ? { ...e, tasksDone: doneCount, tasksTotal: next.length } : e))
      }
      return next
    })
  }

  function printCheck(ev: EventWithCounts) {
    const grouped: Record<string, { icon: string; tasks: EventTask[] }> = {}
    checkTasks.forEach(t => { if (!grouped[t.area]) grouped[t.area] = { icon: t.area_icon, tasks: [] }; grouped[t.area].tasks.push(t) })
    const total = checkTasks.length
    const done = checkTasks.filter(t => t.status === 'done').length
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Checklist — ${ev.name}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 32px; max-width: 800px; margin: 0 auto; color: #111; }
      h1 { font-size: 22px; margin: 0 0 4px; } .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
      .progress { background: #eee; border-radius: 8px; height: 10px; margin-bottom: 24px; overflow: hidden; }
      .progress-bar { background: #10b981; height: 100%; border-radius: 8px; width: ${total > 0 ? Math.round(done/total*100) : 0}%; }
      h2 { font-size: 14px; color: #444; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin: 20px 0 10px; text-transform: uppercase; letter-spacing: 0.05em; }
      .item { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid #f0f0f0; }
      .box { width: 18px; height: 18px; border: 2px solid #999; border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
      .box.done { background: #10b981; border-color: #10b981; color: #fff; font-size: 12px; }
      .label { font-size: 14px; } .label.done { text-decoration: line-through; color: #999; }
      .meta { color: #888; font-size: 12px; margin-left: auto; }
      .footer { margin-top: 32px; font-size: 12px; color: #999; text-align: center; }
      @media print { body { padding: 16px; } }
    </style></head><body>
    <h1>📋 ${ev.name}</h1>
    <div class="sub">📅 ${new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} &nbsp;·&nbsp; ${done}/${total} tarefas concluídas</div>
    <div class="progress"><div class="progress-bar"></div></div>
    ${Object.entries(grouped).map(([area, g]) => `
      <h2>${g.icon} ${area}</h2>
      ${g.tasks.map(t => `<div class="item"><div class="box ${t.status === 'done' ? 'done' : ''}">${t.status === 'done' ? '✓' : ''}</div><span class="label ${t.status === 'done' ? 'done' : ''}">${t.title}</span>${t.assignee_name ? `<span class="meta">${t.assignee_name}</span>` : ''}</div>`).join('')}
    `).join('')}
    <div class="footer">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
    <script>window.onload = () => window.print()</script>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  function load() {
    if (!house) return
    supabase.from('events').select('*').eq('house_id', house.id).order('event_date', { ascending: false })
      .then(r => {
        setLdg(false)
        const evs = (r.data ?? []) as EventWithCounts[]
        setEvents(evs)
        if (!evs.length) return
        const ids = evs.map(e => e.id)
        // Agrega no SERVIDOR (RPC) — mesma regra dos Relatórios (atribui entrada livre ao evento do
        // dia) e sem o limite de 1000 linhas que truncava a contagem por evento
        supabase.rpc('event_checkin_stats', { p_house: house.id })
          .then((rs: { data: Array<{ event_id: string; total: number; pagantes: number; cortesias: number }> | null }) => {
            const ct: Record<string, number> = {}
            const pag: Record<string, number> = {}
            const cort: Record<string, number> = {}
            ;(rs.data ?? []).forEach(r => { ct[r.event_id] = r.total; pag[r.event_id] = r.pagantes; cort[r.event_id] = r.cortesias })
            setEvents(prev => prev.map(e => ({ ...e, checkinCount: ct[e.id] ?? 0, pagantesCount: pag[e.id] ?? 0, cortesiasCount: cort[e.id] ?? 0 })))
          })
        // Conta reservas por evento_id OU por DATA (reserva feita para o dia, mesmo sem vínculo)
        const evDates = [...new Set(evs.map(e => e.event_date))]
        const dateToEvent: Record<string, string> = {}
        evs.forEach(e => { if (!dateToEvent[e.event_date]) dateToEvent[e.event_date] = e.id })
        supabase.from('reservations').select('id,event_id,people_count,reservation_date,archived_at,reservation_guests(id)')
          .eq('house_id', house.id).neq('status', 'cancelled')
          .or(`event_id.in.(${ids.join(',')}),reservation_date.in.(${evDates.join(',')})`)
          .then(rr => {
            const rc: Record<string, number> = {}
            const rp: Record<string, number> = {}
            const seen = new Set<string>()
            ;(rr.data ?? []).forEach(r => {
              // Determina o evento: prioriza o vínculo; senão casa pela data
              const eid = (r.event_id && ids.includes(r.event_id)) ? r.event_id : dateToEvent[r.reservation_date]
              if (!eid || seen.has(r.id)) return
              if (!reservaConta(r, r.reservation_date)) return
              seen.add(r.id)
              rc[eid] = (rc[eid] ?? 0) + 1
              rp[eid] = (rp[eid] ?? 0) + esperadoDaReserva(r)
            })
            setEvents(prev => prev.map(e => ({ ...e, resCount: rc[e.id] ?? 0, resPeople: rp[e.id] ?? 0 })))
          })
        // Agrega no servidor: buscar linha a linha estourava o teto de 1000 do PostgREST
        // e os eventos além do corte vinham com menos convidados do que realmente têm
        supabase.rpc('event_list_guest_stats', { p_house: house.id })
          .then((gr: { data: Array<{ event_id: string; convidados: number }> | null }) => {
            const gc: Record<string, number> = {}
            ;(gr.data ?? []).forEach(g => { gc[g.event_id] = Number(g.convidados) })
            setEvents(prev => prev.map(e => ({ ...e, listGuests: gc[e.id] ?? 0 })))
          })
        // Equipe por evento (escalados/confirmados) — agrega no servidor pelo mesmo motivo
        // dos convidados: linha a linha estouraria o teto de 1000 e o contador mentiria
        supabase.rpc('event_team_stats', { p_house: house.id })
          .then((tr: { data: Array<{ event_id: string; escalados: number; confirmados: number; por_area: Record<string, number> | null }> | null }) => {
            const tot: Record<string, number> = {}
            const ok: Record<string, number> = {}
            const area: Record<string, Record<string, number>> = {}
            ;(tr.data ?? []).forEach(s => {
              tot[s.event_id] = Number(s.escalados)
              ok[s.event_id] = Number(s.confirmados)
              area[s.event_id] = s.por_area ?? {}
            })
            setEvents(prev => prev.map(e => ({ ...e, teamTotal: tot[e.id] ?? 0, teamOk: ok[e.id] ?? 0, teamByArea: area[e.id] ?? {} })))
          })
        supabase.from('event_tasks').select('event_id,status').in('event_id', ids)
          .then(tr => {
            const tt: Record<string, number> = {}
            const td: Record<string, number> = {}
            ;(tr.data ?? []).forEach(t => {
              if (!t.event_id) return
              tt[t.event_id] = (tt[t.event_id] ?? 0) + 1
              if (t.status === 'done') td[t.event_id] = (td[t.event_id] ?? 0) + 1
            })
            setEvents(prev => prev.map(e => ({ ...e, tasksTotal: tt[e.id] ?? 0, tasksDone: td[e.id] ?? 0 })))
          })
      })
  }

  // Arquiva automaticamente eventos com data passada há mais de 3 dias (status → encerrado)
  // e arquiva as reservas vinculadas. Eventos arquivados continuam disponíveis para avaliação.
  async function autoArchivePast() {
    if (!house) return
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 3)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const { data: stale } = await supabase.from('events')
      .select('id')
      .eq('house_id', house.id)
      .lt('event_date', cutoffStr)
      .not('status', 'in', '(encerrado,cancelado)')
    const ids = (stale ?? []).map(e => e.id)
    if (ids.length === 0) return
    const now = new Date().toISOString()
    await supabase.from('events').update({ status: 'encerrado', updated_at: now }).in('id', ids)
    await supabase.from('reservations').update({ archived_at: now }).eq('house_id', house.id).in('event_id', ids).is('archived_at', null)
  }

  useEffect(() => { autoArchivePast().then(() => { load(); loadHouseSpaces() }) }, [house.id])

  // Carrega os convidados da reserva selecionada (ou da primeira) ao abrir a visão Reservas
  useEffect(() => {
    if (!guestEv || listaView !== 'reservas') return
    const id = selReserva ?? listReservas[0]?.id
    if (!id || reservaGuests[id]) return
    supabase.from('reservation_guests').select('id,name,phone,birth_date,checked_in,confirmed').eq('reservation_id', id).order('name')
      .then(r => setReservaGuests(prev => prev[id] ? prev : ({ ...prev, [id]: (r.data ?? []) as RGuestRow[] })))
  }, [guestEv, listaView, selReserva, listReservas, reservaGuests])

  useEffect(() => {
    supabase.from('freelancers').select('*').eq('house_id', house.id).eq('status', 'ativo').order('full_name')
      .then(r => setAllFreelancers((r.data ?? []) as Freelancer[]))
    supabase.from('work_areas').select('*').eq('house_id', house.id).order('sort_order').order('label')
      .then(r => { if (r.data && r.data.length) setWorkAreas(r.data as WorkArea[]) })
    // Promoters reais da casa (exclui o pseudo-promoter "Lista da Casa")
    supabase.from('promoters').select('id,full_name,phone').eq('house_id', house.id).neq('full_name', 'Lista da Casa').order('full_name')
      .then(r => setHousePromoters((r.data ?? []) as Array<{ id: string; full_name: string; phone?: string }>))
  }, [house.id])

  function loadEvFreelancers(ev: EventWithCounts) {
    setFrModal(ev)
    setEvFreelancers([])
    supabase.from('event_freelancers').select('*,freelancers(full_name,work_types,daily_rate_cents,phone)')
      .eq('event_id', ev.id)
      .then(r => {
        const rows = (r.data ?? []) as EventFreelancer[]
        setEvFreelancers(rows)
        // Espelha no card: sem isso o contador do botão só mudaria no próximo reload
        const area: Record<string, number> = {}
        rows.forEach(ef => {
          const k = ef.role || ef.freelancers?.work_types?.[0] || 'outros'
          area[k] = (area[k] ?? 0) + 1
        })
        setEvents(prev => prev.map(e => e.id === ev.id
          ? { ...e, teamTotal: rows.length, teamOk: rows.filter(x => x.confirmed).length, teamByArea: area }
          : e))
      })
  }

  // Monta a tarefa de montagem consolidando TODAS as reservas do dia do evento
  async function openMontagem(ev: EventWithCounts) {
    setMontagemEv(ev); setMontagemFr(''); setMontagemEscala([])
    supabase.from('event_freelancers')
      .select('role, freelancers(id, full_name, phone)')
      .eq('event_id', ev.id)
      .then(r => {
        const rows = (r.data ?? []) as unknown as Array<{ role?: string; freelancers?: { id: string; full_name: string; phone?: string } | null }>
        setMontagemEscala(rows
          .filter(x => x.freelancers)
          .map(x => ({ id: x.freelancers!.id, full_name: x.freelancers!.full_name, phone: x.freelancers!.phone, role: x.role }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name)))
      })
    const { data } = await supabase.from('reservations')
      .select('name, location, people_count, expected_arrival, observations, archived_at, reservation_items(name, quantity)')
      .eq('house_id', house.id).eq('reservation_date', ev.event_date).neq('status', 'cancelled')
      .order('location')
    const res = ((data ?? []) as Array<{ name: string; location?: string; people_count?: number; expected_arrival?: string; observations?: string; archived_at?: string | null; reservation_items?: Array<{ name: string; quantity: number }> }>)
      .filter(r => reservaConta(r, ev.event_date))
    const totalPeople = res.reduce((s, r) => s + (r.people_count ?? 0), 0)
    const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    const lines = res.map(r => {
      const items = (r.reservation_items ?? []).map(i => `${i.quantity > 1 ? i.quantity + '× ' : ''}${i.name}`).join(', ')
      return `• *${r.location || r.name}*${r.people_count ? ` — ${r.people_count}p` : ''}${r.name && r.location ? ` (${r.name})` : ''}${items ? `\n   ↳ ${items}` : ''}`
    })
    setMontagemMsg([
      `📐 *Montagem — ${ev.name}*`,
      `📅 ${dateStr}`,
      `🪑 ${res.length} reserva(s) · 👥 ${totalPeople} pessoas`,
      '',
      lines.length ? lines.join('\n') : '(nenhuma reserva cadastrada para o dia)',
      '',
      'Favor montar conforme acima e confirmar. 🙌',
    ].join('\n'))
  }

  async function sendMontagem() {
    const fr = montagemEscala.find(f => f.id === montagemFr)
    if (!fr) { st2('Selecione o montador entre os escalados do dia', 'warn'); return }
    if (!fr.phone) { st2(`${fr.full_name} está sem telefone no cadastro — inclua na aba Equipe.`, 'warn'); return }

    // A montagem vira TAREFA, não só mensagem. Antes ela só saía no WhatsApp: não
    // aparecia na agenda de quem ia montar, não dava para marcar como feita e o
    // gestor não tinha como saber se foi executada.
    let virouTarefa = false
    if (montagemEv) {
      const { error } = await supabase.from('event_tasks').insert({
        house_id: house.id, event_id: montagemEv.id,
        area: 'salao', area_icon: '📐',
        title: 'Montagem das reservas',
        description: montagemMsg,
        freelancer_id: fr.id, assignee_name: fr.full_name, assignee_phone: fr.phone ?? null,
        status: 'pending', sort_order: 0,
      })
      virouTarefa = !error
      if (error) st2('A tarefa não pôde ser criada: ' + error.message, 'error')
    }

    const r = await sendWADirect(house.id, fr.phone, montagemMsg, { eventId: montagemEv?.id, type: 'montagem' })
    st2(virouTarefa
      ? `✅ Na agenda de ${fr.full_name.split(' ')[0]}${r.viaApi ? ' e enviada no WhatsApp' : ' — abrindo WhatsApp...'}`
      : (r.viaApi ? '✅ Montagem enviada pela API' : '📲 Abrindo WhatsApp...'), 'success')
    setMontagemEv(null)
  }

  function artistsBreakdown(ev: EventWithCounts) {
    const arr = ev.artists ?? []
    if (arr.length) {
      return { fee: arr.reduce((s, a) => s + (a.fee_cents ?? 0), 0), cons: arr.reduce((s, a) => s + (a.consumption_cents ?? 0), 0), list: arr }
    }
    return { fee: ev.artist_fee_cents ?? 0, cons: ev.consumption_cents ?? 0, list: [] as typeof arr }
  }

  async function addExpense(ev: EventWithCounts) {
    const amount = Math.round((parseFloat(expForm.amount.replace(',', '.')) || 0) * 100)
    if (!expForm.description.trim() || amount <= 0) return
    const { data } = await supabase.from('event_expenses').insert({ event_id: ev.id, house_id: house.id, description: expForm.description.trim(), amount_cents: amount, kind: 'expense', area: expForm.area || null }).select().single()
    if (data) { setBudgetExpenses(pp => [...pp, data as EventExpense]); setExpForm({ description: '', amount: '', area: expForm.area }); setExpAdding(false) }
  }

  async function addRevenue(ev: EventWithCounts) {
    const amount = Math.round((parseFloat(revForm.amount.replace(',', '.')) || 0) * 100)
    if (!revForm.description.trim() || amount <= 0) return
    const { data } = await supabase.from('event_expenses').insert({ event_id: ev.id, house_id: house.id, description: revForm.description.trim(), amount_cents: amount, kind: 'revenue' }).select().single()
    if (data) { setBudgetExpenses(pp => [...pp, data as EventExpense]); setRevForm({ description: '', amount: '' }); setRevAdding(false) }
  }

  async function deleteExpense(id: string) {
    await supabase.from('event_expenses').delete().eq('id', id)
    setBudgetExpenses(pp => pp.filter(e => e.id !== id))
  }

  // Valor efetivo de uma linha do budget: usa o ajuste manual se existir, senão o calculado
  const effVal = (key: string, computed: number) => budgetOverrides[key]?.amount_cents ?? computed

  async function saveOverride(evId: string, key: string, label: string, amountCents: number) {
    const { data } = await supabase.from('event_budget_overrides')
      .upsert({ event_id: evId, house_id: house.id, row_key: key, label, amount_cents: amountCents }, { onConflict: 'event_id,row_key' })
      .select().single()
    if (data) setBudgetOverrides(p => ({ ...p, [key]: data as BudgetOverride }))
  }

  async function clearOverride(key: string) {
    const ov = budgetOverrides[key]; if (!ov) return
    await supabase.from('event_budget_overrides').delete().eq('id', ov.id)
    setBudgetOverrides(p => { const n = { ...p }; delete n[key]; return n })
  }

  async function updateExpenseAmount(id: string, cents: number) {
    const { data } = await supabase.from('event_expenses').update({ amount_cents: cents }).eq('id', id).select().single()
    if (data) setBudgetExpenses(pp => pp.map(e => e.id === id ? data as EventExpense : e))
  }

  function beginEdit(key: string, currentCents: number) {
    setEditKey(key)
    setEditVal((currentCents / 100).toFixed(2).replace('.', ','))
  }
  function parseEdit() { return Math.max(0, Math.round((parseFloat(editVal.replace(',', '.')) || 0) * 100)) }
  function commitOverride(evId: string, key: string, label: string) {
    saveOverride(evId, key, label, parseEdit()); setEditKey(null)
  }
  function commitExpenseEdit(id: string) {
    const c = parseEdit(); if (c > 0) updateExpenseAmount(id, c); setEditKey(null)
  }

  // Totais efetivos do budget (compartilhado entre o modal e a impressão), já com os ajustes manuais aplicados
  function budgetLeafTotals(ev: EventWithCounts) {
    const ab = artistsBreakdown(ev)
    const artistFees = ab.list.length > 0
      ? ab.list.map((a, i) => effVal('artist:' + i, a.fee_cents ?? 0))
      : [effVal('cache', ab.fee)]
    const cache = artistFees.reduce((s, v) => s + v, 0)
    const consumacao = effVal('consumacao', ab.cons)
    const producao = effVal('producao', ev.production_cost_cents ?? 0)
    // "Só quem compareceu": se houve algum check-in de equipe, conta apenas os presentes;
    // se ninguém deu check-in (planejamento OU não usaram o check-in), conta todos (estimativa).
    const anyFrIn = budgetFreelancers.some(ef => !!(ef as any).checkin_at)
    const freelancerTotal = budgetFreelancers
      .filter(ef => !anyFrIn || !!(ef as any).checkin_at)
      .reduce((s, ef) => s + effVal('fr:' + ef.id, custoFr(ef)), 0)
    const promoterTotal = budgetPromoters.reduce((s, l) => {
      const ent = Math.max(l.guest_count, l.min_entries)
      return s + effVal('promoter:' + l.id, l.fixed_fee_cents + ent * l.entry_fee_cents + ent * l.consumacao_cents)
    }, 0)
    const resItemsTotal = budgetResItems.reduce((s, i, idx) => s + effVal('resitem:' + idx, (i.quantity || 1) * (i.unit_cost_cents || 0)), 0)
    const taskAreaComputed: Record<string, number> = {}
    budgetTasks.forEach(t => { taskAreaComputed[t.area] = (taskAreaComputed[t.area] ?? 0) + (t.actual_cost_cents ?? t.estimated_cost_cents ?? 0) })
    const tasksTotal = Object.entries(taskAreaComputed).reduce((s, [area, v]) => s + effVal('taskarea:' + area, v), 0)
    const manualExp = budgetExpenses.filter(e => e.kind !== 'revenue')
    const expensesTotal = manualExp.reduce((s, e) => s + e.amount_cents, 0)
    const total = cache + consumacao + producao + freelancerTotal + promoterTotal + resItemsTotal + expensesTotal + tasksTotal
    const reservasRevenue = effVal('reservas', budgetRes.reduce((s, r) => s + (r.amount_cents ?? 0), 0))
    const checkinRev = effVal('checkin', budgetCheckinRev)
    const otherRevenue = budgetExpenses.filter(e => e.kind === 'revenue').reduce((s, e) => s + e.amount_cents, 0)
    const revenue = reservasRevenue + otherRevenue + checkinRev
    return { ab, artistFees, cache, consumacao, producao, freelancerTotal, promoterTotal, resItemsTotal, tasksTotal, taskAreaComputed, expensesTotal, total, reservasRevenue, checkinRev, otherRevenue, revenue, margin: revenue - total }
  }

  function printBudget(ev: EventWithCounts) {
    const B = budgetLeafTotals(ev)
    const { ab, cache, consumacao, producao, freelancerTotal, promoterTotal, resItemsTotal, tasksTotal, total, reservasRevenue, revenue, margin, checkinRev } = B
    const manualExp = budgetExpenses.filter(e => e.kind !== 'revenue')
    const otherRev = budgetExpenses.filter(e => e.kind === 'revenue')
    const fmt = (c: number) => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    const rowH = (label: string, val: number) => `<tr><td>${label}</td><td class="r">${fmt(val)}</td></tr>`
    // Despesas por área (avulsas)
    const expByArea: Record<string, EventExpense[]> = {}
    manualExp.forEach(e => { const k = e.area || '__geral__'; (expByArea[k] ||= []).push(e) })
    const areaLbl = (k: string) => k === '__geral__' ? '📦 Geral' : wlabel(k)
    const expAreaRows = Object.entries(expByArea).map(([k, items]) => {
      const at = items.reduce((s, e) => s + e.amount_cents, 0)
      return `<tr class="sub"><td>${areaLbl(k)}</td><td class="r">${fmt(at)}</td></tr>` +
        items.map(e => `<tr><td class="i">${e.description}</td><td class="r">${fmt(e.amount_cents)}</td></tr>`).join('')
    }).join('')
    const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fechamento — ${ev.name}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 28px; max-width: 800px; margin: 0 auto; color: #111; }
      h1 { font-size: 22px; margin: 0 0 4px; } .sub2 { color: #666; font-size: 13px; margin-bottom: 22px; text-transform: capitalize; }
      h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #444; margin: 22px 0 6px; border-bottom: 2px solid #333; padding-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      td { padding: 6px 8px; border-bottom: 1px solid #eee; }
      td.r { text-align: right; white-space: nowrap; }
      td.i { padding-left: 24px; color: #555; }
      tr.sub td { font-weight: 700; background: #f7f7f7; }
      .tot { display: flex; justify-content: space-between; font-size: 15px; font-weight: 800; padding: 10px 8px; border-top: 2px solid #333; }
      .grand { display: flex; justify-content: space-between; font-size: 20px; font-weight: 900; padding: 14px 8px; margin-top: 8px; border-top: 3px solid #111; }
      .footer { margin-top: 28px; font-size: 12px; color: #999; text-align: center; }
      @media print { body { padding: 12px; } }
    </style></head><body>
    <h1>💰 Fechamento — ${ev.name}</h1>
    <div class="sub2">📅 ${dateStr}</div>

    <h2>Receitas</h2>
    <table>${checkinRev > 0 ? rowH('🚪 Portaria (check-ins)', checkinRev) : ''}${rowH(`Reservas do dia (${budgetRes.length})`, reservasRevenue)}${otherRev.map(e => rowH('➕ ' + e.description, e.amount_cents)).join('')}</table>
    <div class="tot"><span>Total de receitas</span><span style="color:#0a7d34">${fmt(revenue)}</span></div>

    <h2>Despesas</h2>
    <table>
      ${ab.list.length > 0 ? ab.list.map((a, i) => rowH('🎤 ' + (a.name || `Artista ${i + 1}`), B.artistFees[i])).join('') : rowH('🎤 Cachê do artista', cache)}
      ${consumacao > 0 ? rowH('🍺 Consumação (artistas)', consumacao) : ''}
      ${producao > 0 ? rowH('🔧 Gastos de produção', producao) : ''}
      ${promos.length > 0 ? `<tr class="sub"><td colspan="2" style="font-size:11px;color:#888">🎉 Promoções (referência): ${promos.map(p => p.label).join(' · ')}</td></tr>` : ''}
      ${freelancerTotal > 0 ? rowH('👷 Freelancers', freelancerTotal) : ''}
      ${promoterTotal > 0 ? rowH('📋 Promoters', promoterTotal) : ''}
      ${resItemsTotal > 0 ? rowH('🪑 Reservas — opcionais', resItemsTotal) : ''}
      ${tasksTotal > 0 ? rowH('📋 Tarefas de produção', tasksTotal) : ''}
      ${expAreaRows ? `<tr class="sub"><td>💸 Outras despesas por área</td><td></td></tr>${expAreaRows}` : ''}
    </table>
    <div class="tot"><span>Total de despesas</span><span style="color:#b45309">${fmt(total)}</span></div>

    <div class="grand"><span>${margin >= 0 ? '🟢 MARGEM' : '🔴 PREJUÍZO'}</span><span style="color:${margin >= 0 ? '#0a7d34' : '#b91c1c'}">${fmt(margin)}</span></div>
    <div class="footer">Fechamento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — NightPass</div>
    <script>window.onload = () => window.print()</script>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  function openBudget(ev: EventWithCounts) {
    setBudgetEv(ev); setBudgetFreelancers([]); setBudgetPromoters([]); setBudgetResItems([]); setBudgetExpenses([]); setBudgetRes([]); setBudgetTasks([]); setBudgetCheckinRev(0); setExpAdding(false); setEditKey(null); setBudgetOverrides({})
    supabase.from('event_budget_overrides').select('*').eq('event_id', ev.id).then(r => {
      const m: Record<string, BudgetOverride> = {}; (r.data ?? []).forEach((o: BudgetOverride) => { m[o.row_key] = o }); setBudgetOverrides(m)
    })
    // Receita de portaria (check-ins pagantes do evento) — cortesia = R$0
    supabase.from('checkins').select('amount_cents,payment_method').eq('event_id', ev.id)
      .then(r => {
        const rev = (r.data ?? []).reduce((s, c) => s + (c.payment_method === 'cortesia' ? 0 : (c.amount_cents ?? 0)), 0)
        setBudgetCheckinRev(rev)
      })
    supabase.from('event_expenses').select('*').eq('event_id', ev.id).order('created_at').then(r => setBudgetExpenses((r.data ?? []) as EventExpense[]))
    supabase.from('reservations').select('id,name,location,people_count,amount_cents,status,archived_at').eq('house_id', house.id).eq('reservation_date', ev.event_date).neq('status', 'cancelled')
      .then(r => setBudgetRes(((r.data ?? []) as ProdReservation[]).filter(x => reservaConta(x, ev.event_date))))
    supabase.from('event_tasks').select('*').eq('event_id', ev.id).order('area').order('sort_order').then(r => setBudgetTasks((r.data ?? []) as EventTask[]))
    supabase.from('event_freelancers').select('*,freelancers(full_name,work_types,daily_rate_cents)')
      .eq('event_id', ev.id).then(r => setBudgetFreelancers((r.data ?? []) as EventFreelancer[]))
    supabase.from('promoter_lists').select('id,name,fixed_fee_cents,min_entries,entry_fee_cents,consumacao_cents,promoters(full_name)')
      .eq('event_id', ev.id).then(async r => {
        const lists = (r.data ?? []) as unknown as BudgetPromoterList[]
        const withCounts = await Promise.all(lists.map(async l => {
          const { count } = await supabase.from('promoter_list_guests').select('id', { count: 'exact', head: true }).eq('list_id', l.id)
          return { ...l, guest_count: count ?? 0 }
        }))
        setBudgetPromoters(withCounts as unknown as BudgetPromoterList[])
      })
    supabase.from('reservation_items').select('name,quantity,unit_cost_cents,reservations(id,name)')
      .eq('house_id', house.id)
      .then(async r => {
        const resIds = await supabase.from('reservations').select('id').eq('event_id', ev.id).eq('house_id', house.id)
        const ids = new Set((resIds.data ?? []).map((x: { id: string }) => x.id))
        const items = (r.data ?? [] as unknown[]) as (BudgetResItem & { reservations?: { id: string; name: string } })[]
        setBudgetResItems(items.filter(i => ids.has(i.reservations?.id ?? '')))
      })
  }

  function openTickets(ev: EventWithCounts) {
    setTicketEv(ev); setBatches([]); setOrders([]); closeBatchForm()
    supabase.from('ticket_batches').select('*').eq('event_id', ev.id).order('price_cents')
      .then(r => {
        if (r.error) { sT(setToast, `Erro ao carregar lotes: ${r.error.message}`, 'error'); return }
        setBatches((r.data ?? []) as TicketBatch[])
      })
    supabase.from('houses').select('pix_key,mp_access_token').eq('id', house.id).single()
      .then(r => setPayCfg({ pix: !!r.data?.pix_key, mp: !!r.data?.mp_access_token }))
    supabase.from('ticket_orders').select('*,ticket_batches(name,gender,price_cents)')
      .eq('event_id', ev.id).order('created_at', { ascending: false })
      .then(r => setOrders((r.data ?? []) as TicketOrder[]))
  }

  async function loadAllTickets() {
    setAllTkLdg(true)
    const [bR, oR] = await Promise.all([
      supabase.from('ticket_batches').select('*,events(name,event_date)')
        .eq('house_id', house.id).order('created_at'),
      supabase.from('ticket_orders').select('*,events(name),ticket_batches(name)')
        .eq('house_id', house.id).order('created_at', { ascending: false }),
    ])
    setAllTkLdg(false)
    if (bR.error) { sT(setToast, `Erro ao carregar ingressos: ${bR.error.message}`, 'error'); return }
    setAllBatches((bR.data ?? []) as (TicketBatch & { events?: { name: string; event_date: string } })[])
    const ords = (oR.data ?? []) as (TicketOrder & { events?: { name: string }; ticket_batches?: { name?: string } })[]
    setAllOrders(ords)
    setPendCount(ords.filter(o => o.payment_status === 'pending').length)
  }

  function openAllTickets() {
    setAllTk(true); setTkQuery(''); setTkDate(''); setTkScope('prox')
    setOpenBatch(null); closeBatchForm(); loadAllTickets()
  }

  // "Comprei mas perdi o link": reenvia o ingresso pelo WhatsApp direto da visão geral.
  // O link de recuperação só era mandado uma vez, na confirmação do pagamento.
  const [resending, setResending] = useState<string | null>(null)
  async function resendTicket(o: TicketOrder & { events?: { name?: string } }) {
    if (!o.buyer_phone) { sT(setToast, 'Este pedido não tem telefone cadastrado', 'warn'); return }
    setResending(o.id)
    const { data: tks } = await supabase.from('tickets').select('token')
      .eq('order_id', o.id).order('created_at').limit(1)
    const token = tks?.[0]?.token
    if (!token) {
      setResending(null)
      sT(setToast, o.payment_status === 'paid' ? 'Pedido sem ingresso gerado' : 'Confirme o pagamento antes de reenviar', 'warn')
      return
    }
    const link = `${window.location.origin}/ingresso/${token}`
    const msg = [
      '🎫 *Seu ingresso*', '',
      `*${o.events?.name ?? ''}*`,
      (o.quantity ?? 1) > 1 ? `${o.quantity} ingressos — o link abre todos.` : 'Abra o link para ver seu QR code:',
      link, '',
      '_Guarde este link. Ele abre seu ingresso a qualquer momento._',
    ].filter(Boolean).join('\n')
    const { ok, viaApi } = await sendWADirect(house.id, o.buyer_phone, msg, {
      type: 'ticket_delivery', eventId: o.event_id,
    })
    setResending(null)
    sT(setToast, ok ? (viaApi ? `Ingresso reenviado para ${o.buyer_name}` : 'WhatsApp aberto para envio manual') : 'Não foi possível enviar', ok ? 'success' : 'error')
  }

  // Badge de pendentes no botão: carrega sozinho ao abrir a página
  useEffect(() => {
    if (!canFeat('ingressos')) return
    supabase.from('ticket_orders').select('id', { count: 'exact', head: true })
      .eq('house_id', house.id).eq('payment_status', 'pending')
      .then(r => setPendCount(r.count ?? 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [house.id])

  const BATCH_DEF = { name: '', gender: 'both', price_cents: '', quantity: '', expires_at: '', service_fee_pct: '', nominal: false }

  /** Recarrega o que estiver aberto — o mesmo formulário serve ao modal do evento e à visão geral */
  function refreshTickets() {
    if (ticketEv) openTickets(ticketEv)
    if (allTk) loadAllTickets()
  }

  function startNewBatch(evId: string) {
    setEditingBatch(null)
    setBatchEvId(evId)
    setBatchForm(BATCH_DEF)
    setAddingBatch(true)
  }

  function startEditBatch(b: TicketBatch) {
    setEditingBatch(b)
    setBatchEvId(b.event_id)
    setBatchForm({
      name: b.name,
      gender: b.gender,
      price_cents: b.price_cents ? (b.price_cents / 100).toFixed(2).replace('.', ',') : '',
      quantity: String(b.quantity),
      // datetime-local exige 'YYYY-MM-DDTHH:mm' no horário local
      expires_at: b.expires_at ? toLocalInput(b.expires_at) : '',
      service_fee_pct: b.service_fee_pct ? String(b.service_fee_pct).replace('.', ',') : '',
      nominal: !!b.nominal,
    })
    setAddingBatch(true)
  }

  function closeBatchForm() { setAddingBatch(false); setEditingBatch(null); setBatchEvId(null) }

  async function saveBatch() {
    // Antes o save era silencioso: campo faltando dava `return` sem aviso e erro do banco
    // era ignorado (o form fechava do mesmo jeito), então parecia que nada acontecia.
    const nome = batchForm.name.trim()
    if (!nome) { sT(setToast, 'Dê um nome ao lote (ex: 1º Lote)', 'warn'); return }
    const qtd = parseInt(batchForm.quantity, 10)
    if (!qtd || qtd < 1) { sT(setToast, 'Informe a quantidade de ingressos', 'warn'); return }
    // Reduzir abaixo do já vendido deixaria o lote com saldo negativo na portaria
    if (editingBatch && qtd < editingBatch.sold) {
      sT(setToast, `Já foram vendidos ${editingBatch.sold} ingressos deste lote — a quantidade não pode ser menor`, 'warn'); return
    }
    if (!editingBatch && !batchEvId) { sT(setToast, 'Evento do lote não identificado', 'error'); return }

    setSavingBatch(true)
    const campos = {
      name: nome, gender: batchForm.gender,
      price_cents: Math.round((parseFloat(batchForm.price_cents.replace(',', '.')) || 0) * 100),
      quantity: qtd,
      expires_at: batchForm.expires_at || null,
      service_fee_pct: Math.max(0, parseFloat(batchForm.service_fee_pct.replace(',', '.')) || 0),
      nominal: batchForm.nominal,
    }
    const { data, error } = editingBatch
      ? await supabase.from('ticket_batches').update(campos).eq('id', editingBatch.id).select('id')
      : await supabase.from('ticket_batches')
          .insert({ ...campos, event_id: batchEvId!, house_id: house.id, sold: 0, active: true }).select('id')
    setSavingBatch(false)
    if (error || !data?.length) {
      sT(setToast, error?.message ?? 'Sem permissão para salvar o lote', 'error'); return
    }
    const editou = !!editingBatch
    setBatchForm(BATCH_DEF)
    closeBatchForm()
    refreshTickets()
    sT(setToast, editou ? `Lote "${nome}" atualizado` : `Lote "${nome}" criado e à venda`)
  }

  /** Formulário de lote — o mesmo nos dois modais (evento e visão geral) */
  function batchFormBox() {
    const bInp = { width: '100%', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }
    const bLbl = { color: C.mut, fontSize: 10, fontWeight: 700, letterSpacing: .3, display: 'block', marginBottom: 3 }
    return (
      <div style={{ background: C.bg, border: `1px solid ${editingBatch ? C.acc + '66' : C.brd}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ color: editingBatch ? C.acc : C.mut, fontSize: 11, fontWeight: 800, marginBottom: 10 }}>
          {editingBatch ? `✏️ EDITANDO "${editingBatch.name.toUpperCase()}"` : 'NOVO LOTE'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={bLbl}>NOME DO LOTE *</label>
            <input style={bInp} placeholder="ex: 1º Lote" value={batchForm.name}
              onChange={e => setBatchForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label style={bLbl}>PÚBLICO</label>
            <select style={bInp} value={batchForm.gender} onChange={e => setBatchForm(p => ({ ...p, gender: e.target.value }))}>
              <option value="both">Misto</option>
              <option value="male">Masculino</option>
              <option value="female">Feminino</option>
            </select>
          </div>
          <div>
            <label style={bLbl}>QUANTIDADE *{editingBatch && editingBatch.sold > 0 ? ` (mín. ${editingBatch.sold})` : ''}</label>
            {/* inputMode em vez de type=number: no teclado pt-BR o number rejeita vírgula e devolve vazio */}
            <input inputMode="numeric" style={bInp} placeholder="ex: 100" value={batchForm.quantity}
              onChange={e => setBatchForm(p => ({ ...p, quantity: e.target.value.replace(/\D/g, '') }))} />
          </div>
          <div>
            <label style={bLbl}>PREÇO R$ (0 = grátis)</label>
            <input inputMode="decimal" style={bInp} placeholder="ex: 20,00" value={batchForm.price_cents}
              onChange={e => setBatchForm(p => ({ ...p, price_cents: e.target.value.replace(/[^\d.,]/g, '') }))} />
          </div>
          <div>
            <label style={bLbl}>TAXA DE SERVIÇO (%)</label>
            <input inputMode="decimal" style={bInp} placeholder="ex: 10" value={batchForm.service_fee_pct}
              onChange={e => setBatchForm(p => ({ ...p, service_fee_pct: e.target.value.replace(/[^\d.,]/g, '') }))} />
          </div>
          <div>
            <label style={bLbl}>PRAZO DE VENDA (OPCIONAL)</label>
            <input type="datetime-local" style={bInp} value={batchForm.expires_at}
              onChange={e => setBatchForm(p => ({ ...p, expires_at: e.target.value }))} />
          </div>
        </div>
        {/* Nominal: pede o nome de cada participante na compra, para conferir na portaria */}
        <button onClick={() => setBatchForm(p => ({ ...p, nominal: !p.nominal }))}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: batchForm.nominal ? C.acc + '14' : 'transparent', border: `1px solid ${batchForm.nominal ? C.acc + '55' : C.brd}`, borderRadius: 9, padding: '8px 11px', marginBottom: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
          <span style={{ width: 30, height: 17, borderRadius: 99, background: batchForm.nominal ? C.acc : C.brd, position: 'relative', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 2, left: batchForm.nominal ? 15 : 2, width: 13, height: 13, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: batchForm.nominal ? C.acc : C.mut, fontSize: 12, fontWeight: 700 }}>🪪 Ingresso nominal</span>
            <span style={{ display: 'block', color: C.mut, fontSize: 10, marginTop: 2, lineHeight: 1.4 }}>
              Pede o nome de cada participante na compra. Dificulta revenda e permite conferir documento na entrada.
            </span>
          </span>
        </button>

        {(() => {
          const preco = Math.round((parseFloat(batchForm.price_cents.replace(',', '.')) || 0) * 100)
          const pct = parseFloat(batchForm.service_fee_pct.replace(',', '.')) || 0
          const taxa = Math.round(preco * pct / 100)
          if (preco <= 0 || taxa <= 0) return null
          return (
            <div style={{ color: C.mut, fontSize: 11, marginBottom: 10 }}>
              O comprador vê <b style={{ color: C.txt }}>{fmtCurrency(preco)}</b> + <b style={{ color: C.gold }}>{fmtCurrency(taxa)}</b> de taxa
              {' = '}<b style={{ color: C.txt }}>{fmtCurrency(preco + taxa)}</b> por ingresso
            </div>
          )
        })()}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={saveBatch} small disabled={savingBatch}>
            {savingBatch ? 'Salvando…' : editingBatch ? '💾 Salvar alterações' : '💾 Colocar à venda'}
          </Btn>
          <Btn onClick={closeBatchForm} small variant="ghost">Cancelar</Btn>
        </div>
      </div>
    )
  }

  async function toggleBatch(id: string, active: boolean) {
    const { data, error } = await supabase.from('ticket_batches').update({ active: !active }).eq('id', id).select('id')
    if (error || !data?.length) { sT(setToast, error?.message ?? 'Sem permissão para alterar o lote', 'error'); return }
    refreshTickets()
    sT(setToast, !active ? 'Lote à venda' : 'Venda pausada')
  }

  async function deleteBatch(b: TicketBatch) {
    // Pedidos referenciam o lote sem cascade: apagar com venda feita estoura FK e perde o histórico
    if (b.sold > 0) {
      sT(setToast, `"${b.name}" já vendeu ${b.sold} ingresso(s) e não pode ser excluído. Use ⏸ Pausar para tirar da venda.`, 'warn')
      return
    }
    if (!confirm(`Excluir o lote "${b.name}"?`)) return
    const { data, error } = await supabase.from('ticket_batches').delete().eq('id', b.id).select('id')
    if (error || !data?.length) { sT(setToast, error?.message ?? 'Sem permissão para excluir o lote', 'error'); return }
    refreshTickets()
    sT(setToast, 'Lote excluído')
  }

  async function confirmOrder(o: TicketOrder, status: string) {
    const eraPago = o.payment_status === 'paid'
    if (status === 'cancelled' && eraPago &&
        !confirm(`Cancelar o pedido pago de ${o.buyer_name}?\n\nOs ${o.quantity} ingresso(s) voltam ao estoque do lote e os QR codes deixam de valer na portaria.`)) return

    const { data, error } = await supabase.from('ticket_orders').update({ payment_status: status }).eq('id', o.id).select('id')
    if (error || !data?.length) { sT(setToast, error?.message ?? 'Sem permissão para alterar o pedido', 'error'); return }

    // Cancelar pedido pago devolvia nada: a cota ficava presa e sumia do estoque para sempre
    if (status === 'cancelled' && eraPago && o.batch_id) {
      const { error: eDev } = await supabase.rpc('increment_batch_sold', { p_batch_id: o.batch_id, p_qty: -(o.quantity ?? 0) })
      if (eDev) sT(setToast, `Pedido cancelado, mas a cota não voltou ao lote: ${eDev.message}`, 'warn')
    }

    if (ticketEv) openTickets(ticketEv)
    if (allTk) loadAllTickets()
    if (!(status === 'cancelled' && eraPago)) {
      sT(setToast, status === 'paid' ? 'Pagamento confirmado' : 'Pedido cancelado')
    } else {
      sT(setToast, `Pedido cancelado · ${o.quantity} ingresso(s) devolvidos ao lote`)
    }
  }

  function copyLink(ev: EventWithCounts) {
    const url = `${window.location.origin}/e/${ev.id}`
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  async function loadGuests(ev: EventWithCounts) {
    setGuestEv(ev)
    setGuests([])
    setGuestListToken(null)
    setGuestListId(null)
    setGuestListPromoId(null)
    setGuestAddForm({ name: '', phone: '', gender: '', birth_date: '' })
    setListaView('casa')
    setSelPromoter(null)
    setSelReserva(null)
    setReservaGuests({})
    setReservaGuestForm({ name: '', phone: '' })
    setListSummary([])
    setListReservas([])
    reloadGuests(ev.id)
    loadListSummary(ev)
    loadListReservas(ev)
    const rec = await ensureHouseListRecord(ev)
    if (rec) {
      setGuestListToken(rec.token)
      setGuestListId(rec.listId)
      setGuestListPromoId(rec.promoterId)
    }
  }

  function reloadGuests(eventId: string) {
    supabase.from('promoter_list_guests').select('id,list_id,full_name,phone,gender,birth_date,list_type,is_vip,checked_in,promoter_id,invite_token,list_value_cents,max_plus_ones,invited_by,confirmed_at')
      .eq('event_id', eventId).order('full_name')
      .then(r => setGuests((r.data ?? []) as Guest[]))
  }

  // Cria nova lista da casa com nome + valores ♂/♀ + VIP (usados no check-in)
  async function createHouseList() {
    if (!guestEv || !nhlForm.name.trim()) return
    let promoterId: string | undefined
    const { data: pr } = await supabase.from('promoters').select('id').eq('house_id', house.id).eq('full_name', 'Lista da Casa').limit(1).maybeSingle()
    promoterId = pr?.id
    if (!promoterId) {
      const { data: np } = await supabase.from('promoters').insert({ house_id: house.id, full_name: 'Lista da Casa', phone: '', commission_pct: 0, fixed_fee_cents: 0, min_entries: 0, entry_fee_cents: 0, consumacao_cents: 0 }).select('id').single()
      promoterId = np?.id
    }
    if (!promoterId) return
    const cents = (v: string) => Math.round((parseFloat(v.replace(',', '.')) || 0) * 100)
    const male = nhlForm.vip ? 0 : cents(nhlForm.male)
    const female = nhlForm.vip ? 0 : cents(nhlForm.female)
    const name = nhlForm.name.trim() + (nhlForm.vip ? ' · VIP' : '')
    const token = crypto.randomUUID()
    // Virada de horário: só faz sentido em lista com valor. Na VIP a entrada é grátis
    // até o horário e passa a valer o preço do evento depois — é o cutoff do próprio evento.
    const cut = nhlForm.cut.trim() || null
    const { data: nl } = await supabase.from('promoter_lists').insert({
      house_id: house.id, event_id: guestEv.id, promoter_id: promoterId, name, token,
      fixed_fee_cents: 0, min_entries: 0, entry_fee_cents: male,
      entry_fee_male_cents: male, entry_fee_female_cents: female, consumacao_cents: 0,
      cutoff_time: cut,
      early_male_cents: cut ? (nhlForm.vip ? 0 : cents(nhlForm.earlyM)) : null,
      early_female_cents: cut ? (nhlForm.vip ? 0 : cents(nhlForm.earlyF)) : null,
    }).select('id').single()
    if (nl) { setSelHouseListId(nl.id); loadListSummary(guestEv) }
    setNewHouseListOpen(false)
    setNhlForm({ name: '', male: '', female: '', vip: false, cut: '', earlyM: '', earlyF: '' })
  }

  // Abre o editor de parâmetros de uma lista (preços ♂/♀ + VIP sem horário)
  async function openEditList(listId: string, label: string) {
    setEditListOpen({ id: listId, label })
    const { data } = await supabase.from('promoter_lists')
      .select('entry_fee_male_cents,entry_fee_female_cents,entry_fee_cents,cutoff_exempt,fixed_fee_cents,min_entries,consumacao_cents').eq('id', listId).single()
    const male = data?.entry_fee_male_cents ?? data?.entry_fee_cents ?? 0
    const female = data?.entry_fee_female_cents ?? data?.entry_fee_cents ?? 0
    setEditListForm({
      male: male > 0 ? (male / 100).toFixed(2) : '',
      female: female > 0 ? (female / 100).toFixed(2) : '',
      cutoff_exempt: !!data?.cutoff_exempt,
      fixed: (data?.fixed_fee_cents ?? 0) > 0 ? ((data!.fixed_fee_cents) / 100).toFixed(2) : '',
      minEntries: (data?.min_entries ?? 0) > 0 ? String(data!.min_entries) : '',
      consumacao: (data?.consumacao_cents ?? 0) > 0 ? ((data!.consumacao_cents) / 100).toFixed(2) : '',
    })
  }

  async function saveEditList() {
    if (!editListOpen || editListSaving) return
    setEditListSaving(true)
    try {
      const cents = (v: string) => Math.round((parseFloat(v.replace(',', '.')) || 0) * 100)
      const male = cents(editListForm.male)
      const female = cents(editListForm.female)
      const { error } = await supabase.from('promoter_lists').update({
        entry_fee_cents: male, entry_fee_male_cents: male, entry_fee_female_cents: female,
        cutoff_exempt: editListForm.cutoff_exempt,
        fixed_fee_cents: cents(editListForm.fixed),
        min_entries: parseInt(editListForm.minEntries) || 0,
        consumacao_cents: cents(editListForm.consumacao),
      }).eq('id', editListOpen.id)
      if (error) { st2('Erro: ' + error.message, 'error'); return }
      st2('✅ Lista atualizada!', 'success')
      setEditListOpen(null)
      if (guestEv) loadListSummary(guestEv)
    } finally { setEditListSaving(false) }
  }

  // Exclui uma lista da casa (e seus convidados)
  async function deleteHouseList(listId?: string, listName?: string) {
    if (!guestEv || !listId) return
    if (!confirm(`Excluir a lista "${listName ?? ''}"? Os convidados cadastrados nela serão removidos.`)) return
    await supabase.from('promoter_list_guests').delete().eq('list_id', listId)
    await supabase.from('promoter_lists').delete().eq('id', listId)
    setSelHouseListId(null)
    st2('🗑️ Lista excluída', 'success')
    loadListSummary(guestEv)
    reloadGuests(guestEv.id)
  }

  // Agrega todas as listas geradas para o evento: casa, cada promoter, aniversários e reservas
  async function loadListSummary(ev: EventWithCounts) {
    setListSummary([])
    try {
      const [plists, blists, rsv] = await Promise.all([
        supabase.from('promoter_lists').select('id,name,token,promoter_id,entry_fee_cents,entry_fee_male_cents,entry_fee_female_cents,consumacao_cents,min_entries,promoters(full_name)').eq('event_id', ev.id),
        supabase.from('birthday_lists').select('id,birthday_person_name').eq('event_id', ev.id).neq('status', 'cancelled'),
        // Inclui reservas feitas para a data do evento mas sem event_id vinculado (mesma regra do card)
        supabase.from('reservations').select('id,people_count,status,event_id,reservation_date,archived_at')
          .eq('house_id', house.id).neq('status', 'cancelled')
          .or(`event_id.eq.${ev.id},reservation_date.eq.${ev.event_date}`),
      ])
      const rows: ListSummaryRow[] = []
      for (const l of (plists.data ?? []) as Array<{ id: string; name: string; token?: string; promoter_id?: string; entry_fee_cents?: number; entry_fee_male_cents?: number; entry_fee_female_cents?: number; consumacao_cents?: number; min_entries?: number; promoters?: { full_name?: string } | null }>) {
        const promoName = l.promoters?.full_name ?? l.name
        const isHouse = promoName === 'Lista da Casa'
        const customName = isHouse && l.name && l.name !== 'Lista da Casa' ? l.name : null
        rows.push({
          key: 'pl_' + l.id, kind: 'list', listId: l.id, token: l.token, promoterId: l.promoter_id, isHouse,
          icon: isHouse ? '🏠' : '📣',
          label: customName ?? (isHouse ? 'Lista da Casa' : `${promoName}${l.name && l.name !== promoName ? ' · ' + l.name : ''}`),
          count: 0,
          entryFee: l.entry_fee_cents ?? 0, entryMale: l.entry_fee_male_cents ?? 0, entryFemale: l.entry_fee_female_cents ?? 0,
          consumacao: l.consumacao_cents ?? 0, minEntries: l.min_entries ?? 0,
        })
      }
      for (const b of (blists.data ?? []) as Array<{ id: string; birthday_person_name: string }>) {
        const { count } = await supabase.from('birthday_guests').select('id', { count: 'exact', head: true }).eq('birthday_list_id', b.id)
        rows.push({ key: 'bd_' + b.id, kind: 'birthday', icon: '🎂', label: `Aniversário · ${b.birthday_person_name}`, count: count ?? 0 })
      }
      const resData = ((rsv.data ?? []) as Array<{ people_count?: number; event_id?: string | null; reservation_date?: string; archived_at?: string | null }>)
        .filter(row => row.event_id === ev.id || (!row.event_id && row.reservation_date === ev.event_date))
        .filter(row => reservaConta(row, ev.event_date))
      if (resData.length) rows.push({ key: 'res', kind: 'res', icon: '🪑', label: 'Reservas', count: resData.length, people: resData.reduce((s, r) => s + (r.people_count ?? 0), 0) })
      setListSummary(rows)
    } catch { /* schema opcional — ignora se alguma tabela não existir */ }
  }

  async function generateInviteToken(g: Guest): Promise<string> {
    if (g.invite_token) return g.invite_token
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    await supabase.from('promoter_list_guests').update({ invite_token: token }).eq('id', g.id!)
    return token
  }

  async function updateGuestField(guestId: string, fields: Partial<Guest>) {
    await supabase.from('promoter_list_guests').update(fields).eq('id', guestId)
    if (guestEv) reloadGuests(guestEv.id)
  }

  async function sendGuestInviteWA(g: Guest) {
    if (!g.phone) { st2('Convidado sem telefone', 'warn'); return }
    if (!guestEv) return
    const token = await generateInviteToken(g)
    reloadGuests(guestEv.id)
    const confirmLink = `${window.location.origin}/confirmar/${token}`
    const dateStr = new Date(guestEv.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    const plusMsg = (g.max_plus_ones ?? 0) > 0 ? `\n\n👥 Você pode trazer até *${g.max_plus_ones} amigo(s)* — compartilhe o link com eles também!` : ''
    const msg = `Olá ${g.full_name.split(' ')[0]}! 🎉\n\nVocê está na lista VIP de *${guestEv.name}* — ${dateStr}${guestEv.start_time ? ` às ${guestEv.start_time.slice(0,5)}` : ''}.${eventDetailsText(guestEv)}\n\n✅ Confirme sua presença com 1 clique:\n${confirmLink}${plusMsg}\n\nTe esperamos! 🔥`
    const r = await sendWADirect(house.id, g.phone, msg, { eventId: guestEv.id, type: 'guest_invite', mediaUrl: guestEv.flyer_url || house.logo_url || undefined })
    st2(r.viaApi ? '✅ Convite enviado pela API' : '📲 Abrindo WhatsApp...', 'success')
  }

  // Reenvia o link de confirmação só para quem recebeu convite e ainda não confirmou (pendentes)
  async function remindPending(row: ListSummaryRow) {
    if (!guestEv || !row.listId) return
    const pend = guests.filter(g => g.list_id === row.listId && g.invite_token && !g.confirmed_at && g.phone)
    if (!pend.length) { st2('Sem pendentes com telefone para lembrar.', 'warn'); return }
    const { data: cfg } = await supabase.from('whatsapp_config').select('active').eq('house_id', house.id).limit(1).single()
    if (!cfg?.active) { st2('Ative a integração WhatsApp em Configurações para enviar lembretes.', 'error'); return }
    if (!confirm(`Reenviar lembrete de confirmação para ${pend.length} pendente(s)?`)) return
    setRemindBusy(row.listId)
    const dateStr = new Date(guestEv.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    let ok = 0
    for (const g of pend) {
      const confirmLink = `${window.location.origin}/confirmar/${g.invite_token}`
      const msg = `Olá ${g.full_name.split(' ')[0]}! ⏰ Lembrete: você ainda não confirmou presença em *${guestEv.name}* — ${dateStr}${guestEv.start_time ? ` às ${guestEv.start_time.slice(0, 5)}` : ''}.${eventDetailsText(guestEv)}\n\n✅ Confirme com 1 clique:\n${confirmLink}\n\nTe esperamos! 🔥`
      const r = await sendWADirect(house.id, g.phone!, msg, { eventId: guestEv.id, type: 'guest_reminder' })
      if (r.viaApi) ok++
      await new Promise(res => setTimeout(res, 500))
    }
    setRemindBusy(null)
    st2(`Lembrete enviado para ${ok}/${pend.length} pendente(s).`, ok > 0 ? 'success' : 'warn')
  }

  // Suspende/reabre o cadastro público de um tipo de lista (Casa / Promoters / Reservas)
  async function toggleListLock(type: 'casa' | 'promoters' | 'reservas') {
    if (!guestEv) return
    const cur = guestEv.list_locks ?? {}
    const next = { ...cur, [type]: !cur[type] }
    setGuestEv(p => (p ? { ...p, list_locks: next } : p))
    setEvents(prev => prev.map(e => e.id === guestEv.id ? { ...e, list_locks: next } : e))
    const { error } = await supabase.from('events').update({ list_locks: next }).eq('id', guestEv.id)
    if (error) { st2('Erro ao atualizar: ' + error.message, 'error'); return }
    st2(next[type] ? '🔴 Lista suspensa — novos cadastros bloqueados.' : '🟢 Lista reaberta.', next[type] ? 'warn' : 'success')
  }

  // Suspende/reabre as TRÊS listas de uma vez (gatilho de lotação)
  async function setAllLocks(value: boolean) {
    if (!guestEv) return
    const next = { casa: value, promoters: value, reservas: value }
    setGuestEv(p => (p ? { ...p, list_locks: next } : p))
    setEvents(prev => prev.map(e => e.id === guestEv.id ? { ...e, list_locks: next } : e))
    const { error } = await supabase.from('events').update({ list_locks: next }).eq('id', guestEv.id)
    if (error) { st2('Erro ao atualizar: ' + error.message, 'error'); return }
    st2(value ? '🔴 Todas as listas suspensas (lotação).' : '🟢 Todas as listas reabertas.', value ? 'warn' : 'success')
  }

  // ── Reservas dentro do modal de listas ──
  function loadListReservas(ev: EventWithCounts) {
    // Inclui reservas feitas para a data do evento mas sem event_id vinculado (mesma regra do card)
    supabase.from('reservations')
      .select('id,name,phone,location,people_count,status,expected_arrival,observations,amount_cents,list_type,list_male_value_cents,list_female_value_cents,list_custom_value_cents,event_id,reservation_date,archived_at')
      .eq('house_id', house.id).neq('status', 'cancelled')
      .or(`event_id.eq.${ev.id},reservation_date.eq.${ev.event_date}`)
      .order('expected_arrival')
      .then(r => {
        const rows = ((r.data ?? []) as (RReserva & { event_id?: string | null; reservation_date?: string; archived_at?: string | null })[])
          .filter(row => row.event_id === ev.id || (!row.event_id && row.reservation_date === ev.event_date))
          .filter(row => reservaConta(row, ev.event_date))
        setListReservas(rows as RReserva[])
      })
  }
  function selectReserva(resId: string) {
    setSelReserva(resId)
    setReservaGuestForm({ name: '', phone: '' })
  }
  // Check-in de convidado de reserva: exige telefone + nascimento antes de liberar a entrada.
  async function toggleReservaGuestCheckin(resId: string, g: RGuestRow) {
    const v = !g.checked_in
    if (v && (!g.phone || !g.birth_date)) {
      setCompleteRGuest({ resId, guest: g })
      setCompleteRGForm({ phone: g.phone ?? '', birth_date: g.birth_date ?? '' })
      return
    }
    await supabase.from('reservation_guests').update({ checked_in: v, checked_in_at: v ? new Date().toISOString() : null }).eq('id', g.id)
    setReservaGuests(prev => ({ ...prev, [resId]: (prev[resId] ?? []).map(x => x.id === g.id ? { ...x, checked_in: v } : x) }))
  }
  // Salva telefone + nascimento e libera o check-in do convidado de reserva
  async function saveCompleteRGuest() {
    if (!completeRGuest) return
    const phone = completeRGForm.phone.replace(/\D/g, '')
    const birth_date = completeRGForm.birth_date
    if (!phone || !birth_date) { st2('Telefone e nascimento são obrigatórios para o check-in', 'warn'); return }
    const { resId, guest } = completeRGuest
    const now = new Date().toISOString()
    await supabase.from('reservation_guests').update({ phone, birth_date, checked_in: true, checked_in_at: now }).eq('id', guest.id)
    setReservaGuests(prev => ({ ...prev, [resId]: (prev[resId] ?? []).map(x => x.id === guest.id ? { ...x, phone, birth_date, checked_in: true } : x) }))
    setCompleteRGuest(null)
    st2('✅ Cadastro completo — check-in liberado!', 'success')
  }
  async function addReservaGuest(resId: string) {
    if (!reservaGuestForm.name.trim()) return
    const { data, error } = await supabase.from('reservation_guests').insert({
      reservation_id: resId, house_id: house.id,
      name: reservaGuestForm.name.trim(), phone: reservaGuestForm.phone.replace(/\D/g, '') || null, confirmed: true,
    }).select('id,name,phone,checked_in,confirmed').single()
    if (error) { st2('Erro ao adicionar: ' + error.message, 'error'); return }
    setReservaGuests(prev => ({ ...prev, [resId]: [...(prev[resId] ?? []), data as RGuestRow] }))
    setReservaGuestForm({ name: '', phone: '' })
  }

  // Chave de deduplicação: telefone (se houver) ou nome normalizado
  function dedupKey(name: string, phone: string | null): string {
    const ph = (phone ?? '').replace(/\D/g, '')
    return ph.length >= 8 ? 'p:' + ph : 'n:' + (name ?? '').trim().toLowerCase()
  }

  // Importa convidados de uma planilha (.xlsx/.xls/.csv) para a lista atual (Casa/Promoter/Reserva).
  // Sempre ignora duplicados (no arquivo e contra quem já está na lista).
  async function importListXlsx(file: File, opts: { reservaId?: string; listId?: string; promoterId?: string }) {
    if (!guestEv) return
    setImportingList(true)
    try {
      const parsed = await parseGuestsXlsx(file)
      if (!parsed.length) { st2('Nenhum convidado encontrado na planilha.', 'warn'); return }
      if (opts.reservaId) {
        const { data: ex } = await supabase.from('reservation_guests').select('name,phone').eq('reservation_id', opts.reservaId)
        const seen = new Set((ex ?? []).map(g => dedupKey(g.name ?? '', g.phone ?? null)))
        const uniq = parsed.filter(g => { const k = dedupKey(g.name, g.phone); if (seen.has(k)) return false; seen.add(k); return true })
        const rows = uniq.map(g => ({ reservation_id: opts.reservaId, house_id: house.id, name: g.name, phone: g.phone, birth_date: g.birth_date, confirmed: true }))
        for (let i = 0; i < rows.length; i += 200) await supabase.from('reservation_guests').insert(rows.slice(i, i + 200))
        const { data } = await supabase.from('reservation_guests').select('id,name,phone,checked_in,confirmed').eq('reservation_id', opts.reservaId).order('name')
        setReservaGuests(prev => ({ ...prev, [opts.reservaId!]: (data ?? []) as RGuestRow[] }))
        const dup = parsed.length - uniq.length
        st2(`✅ ${uniq.length} importado(s)${dup ? ` · ${dup} duplicado(s) ignorado(s)` : ''}`, 'success')
      } else if (opts.listId && opts.promoterId) {
        const { data: ex } = await supabase.from('promoter_list_guests').select('full_name,phone').eq('list_id', opts.listId)
        const seen = new Set((ex ?? []).map(g => dedupKey((g as { full_name?: string }).full_name ?? '', (g as { phone?: string }).phone ?? null)))
        const uniq = parsed.filter(g => { const k = dedupKey(g.name, g.phone); if (seen.has(k)) return false; seen.add(k); return true })
        const impRow = listSummary.find(r => r.kind === 'list' && r.listId === opts.listId)
        const impVip = /\bvip\b/i.test(impRow?.label ?? '')
        const rows = uniq.map(g => ({ list_id: opts.listId, house_id: house.id, event_id: guestEv.id, promoter_id: opts.promoterId, full_name: g.name, phone: g.phone, gender: g.gender, birth_date: g.birth_date, list_type: 'promoter', is_vip: impVip, promoter_confirmed: true, confirmed_at: new Date().toISOString() }))
        for (let i = 0; i < rows.length; i += 200) await supabase.from('promoter_list_guests').insert(rows.slice(i, i + 200))
        reloadGuests(guestEv.id)
        const dup = parsed.length - uniq.length
        st2(`✅ ${uniq.length} importado(s)${dup ? ` · ${dup} duplicado(s) ignorado(s)` : ''}`, 'success')
      } else { st2('Selecione a lista de destino antes de importar.', 'warn'); return }
    } catch (e) {
      st2('Erro ao importar: ' + ((e as Error)?.message ?? 'planilha inválida'), 'error')
    } finally {
      setImportingList(false)
    }
  }
  async function sendReservaWA(res: RReserva) {
    if (!res.phone) { st2('Reserva sem telefone cadastrado', 'warn'); return }
    if (!guestEv) return
    const dateStr = new Date(guestEv.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    const msg = `Olá ${res.name.split(' ')[0]}! 🎉 Sua reserva${res.location ? ` em *${res.location}*` : ''} para *${guestEv.name}* — ${dateStr}${guestEv.start_time ? ` às ${guestEv.start_time.slice(0, 5)}` : ''} está confirmada.${res.people_count ? `\n👥 ${res.people_count} pessoas` : ''}${eventDetailsText(guestEv)}\n\nTe esperamos! 🔥`
    const r = await sendWADirect(house.id, res.phone, msg, { eventId: guestEv.id, type: 'reservation_invite', mediaUrl: guestEv.flyer_url || house.logo_url || undefined })
    st2(r.viaApi ? '✅ Mensagem enviada pela API' : '📲 Abrindo WhatsApp...', 'success')
  }

  // ── Helpers de lista reutilizados nas visões Casa e Promoters ──
  function listStats(listId?: string) {
    const gs = guests.filter(g => g.list_id === listId)
    return {
      total: gs.length,
      enviados: gs.filter(g => g.invite_token).length,
      confirmados: gs.filter(g => g.confirmed_at).length,
      entraram: gs.filter(g => g.checked_in).length,
      pendentes: gs.filter(g => g.invite_token && !g.confirmed_at).length,
      confirmedGuests: gs.filter(g => g.confirmed_at),
    }
  }
  function renderGuestRow(g: Guest, editable: boolean) {
    return (
      <div key={g.id} style={{ background: C.bg, border: `1px solid ${g.is_vip ? C.gold + '44' : C.brd}`, borderRadius: 10, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: editable ? 8 : 0 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>{g.checked_in ? '✅' : g.gender === 'F' ? '♀' : g.gender === 'M' ? '♂' : '👤'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: g.checked_in ? C.grn : C.txt, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {g.full_name}
              {g.invited_by && <span style={{ color: C.mut, fontSize: 10, marginLeft: 6 }}>👥 convidado</span>}
              {g.is_vip && <span style={{ color: C.gold, fontSize: 10, marginLeft: 6 }}>⭐ VIP</span>}
            </div>
            <div style={{ color: C.mut, fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {g.phone && <span>📱 {g.phone}</span>}
              {g.confirmed_at && <span style={{ color: C.grn }}>✅ Confirmou</span>}
              {g.checked_in && <span style={{ color: C.grn, fontWeight: 700 }}>✓ Entrou</span>}
            </div>
          </div>
        </div>
        {editable && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => toggleGuestVip(g)}
              title={g.is_vip ? 'VIP ativo — clique para lista normal' : 'Lista normal — clique para VIP'}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: g.is_vip ? C.gold + '22' : C.card, border: `1.5px solid ${g.is_vip ? C.gold : C.brd}`, borderRadius: 20, padding: '3px 8px 3px 4px', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
              <span style={{ display: 'inline-flex', width: 28, height: 16, borderRadius: 10, background: g.is_vip ? C.gold : C.brd, position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}>
                <span style={{ position: 'absolute', top: 2, left: g.is_vip ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px #0004' }} />
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: g.is_vip ? C.gold : C.mut, minWidth: 28 }}>
                {g.is_vip ? '⭐ VIP' : 'Lista'}
              </span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: C.mut, fontSize: 10 }}>R$</span>
              <input type="number" min="0" step="0.01"
                value={g.list_value_cents ? (g.list_value_cents / 100).toFixed(2) : ''}
                onChange={e => updateGuestField(g.id!, { list_value_cents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                placeholder="0,00"
                style={{ width: 70, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '3px 7px', color: C.txt, fontSize: 11, fontFamily: 'inherit', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: C.mut, fontSize: 10 }}>👥</span>
              <input type="number" min="0" max="20"
                value={g.max_plus_ones ?? 0}
                onChange={e => updateGuestField(g.id!, { max_plus_ones: parseInt(e.target.value || '0') })}
                style={{ width: 45, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '3px 7px', color: C.txt, fontSize: 11, fontFamily: 'inherit', outline: 'none' }} />
            </div>
            {g.phone && !g.invited_by && (
              <button onClick={() => sendGuestInviteWA(g)}
                style={{ background: '#25d36614', border: '1px solid #25d36633', borderRadius: 7, padding: '3px 10px', color: '#25d366', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginLeft: 'auto' }}>
                {g.invite_token ? '🔄 Reenviar' : '📲 Convidar'}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
  async function addGuestManually(targetListId?: string, targetPromoterId?: string) {
    if (!guestAddForm.name.trim() || !guestEv) return
    setGuestAdding(true)
    // Lista alvo: a passada (Casa ou promoter selecionado) ou, na falta, garante a lista da casa
    let listId = targetListId ?? guestListId, promoId = targetPromoterId ?? guestListPromoId
    if (!listId || !promoId) {
      const rec = await ensureHouseListRecord(guestEv)
      if (rec) { listId = rec.listId; promoId = rec.promoterId; setGuestListId(rec.listId); setGuestListPromoId(rec.promoterId); setGuestListToken(rec.token) }
    }
    if (!listId || !promoId) { setGuestAdding(false); st2('Erro: lista não pôde ser criada', 'error'); return }
    // Se a lista alvo é VIP (nome contém "VIP"), o convidado já entra como VIP (toggle selecionado / entrada grátis)
    const targetRow = listSummary.find(r => r.kind === 'list' && r.listId === listId)
    const isVipList = /\bvip\b/i.test(targetRow?.label ?? '')
    const { error } = await supabase.from('promoter_list_guests').insert({
      list_id: listId,
      house_id: house.id,
      event_id: guestEv.id,
      promoter_id: promoId,
      full_name: guestAddForm.name.trim(),
      phone: guestAddForm.phone.replace(/\D/g, '') || null,
      gender: guestAddForm.gender || null,
      birth_date: guestAddForm.birth_date || null,
      list_type: 'promoter',
      is_vip: isVipList,
      promoter_confirmed: true,
      // Adição manual = o gestor garante a presença → já entra como confirmado na lista
      confirmed_at: new Date().toISOString(),
    })
    setGuestAdding(false)
    if (error) { st2('Erro ao adicionar: ' + error.message, 'error'); return }
    setGuestAddForm({ name: '', phone: '', gender: '', birth_date: '' })
    reloadGuests(guestEv.id)
    st2('Convidado adicionado!', 'success')
  }

  async function toggleGuestVip(g: Guest) {
    if (!g.id || !guestEv) return
    await supabase.from('promoter_list_guests').update({ is_vip: !g.is_vip }).eq('id', g.id)
    reloadGuests(guestEv.id)
  }

  // Exporta apenas quem efetivou check-in (entrou de fato) na visão atual
  function doExport(people: Array<{ name: string; gender?: string; birth_date?: string; is_vip?: boolean; checked_in?: boolean }>, suffix: string) {
    const checkedIn = people.filter(g => g.checked_in)
    if (checkedIn.length === 0) { st2('Nenhum check-in efetuado ainda para exportar.', 'warn'); return }
    const rows = [['Nome', 'Gênero', 'Nascimento', 'VIP']]
    checkedIn.forEach(g => rows.push([g.name, g.gender ?? '', g.birth_date ?? '', g.is_vip ? 'Sim' : '']))
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${guestEv?.name ?? 'lista'}-${suffix}-checkin.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function openNew() { setEditing(null); setForm(DEF); setArtists([]); setPromos([]); setModal(true) }

  // "Dia de operação": a casa abre sem evento, mas precisa de equipe escalada.
  // Cria um evento leve (is_operation) que reusa escala, check-in de equipe, tarefas, budget e agenda.
  const [opDayBusy, setOpDayBusy] = useState(false)
  async function createOperationDay(dateStr: string) {
    if (opDayBusy) return
    setOpDayBusy(true)
    try {
      const { data: exists } = await supabase.from('events').select('id,name')
        .eq('house_id', house.id).eq('event_date', dateStr).neq('status', 'cancelado').limit(1).maybeSingle()
      if (exists) { st2(`Já existe "${exists.name}" nesse dia — escale a equipe por ele.`, 'warn'); return }
      const d = new Date(dateStr + 'T12:00')
      const nome = `Operação — ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
      const { error } = await supabase.from('events').insert({
        house_id: house.id, name: nome, event_date: dateStr, genre: 'Operação',
        // Horário da casa, não 18h-02h fixo: uma padaria abre 6h, um restaurante 11h.
        start_time: (house.open_time ?? '18:00').slice(0, 5),
        end_time: (house.close_time ?? '02:00').slice(0, 5),
        status: 'ativo', is_operation: true,
        price_male_cents: 0, price_female_cents: 0, price_male_list_cents: 0, price_female_list_cents: 0,
      })
      if (error) { st2('Erro: ' + error.message, 'error'); return }
      st2(`✅ ${nome} criado — escale a equipe em Produção.`, 'success')
      load()
    } finally { setOpDayBusy(false) }
  }

  function openEdit(ev: EventWithCounts) {
    setEditing(ev.id)
    // Carrega o MESMO painel de Produção (tarefas, reservas, equipe e checklist) inline no cadastro
    openProd(ev)
    setForm({
      ...ev,
      price_male_cents: ((ev.price_male_cents ?? 0) / 100) || 0,
      price_female_cents: ((ev.price_female_cents ?? 0) / 100) || 0,
      price_male_list_cents: ((ev.price_male_list_cents ?? 0) / 100) || 0,
      price_female_list_cents: ((ev.price_female_list_cents ?? 0) / 100) || 0,
      list_cutoff_time: (ev.list_cutoff_time ?? '') as string,
      price_male_list_early_cents: ((ev.price_male_list_early_cents ?? 0) / 100) || 0,
      price_female_list_early_cents: ((ev.price_female_list_early_cents ?? 0) / 100) || 0,
      capacity: ev.capacity ?? '',
      consumption_cents: ((ev.consumption_cents ?? 0) / 100) || 0,
      production_cost_cents: ((ev.production_cost_cents ?? 0) / 100) || 0,
      promoter_enabled: !!ev.promoter_enabled,
      promoter_price_mode: ev.promoter_price_mode ?? 'list',
      promoter_price_cents: ((ev.promoter_price_cents ?? 0) / 100) || 0,
    })
    // Promoções: carrega do novo campo ou migra do texto antigo
    const savedPromos = ev.promotions_list ?? []
    if (savedPromos.length > 0) {
      setPromos(savedPromos.map(p => ({ label: p.label, value_cents: (p.value_cents ?? 0) / 100 })))
    } else if (ev.promotions && ev.promotions.trim()) {
      setPromos([{ label: ev.promotions, value_cents: 0 }])
    } else {
      setPromos([])
    }
    if (ev.house_list_enabled) {
      ensureHouseListRecord(ev)
    }
    setSpacePrices(((ev as any).space_prices as Record<string, number>) ?? {})
    // Load artists: from new column or migrate from old single fields
    const saved = ev.artists ?? []
    if (saved.length > 0) {
      setArtists(saved.map(a => ({ ...a, fee_cents: (a.fee_cents ?? 0) / 100, consumption_cents: (a.consumption_cents ?? 0) / 100 })))
    } else if ((ev as any).attractions) {
      setArtists([{ name: String((ev as any).attractions), fee_type: (ev as any).artist_fee_type ?? 'fixed', fee_cents: ((ev.artist_fee_cents ?? 0) / 100), fee_percent: (ev as any).artist_fee_percent ?? 0, consumption_cents: ((ev.consumption_cents ?? 0) / 100) }])
    } else {
      setArtists([])
    }
    setModal(true)
  }

  function setF(k: string, v: unknown) { setForm(p => ({ ...p, [k]: v })) }

  // Generate future occurrence dates for a repeat rule (excludes the base date)
  // Limits: weekly → 1 month; biweekly/monthly → 2 months
  function repeatDates(start: string, rule: string): string[] {
    if (rule === 'none' || !start) return []
    const out: string[] = []
    const months = rule === 'weekly' ? 1 : 2
    const horizon = new Date(start + 'T12:00'); horizon.setMonth(horizon.getMonth() + months)
    const base = new Date(start + 'T12:00')
    const stepDays = rule === 'weekly' ? 7 : rule === 'biweekly' ? 14 : 0
    for (let i = 1; out.length < 26 && i <= 60; i++) {
      const d = new Date(base)
      if (rule === 'monthly') d.setMonth(base.getMonth() + i)
      else d.setDate(base.getDate() + stepDays * i)
      if (d > horizon) break
      out.push(d.toISOString().slice(0, 10))
    }
    return out
  }

  async function ensureHouseListRecord(ev: EventWithCounts): Promise<{ token: string; listId: string; promoterId: string } | null> {
    let promoterId: string | undefined
    const { data: pr } = await supabase.from('promoters').select('id').eq('house_id', house.id).eq('full_name', 'Lista da Casa').limit(1).maybeSingle()
    promoterId = pr?.id
    if (!promoterId) {
      const { data: np } = await supabase.from('promoters').insert({ house_id: house.id, full_name: 'Lista da Casa', phone: '', commission_pct: 0, fixed_fee_cents: 0, min_entries: 0, entry_fee_cents: 0, consumacao_cents: 0 }).select('id').single()
      promoterId = np?.id
    }
    if (!promoterId) return null
    const { data: list } = await supabase.from('promoter_lists').select('id,token').eq('house_id', house.id).eq('event_id', ev.id).eq('promoter_id', promoterId).limit(1).maybeSingle()
    if (list) {
      if (list.token) return { token: list.token, listId: list.id, promoterId }
      const token = crypto.randomUUID()
      await supabase.from('promoter_lists').update({ token }).eq('id', list.id)
      return { token, listId: list.id, promoterId }
    }
    const token = crypto.randomUUID()
    const { data: newList } = await supabase.from('promoter_lists').insert({ house_id: house.id, event_id: ev.id, promoter_id: promoterId, name: 'Lista da Casa', token, fixed_fee_cents: 0, min_entries: 0, entry_fee_cents: 0, consumacao_cents: 0 }).select('id').single()
    return newList ? { token, listId: newList.id, promoterId } : null
  }

  async function openFlyer(ev: EventWithCounts) {
    setFlyerEv(ev); setFlyerSel(new Set()); setFlyerSearch(''); setFlyerGender('all'); setFlyerProgress({ sent: 0, total: 0 }); setFlyerClients([]); setFlyerListRec(null); setFlyerVip(false)
    const { data } = await supabase.from('clients').select('id,full_name,phone,gender').eq('house_id', house.id).not('phone', 'is', null).order('full_name')
    setFlyerClients((data ?? []) as FlyerClient[])
    const rec = await ensureHouseListRecord(ev)
    setFlyerListRec(rec)
    const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    const artistNames = (ev.artists ?? []).map(a => a.name).filter(n => n && n.trim())
    const linhaArtistas = artistNames.length > 0 ? `\n🎤 Atrações: ${artistNames.join(', ')}` : ''
    const promosArr = (ev.promotions_list ?? []).map(p => p.label).filter(l => l && l.trim())
    const promoText = promosArr.length ? promosArr.join(' · ') : (ev.promotions ?? '')
    const linhaPromo = promoText ? `\n🎉 ${promoText}` : ''
    const hasList = (ev.price_male_list_cents ?? 0) > 0 || (ev.price_female_list_cents ?? 0) > 0
    const valParts: string[] = hasList
      ? [(ev.price_male_list_cents ?? 0) > 0 ? `♂ ${fmtCurrency(ev.price_male_list_cents ?? 0)}` : '', (ev.price_female_list_cents ?? 0) > 0 ? `♀ ${fmtCurrency(ev.price_female_list_cents ?? 0)}` : ''].filter(Boolean)
      : [(ev.price_male_cents ?? 0) > 0 ? `♂ ${fmtCurrency(ev.price_male_cents ?? 0)}` : '', (ev.price_female_cents ?? 0) > 0 ? `♀ ${fmtCurrency(ev.price_female_cents ?? 0)}` : ''].filter(Boolean)
    const linhaValores = valParts.length ? `\n💵 ${hasList ? 'Lista' : 'Entrada'}: ${valParts.join(' · ')}` : ''
    // Link de confirmação é gerado individualmente por convidado em sendFlyer ({{link}})
    setFlyerMsg(`🎉 Olá {{nome}}! Não perca *${ev.name}* — ${dateStr}${ev.start_time ? ` às ${ev.start_time.slice(0, 5)}` : ''}!${linhaValores}${linhaArtistas}${linhaPromo}\n\n✅ Confirme sua presença com 1 clique:\n{{link}}\n\nTe esperamos! 🔥`)
  }

  async function sendFlyer() {
    if (!flyerEv) return
    const { data: cfg } = await supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1).single()
    if (!cfg?.active) { st2('Ative a integração WhatsApp em Configurações para enviar.', 'error'); return }
    const sel = flyerClients.filter(c => flyerSel.has(c.id) && c.phone)
    if (sel.length === 0) { st2('Selecione ao menos um contato.', 'warn'); return }
    let rec = flyerListRec
    if (!rec) { rec = await ensureHouseListRecord(flyerEv); setFlyerListRec(rec) }
    if (!rec) { st2('Erro: lista da casa não pôde ser criada.', 'error'); return }
    // 0 com toggle ligado = ilimitado (9999); toggle desligado = sem amigos (0)
    const effMaxFriends = flyerFriendsOn ? (flyerMaxFriends === 0 ? 9999 : flyerMaxFriends) : 0
    setFlyerSending(true); setFlyerProgress({ sent: 0, total: sel.length })
    let ok = 0
    for (const c of sel) {
      const fph = fmtWAPhone(c.phone ?? '')
      if (fph) {
        // Cria/reusa um registro de convidado para este cliente com token individual
        let token: string
        const { data: existing } = await supabase.from('promoter_list_guests')
          .select('id,invite_token').eq('list_id', rec.listId).eq('client_id', c.id).limit(1).maybeSingle()
        if (existing?.id) {
          token = existing.invite_token || (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))
          await supabase.from('promoter_list_guests').update({ invite_token: token, max_plus_ones: effMaxFriends, is_vip: flyerVip }).eq('id', existing.id)
        } else {
          token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
          const g = (c.gender ?? '').toLowerCase()
          const normGender = g === 'masculino' || g === 'm' ? 'M' : g === 'feminino' || g === 'f' ? 'F' : null
          await supabase.from('promoter_list_guests').insert({
            list_id: rec.listId, house_id: house.id, event_id: flyerEv.id, promoter_id: rec.promoterId,
            full_name: c.full_name, phone: (c.phone ?? '').replace(/\D/g, '') || null, gender: normGender,
            list_type: 'promoter', is_vip: flyerVip, promoter_confirmed: false,
            client_id: c.id, invite_token: token, max_plus_ones: effMaxFriends,
          })
        }
        const confirmLink = `${window.location.origin}/confirmar/${token}`
        const vipLine = flyerVip ? '⭐ *VOCÊ É NOSSO CONVIDADO VIP!*\n\n' : ''
        const msg = vipLine + flyerMsg
          .replace(/\{\{nome\}\}/g, (c.full_name || '').split(' ')[0])
          .replace(/\{\{link\}\}/g, confirmLink)
        const useMedia = !!flyerEv.flyer_url
        const body = useMedia
          ? { number: fph, mediatype: 'image', media: flyerEv.flyer_url, caption: msg }
          : { number: fph, text: msg }
        try {
          const resp = await fetch(`${cfg.api_url}/message/${useMedia ? 'sendMedia' : 'sendText'}/${cfg.instance_name}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.api_key }, body: JSON.stringify(body),
          })
          const res = await resp.json()
          const sent = !!(res?.key || res?.status === 'success' || res?.status === 'PENDING')
          if (sent) ok++
          await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: c.full_name, message_type: 'event_flyer', message_body: msg, status: sent ? 'sent' : 'failed', error_msg: sent ? null : JSON.stringify(res), related_client_id: c.id, related_event_id: flyerEv.id, sent_at: new Date().toISOString() })
        } catch (e: any) {
          await supabase.from('whatsapp_logs').insert({ house_id: house.id, recipient_phone: fph, recipient_name: c.full_name, message_type: 'event_flyer', message_body: msg, status: 'failed', error_msg: e?.message ?? 'erro', related_client_id: c.id, related_event_id: flyerEv.id })
        }
      }
      setFlyerProgress(pr => ({ ...pr, sent: pr.sent + 1 }))
      await new Promise(r => setTimeout(r, 500))
    }
    setFlyerSending(false)
    st2(`Flyer enviado para ${ok}/${sel.length} contato(s).`, ok > 0 ? 'success' : 'error')
  }

  // Convida/desconvida um promoter específico para o evento (no formulário)
  function togglePromoterInvite(id: string) {
    setForm(f => {
      const cur = Array.isArray((f as Record<string, unknown>).promoter_invites) ? ((f as Record<string, unknown>).promoter_invites as string[]) : []
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
      return { ...f, promoter_invites: next }
    })
  }

  // Envia o link do portal do promoter (garante que ele está convidado e persistido)
  async function sendPromoterEventLink(pr: { id: string; full_name: string; phone?: string }) {
    if (!editing) { st2('Salve o evento antes de enviar o link.', 'warn'); return }
    if (!pr.phone) { st2('Promoter sem telefone cadastrado', 'warn'); return }
    setInvitingPromoter(pr.id)
    // Garante convite salvo no evento
    const cur = Array.isArray(form.promoter_invites) ? (form.promoter_invites as string[]) : []
    if (!cur.includes(pr.id)) {
      const next = [...cur, pr.id]
      setF('promoter_invites', next)
      await supabase.from('events').update({ promoter_invites: next }).eq('id', editing)
    }
    // Garante token do portal
    let token: string | null = null
    const { data: ex } = await supabase.from('promoter_tokens').select('token').eq('promoter_id', pr.id).eq('house_id', house.id).eq('active', true).limit(1).maybeSingle()
    token = ex?.token ?? null
    if (!token) {
      const t = crypto.randomUUID()
      const { error } = await supabase.from('promoter_tokens').insert({ promoter_id: pr.id, house_id: house.id, token: t, active: true })
      if (error) { setInvitingPromoter(null); st2('Erro ao gerar portal: ' + error.message, 'error'); return }
      token = t
    }
    const link = `${window.location.origin}/p/${token}`
    const evName = String(form.name || 'nosso evento')
    const dateStr = form.event_date ? new Date(String(form.event_date) + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) : ''
    const msg = `Olá ${pr.full_name.split(' ')[0]}! 🎭\n\nVocê foi convidado(a) para montar lista no evento *${evName}*${dateStr ? ` — ${dateStr}` : ''}.\n\nAcesse seu portal:\n${link}\n\n_Link pessoal — guarde com você._`
    const r = await sendWADirect(house.id, pr.phone, msg, { eventId: editing, type: 'promoter_portal' })
    setInvitingPromoter(null)
    st2(r.viaApi ? '✅ Link enviado pela API' : '📲 Abrindo WhatsApp...', 'success')
  }

  // Cada promoção vira automaticamente um item na Produção (área 🎉 Promoções). Dedupe por título.
  async function syncPromoTasks(eventId: string, promoList: PromotionEntry[]) {
    const valid = promoList.filter(p => p.label.trim())
    if (!valid.length) return
    const { data: existing } = await supabase.from('event_tasks').select('id,title').eq('event_id', eventId).eq('area', 'Promoções')
    const have = new Set((existing ?? []).map(t => String((t as { title?: string }).title ?? '').trim().toLowerCase()))
    let sort = (existing ?? []).length
    const toAdd = valid.filter(p => !have.has(p.label.trim().toLowerCase()))
    if (!toAdd.length) return
    const rows = toAdd.map(p => ({
      event_id: eventId, house_id: house.id,
      area: 'Promoções', area_icon: '🎉',
      title: p.label.trim(),
      estimated_cost_cents: (p.value_cents ?? 0) > 0 ? Math.round((p.value_cents ?? 0) * 100) : null,
      sort_order: sort++, status: 'pending',
    }))
    await supabase.from('event_tasks').insert(rows)
  }

  function save() {
    // Campos que nao podem ir no payload: os contadores de tela (ver CAMPOS_SO_DA_TELA),
    // a chave e a data de criacao, e os campos de cache do artista que hoje vivem em
    // `artists`. Qualquer um deles faz o PostgREST recusar a gravacao inteira.
    const FORA_DO_PAYLOAD = new Set<string>([
      ...CAMPOS_SO_DA_TELA,
      'id', 'created_at',
      'artist_fee_cents', 'artist_fee_type', 'artist_fee_percent', 'consumption_cents',
    ])
    const formRest = Object.fromEntries(
      Object.entries(form as Record<string, unknown>).filter(([k]) => !FORA_DO_PAYLOAD.has(k)),
    )
    const d = {
      ...formRest,
      house_id: house.id,
      price_male_cents: Math.round((parseFloat(String(form.price_male_cents)) || 0) * 100),
      price_female_cents: Math.round((parseFloat(String(form.price_female_cents)) || 0) * 100),
      price_male_list_cents: Math.round((parseFloat(String(form.price_male_list_cents)) || 0) * 100),
      price_female_list_cents: Math.round((parseFloat(String(form.price_female_list_cents)) || 0) * 100),
      list_cutoff_time: (form.list_cutoff_time as string)?.trim() || null,
      price_male_list_early_cents: Math.round((parseFloat(String(form.price_male_list_early_cents)) || 0) * 100),
      price_female_list_early_cents: Math.round((parseFloat(String(form.price_female_list_early_cents)) || 0) * 100),
      capacity: form.capacity ? parseInt(String(form.capacity)) : null,
      artists: artists.map(a => ({ ...a, fee_cents: Math.round((a.fee_cents ?? 0) * 100), consumption_cents: Math.round((a.consumption_cents ?? 0) * 100) })),
      production_cost_cents: Math.round((parseFloat(String(form.production_cost_cents)) || 0) * 100),
      promoter_enabled: !!form.promoter_enabled,
      promoter_invites: Array.isArray(form.promoter_invites) ? (form.promoter_invites as string[]) : [],
      promoter_price_mode: String(form.promoter_price_mode ?? 'list'),
      promoter_price_cents: Math.round((parseFloat(String(form.promoter_price_cents)) || 0) * 100),
      promotions_list: promos.filter(p => p.label.trim() || p.value_cents > 0).map(p => ({ label: p.label.trim(), value_cents: Math.round((p.value_cents ?? 0) * 100) })),
      promotions: promos.filter(p => p.label.trim()).map(p => p.label.trim()).join(' · '),
      status: editing ? (form.status ?? 'ativo') : 'ativo',
      updated_at: new Date().toISOString(),
      space_prices: Object.keys(spacePrices).length > 0 ? spacePrices : null,
    }
    if (editing) {
      const eid = editing
      supabase.from('events').update(d).eq('id', eid).then(async r => {
        if (r.error) { st2('Erro: ' + r.error.message, 'error'); return }
        await syncPromoTasks(eid, promos)
        st2('Atualizado!'); setModal(false); setProdEv(null); setEditing(null); load()
      })
      return
    }
    // Create: generate future occurrences if a repeat rule is set
    const rule = String(form.repeat_rule ?? 'none')
    const extras = repeatDates(String(form.event_date ?? ''), rule).filter(dt => !eventDates.has(dt))
    const rows = [d, ...extras.map(dt => ({ ...d, event_date: dt, repeat_rule: 'none' }))]
    ;(async () => {
      const datas = rows.map(x => String((x as Record<string, unknown>).event_date ?? ''))
      // Dia de operação naquela data vira ESTE evento. Convertemos o registro em vez de
      // apagar e recriar: ele pode já ter ponto batido e tarefas feitas, e recriar
      // destruiria registro de jornada de quem trabalhou.
      const { data: ops } = await supabase.from('events')
        .select('id,event_date').eq('house_id', house.id).eq('is_operation', true)
        .in('event_date', datas).neq('status', 'cancelado')
      const opPorData = new Map((ops ?? []).map(o => [o.event_date as string, o.id as string]))

      const convertidos: EventWithCounts[] = []
      for (const [dt, opId] of opPorData) {
        const linha = rows.find(x => String((x as Record<string, unknown>).event_date) === dt)
        if (!linha) continue
        const { data: up } = await supabase.from('events')
          .update({ ...linha, is_operation: false }).eq('id', opId).select().single()
        if (up) convertidos.push(up as EventWithCounts)
      }
      const restantes = rows.filter(x => !opPorData.has(String((x as Record<string, unknown>).event_date)))

      const r = restantes.length > 0
        ? await supabase.from('events').insert(restantes).select()
        : { data: [] as unknown[], error: null }
      if (r.error) { st2('Erro: ' + r.error.message, 'error'); return }
      const createdRows = [...convertidos, ...((r.data ?? []) as EventWithCounts[])]
      st2(convertidos.length > 0
        ? `Criado! O Dia de operação virou este evento (escala e ponto preservados).`
        : (extras.length > 0 ? `Criado! +${extras.length} eventos repetidos` : 'Criado!'))
      load()
      // Cria os itens de Produção das promoções para cada evento criado (inclui repetições)
      // e vincula reservas já existentes daquela data (que ainda não têm evento) ao evento novo.
      for (const ev of createdRows) {
        await syncPromoTasks(ev.id, promos)
        await supabase.from('reservations')
          .update({ event_id: ev.id })
          .eq('house_id', house.id)
          .eq('reservation_date', ev.event_date)
          .is('event_id', null)
          .neq('status', 'cancelled')
      }
      // Funcionario fixo estara la de qualquer jeito: a escala nasce pronta pelo
      // calendario de trabalho de cada um. Nao duplica quem ja estiver escalado.
      let fixos = 0
      for (const ev of createdRows) {
        const { data: esc } = await supabase.rpc('escalar_fixos_no_evento', { p_event: ev.id })
        fixos += Number((esc as { escalados?: number } | null)?.escalados ?? 0)
      }
      if (fixos > 0) st2(`👷 ${fixos} funcionário(s) fixo(s) escalado(s) pelo calendário.`, 'success')

      const created = createdRows[0]
      if (created) {
        setEditing(created.id)
        setForm(f => ({ ...f, id: created.id, status: created.status ?? 'ativo' }))
      } else {
        setModal(false)
      }
    })()
  }

  async function generateRepeats() {
    const rule = String(form.repeat_rule ?? 'none')
    const dateStr = String(form.event_date ?? '')
    if (rule === 'none' || !dateStr) return
    const dates = repeatDates(dateStr, rule).filter(dt => !eventDates.has(dt))
    if (dates.length === 0) { st2('Nenhuma data nova a gerar (já existem eventos nessas datas).', 'warn'); return }
    const label = REPT.find(r => r.v === rule)?.l ?? rule
    const preview = dates.slice(0, 5).map(d => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })).join(', ')
    if (!confirm(`Gerar ${dates.length} eventos (${label})?\n\nPrimeiras datas: ${preview}${dates.length > 5 ? ` ... +${dates.length - 5} mais` : ''}`)) return
    const base = { ...form, house_id: house.id, repeat_rule: 'none', status: 'ativo', updated_at: new Date().toISOString() }
    // Remove client-only fields
    const { checkinCount, resCount, resPeople, listGuests, pagantesCount, cortesiasCount, tasksTotal, tasksDone, id: _id, created_at: _ca, ...rest } = base as Record<string, unknown>
    void checkinCount; void resCount; void resPeople; void listGuests; void pagantesCount; void cortesiasCount; void tasksTotal; void tasksDone
    const rows = dates.map(dt => ({ ...rest, event_date: dt }))
    const { error } = await supabase.from('events').insert(rows)
    if (error) { st2('Erro: ' + error.message, 'error'); return }
    st2(`✅ ${dates.length} eventos criados!`, 'success')
    load()
  }

  function cancelEv(ev: EventWithCounts) {
    if (ev.status === 'cancelado') {
      // Reativar não precisa de senha
      if (!confirm('Reativar este evento?')) return
      supabase.from('events').update({ status: 'ativo', updated_at: new Date().toISOString() }).eq('id', ev.id)
        .then(r => { if (!r.error) load(); else _err(r.error.message) })
      return
    }
    setCancelPin(''); setCancelConfirm({ ev, action: 'cancel' })
  }

  async function closeEv(ev: EventWithCounts) {
    setCancelPin(''); setCancelConfirm({ ev, action: 'close' })
  }

  function deleteEv(ev: EventWithCounts) {
    setCancelPin(''); setCancelConfirm({ ev, action: 'delete' })
  }

  async function execCancelConfirm() {
    if (!cancelConfirm) return
    const { ev, action } = cancelConfirm
    if (cancelPin.trim().toUpperCase() !== 'CONFIRMAR') { st2('Digite CONFIRMAR para prosseguir', 'warn'); return }
    setCancelConfirm(null); setCancelPin('')
    if (action === 'cancel') {
      await supabase.from('events').update({ status: 'cancelado', updated_at: new Date().toISOString() }).eq('id', ev.id)
    } else if (action === 'close') {
      const now = new Date().toISOString()
      await supabase.from('events').update({ status: 'encerrado', updated_at: now }).eq('id', ev.id)
      await supabase.from('reservations').update({ archived_at: now }).eq('house_id', house.id).eq('event_id', ev.id).is('archived_at', null)
    } else if (action === 'delete') {
      await supabase.from('events').delete().eq('id', ev.id)
    }
    load()
  }

  function openRes(ev: EventWithCounts) {
    setResEv(ev)
    supabase.from('reservations').select('*').eq('event_id', ev.id).order('expected_arrival')
      .then(r => setResList((r.data ?? []) as ResItem[]))
  }

  function openResView(ev: EventWithCounts) {
    setResViewEv(ev); setResViewList([])
    supabase.from('reservations').select('id,name,location,people_count,observations,status,expected_arrival,archived_at')
      .eq('house_id', house.id).or(`reservation_date.eq.${ev.event_date},event_id.eq.${ev.id}`).neq('status', 'cancelled')
      .order('location', { nullsFirst: false }).order('name')
      .then(r => setResViewList(((r.data ?? []) as ResView[]).filter(x => reservaConta(x, ev.event_date))))
  }

  function printResView(ev: EventWithCounts) {
    const rows = resViewList
    const totalPeople = rows.reduce((s, r) => s + (r.people_count ?? 0), 0)
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reservas — ${ev.name}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 32px; max-width: 900px; margin: 0 auto; color: #111; }
      h1 { font-size: 22px; margin: 0 0 4px; } .sub { color: #666; font-size: 13px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 8px; border-bottom: 2px solid #333; }
      td { padding: 9px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
      td.c, th.c { text-align: center; white-space: nowrap; }
      .loc { font-weight: 700; }
      .footer { margin-top: 28px; font-size: 12px; color: #999; text-align: center; }
      @media print { body { padding: 14px; } }
    </style></head><body>
    <h1>🪑 Reservas — ${ev.name}</h1>
    <div class="sub">📅 ${new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} &nbsp;·&nbsp; ${rows.length} reservas &nbsp;·&nbsp; ${totalPeople} pessoas</div>
    <table>
      <thead><tr><th class="c" style="width:70px">Local</th><th>Nome</th><th class="c" style="width:70px">Pessoas</th><th>Observação</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><td class="c loc">${r.location ?? '—'}</td><td>${r.name}</td><td class="c">${r.people_count ?? '-'}</td><td>${r.observations ?? ''}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="footer">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — NightPass</div>
    <script>window.onload = () => window.print()</script>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  function saveRes() {
    if (!resForm.name.trim() || !resEv) return
    const d = {
      house_id: house.id, event_id: resEv.id, name: resForm.name,
      people_count: parseInt(resForm.people_count) || 1,
      location: resForm.location, amount_cents: Math.round((parseFloat(resForm.amount_cents) || 0) * 100),
      expected_arrival: resForm.expected_arrival, status: 'pending',
    }
    const q = resEdit ? supabase.from('reservations').update(d).eq('id', resEdit) : supabase.from('reservations').insert(d)
    q.then(r => {
      if (r.error) { st2('Erro: ' + r.error.message, 'error'); return }
      setResEdit(null); setResForm(RDEF2); setResAddOpen(false); openRes(resEv)
    })
  }

  function delRes(id: string) {
    if (!confirm('Excluir reserva?')) return
    supabase.from('reservations').delete().eq('id', id).then(() => { if (resEv) openRes(resEv) })
  }

  function markArrived(id: string) {
    supabase.from('reservations').update({ status: 'arrived', arrived_at: new Date().toISOString() }).eq('id', id)
      .then(() => { if (resEv) openRes(resEv) })
  }

  // Flyer upload
  // Reduz o flyer antes de subir. Motivo: o robô de preview do WhatsApp ignora
  // imagens acima de ~600KB — flyers de 1MB+ chegavam sem foto no link compartilhado.
  async function compressFlyer(file: File): Promise<Blob> {
    const MAX_W = 1200, MAX_KB = 480
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
    try {
      const bmp = await createImageBitmap(file)
      const scale = Math.min(1, MAX_W / bmp.width)
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h
      const ctx = cv.getContext('2d'); if (!ctx) return file
      ctx.drawImage(bmp, 0, 0, w, h)
      // baixa a qualidade até caber no limite do preview
      for (const q of [0.85, 0.75, 0.65, 0.55]) {
        const blob = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/jpeg', q))
        if (blob && blob.size <= MAX_KB * 1024) return blob
        if (blob && q === 0.55) return blob
      }
      return file
    } catch { return file }
  }

  async function uploadFlyer(file: File): Promise<string | null> {
    const blob = await compressFlyer(file)
    const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() ?? 'png')
    const path = `${house.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('event-flyers')
      .upload(path, blob, { upsert: true, contentType: blob.type || file.type })
    if (error) { st2('Erro no upload: ' + error.message, 'error'); return null }
    const { data } = supabase.storage.from('event-flyers').getPublicUrl(path)
    if (blob.size < file.size) st2(`Flyer otimizado (${Math.round(file.size / 1024)}KB → ${Math.round(blob.size / 1024)}KB)`, 'success')
    return data.publicUrl
  }

  // Calendar helpers
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

  // Data de hoje em fuso LOCAL (não UTC) — senão à noite o evento de hoje já vira "passado"
  // e é arquivado cedo demais. Assim o evento só sai de Próximos 1 dia após a data.
  const _now = new Date()
  const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`
  const sortedAsc = [...events].sort((a, b) => a.event_date.localeCompare(b.event_date))
  const upcomingEvents = sortedAsc.filter(e => e.event_date >= todayStr)
  const pastEvents = [...sortedAsc.filter(e => e.event_date < todayStr)].reverse()
  // Pontinhos do calendário: na aba Próximos só datas futuras (>= hoje); na aba Arquivo só passadas
  const eventDates = new Set(
    events
      .filter(e => e.status !== 'encerrado' && e.status !== 'cancelado')
      .filter(e => showArchive ? e.event_date < todayStr : e.event_date >= todayStr)
      .map(e => e.event_date)
  )
  // Mês selecionado no calendário (YYYY-MM) — a lista mostra só os eventos desse mês
  const calPrefix = `${calY}-${String(calM + 1).padStart(2, '0')}`
  const inCalMonth = (e: EventWithCounts) => (e.event_date ?? '').slice(0, 7) === calPrefix
  const filteredEvents = selDate
    ? sortedAsc.filter(e => e.event_date === selDate && (showArchive ? e.event_date < todayStr : e.event_date >= todayStr))
    : showArchive ? pastEvents.filter(inCalMonth) : upcomingEvents.filter(inCalMonth)
  const inp = { style: { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 13, minHeight: 40, fontFamily: 'inherit', boxSizing: 'border-box' as const } }

  if (ldg) return <div style={{ padding: 60, textAlign: 'center', color: C.mut }}>Carregando...</div>

  const cbtn = (c: string) => ({ background: c, color: '#fff', border: 'none', justifyContent: 'center' as const, fontWeight: 700 })

  const AREA_GERAL = '__geral__'
  const renderExpenses = (all: EventExpense[], ev: EventWithCounts) => {
    const list = all.filter(e => e.kind !== 'revenue')
    const tot = list.reduce((s, e) => s + e.amount_cents, 0)
    // Agrupa por área
    const groups: Record<string, EventExpense[]> = {}
    list.forEach(e => { const k = e.area || AREA_GERAL; (groups[k] ||= []).push(e) })
    const areaName = (k: string) => k === AREA_GERAL ? '📦 Geral' : wlabel(k)
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: C.mut, fontWeight: 700 }}>💸 Outras despesas (por área){tot > 0 ? ` · ${fmtCurrency(tot)}` : ''}</span>
          {!expAdding && <button onClick={() => { setExpAdding(true); setExpForm(p => ({ description: '', amount: '', area: p.area })) }} style={{ background: '#f59e0b22', border: `1px solid #f59e0b44`, borderRadius: 6, padding: '3px 10px', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>− Despesa</button>}
        </div>
        {Object.entries(groups).map(([k, items]) => {
          const at = items.reduce((s, e) => s + e.amount_cents, 0)
          return (
            <div key={k} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.sub, fontWeight: 700, padding: '4px 0', borderBottom: `1px solid ${C.brd}` }}>
                <span>{areaName(k)}</span><span style={{ color: '#f59e0b' }}>{fmtCurrency(at)}</span>
              </div>
              {items.map(e => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0 4px 10px', borderBottom: `1px solid ${C.brd}22`, fontSize: 13 }}>
                  <span style={{ color: C.txt }}>{e.description}</span>
                  {editKey === 'exp:' + e.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input value={editVal} autoFocus onChange={ev2 => setEditVal(ev2.target.value)} onKeyDown={ev2 => { if (ev2.key === 'Enter') commitExpenseEdit(e.id); if (ev2.key === 'Escape') setEditKey(null) }} style={{ width: 84, background: C.bg, border: `1px solid ${C.acc}`, borderRadius: 6, padding: '3px 6px', color: C.txt, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
                      <button onClick={() => commitExpenseEdit(e.id)} title="Salvar" style={{ background: C.acc, border: 'none', borderRadius: 6, padding: '3px 7px', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                      <button onClick={() => setEditKey(null)} title="Cancelar" style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 6px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#f59e0b', fontWeight: 600 }}>{fmtCurrency(e.amount_cents)}</span>
                      <button onClick={() => beginEdit('exp:' + e.id, e.amount_cents)} title="Editar valor" style={{ background: 'none', border: 'none', color: C.mut, fontSize: 12, cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => deleteExpense(e.id)} title="Remover" style={{ background: 'none', border: 'none', color: C.red, fontSize: 13, cursor: 'pointer' }}>🗑</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })}
        {expAdding && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <select value={expForm.area} onChange={ev2 => setExpForm(pp => ({ ...pp, area: ev2.target.value }))} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 8px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }}>
              <option value="">📦 Geral</option>
              {workAreas.map(a => <option key={a.key} value={a.key}>{a.icon} {a.label}</option>)}
            </select>
            <input value={expForm.description} onChange={ev2 => setExpForm(pp => ({ ...pp, description: ev2.target.value }))} placeholder="Descrição (ex: gerador, gelo...)" autoFocus style={{ flex: 1, minWidth: 120, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
            <input value={expForm.amount} onChange={ev2 => setExpForm(pp => ({ ...pp, amount: ev2.target.value }))} onKeyDown={ev2 => ev2.key === 'Enter' && addExpense(ev)} placeholder="R$" style={{ width: 90, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
            <button onClick={() => addExpense(ev)} style={{ background: '#f59e0b', border: 'none', borderRadius: 8, padding: '7px 12px', color: '#1a1205', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>OK</button>
            <button onClick={() => setExpAdding(false)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
          </div>
        )}
        {list.length === 0 && !expAdding && <div style={{ fontSize: 12, color: C.mut }}>Nenhuma despesa avulsa.</div>}
      </div>
    )
  }

  const renderRevenues = (all: EventExpense[], ev: EventWithCounts) => {
    const list = all.filter(e => e.kind === 'revenue')
    const tot = list.reduce((s, e) => s + e.amount_cents, 0)
    return (
      <div style={{ marginTop: 4, marginBottom: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: C.mut, fontWeight: 700 }}>➕ Outras receitas{tot > 0 ? ` · ${fmtCurrency(tot)}` : ''}</span>
          {!revAdding && <button onClick={() => { setRevAdding(true); setRevForm({ description: '', amount: '' }) }} style={{ background: '#10b98122', border: `1px solid #10b98144`, borderRadius: 6, padding: '3px 10px', color: '#10b981', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ Receita</button>}
        </div>
        {list.map(e => (
          <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${C.brd}22`, fontSize: 13 }}>
            <span style={{ color: C.txt }}>{e.description}</span>
            {editKey === 'exp:' + e.id ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input value={editVal} autoFocus onChange={ev2 => setEditVal(ev2.target.value)} onKeyDown={ev2 => { if (ev2.key === 'Enter') commitExpenseEdit(e.id); if (ev2.key === 'Escape') setEditKey(null) }} style={{ width: 84, background: C.bg, border: `1px solid ${C.acc}`, borderRadius: 6, padding: '3px 6px', color: C.txt, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
                <button onClick={() => commitExpenseEdit(e.id)} title="Salvar" style={{ background: C.acc, border: 'none', borderRadius: 6, padding: '3px 7px', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                <button onClick={() => setEditKey(null)} title="Cancelar" style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 6px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#10b981', fontWeight: 600 }}>{fmtCurrency(e.amount_cents)}</span>
                <button onClick={() => beginEdit('exp:' + e.id, e.amount_cents)} title="Editar valor" style={{ background: 'none', border: 'none', color: C.mut, fontSize: 12, cursor: 'pointer' }}>✏️</button>
                <button onClick={() => deleteExpense(e.id)} title="Remover" style={{ background: 'none', border: 'none', color: C.red, fontSize: 13, cursor: 'pointer' }}>🗑</button>
              </div>
            )}
          </div>
        ))}
        {revAdding && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input value={revForm.description} onChange={ev2 => setRevForm(pp => ({ ...pp, description: ev2.target.value }))} placeholder="Descrição (ex: bar, patrocínio...)" autoFocus style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
            <input value={revForm.amount} onChange={ev2 => setRevForm(pp => ({ ...pp, amount: ev2.target.value }))} onKeyDown={ev2 => ev2.key === 'Enter' && addRevenue(ev)} placeholder="R$" style={{ width: 90, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
            <button onClick={() => addRevenue(ev)} style={{ background: '#10b981', border: 'none', borderRadius: 8, padding: '7px 12px', color: '#04210f', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>OK</button>
            <button onClick={() => setRevAdding(false)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
          </div>
        )}
      </div>
    )
  }

  // Executor da tarefa: puxa do cadastro de equipe (freelancers) e preenche nome+celular
  const executorSelect = () => (
    <select value="" onChange={e => { const f = allFreelancers.find(x => x.id === e.target.value); if (f) setTaskForm(p => ({ ...p, assignee_name: f.full_name, assignee_phone: f.phone ?? '', assignee_id: f.id })) }}
      style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.mut, fontSize: 12, fontFamily: 'inherit', marginBottom: 6 }}>
      <option value="">👤 Vincular executor da equipe…</option>
      {allFreelancers.map(f => <option key={f.id} value={f.id}>{f.full_name}{f.phone ? ` · ${f.phone}` : ''}</option>)}
    </select>
  )

  const renderProdTabs = () => (
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {(['tasks', 'freelancers'] as const).map(tab => {
                  const labels = { tasks: '📋 Tarefas', freelancers: `👥 Equipe (${prodFr.length})`, budget: '💰 Budget' }
                  return (
                    <button key={tab} onClick={() => setProdTab(tab)} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${prodTab === tab ? '#f59e0b' : C.brd}`, background: prodTab === tab ? '#f59e0b22' : 'transparent', color: prodTab === tab ? '#f59e0b' : C.mut, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {labels[tab]}
                    </button>
                  )
                })}
                {prodEv && (
                  <button onClick={() => openBudget(prodEv)} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid #10b98144`, background: '#10b98115', color: '#10b981', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    💰 Budget
                  </button>
                )}
              </div>
  )

  const renderProdBody = () => (
    <>

              {/* ── TAB: TAREFAS ── */}
              {prodTab === 'tasks' && (() => {
                const areas: Record<string, { icon: string; tasks: EventTask[] }> = {}
                prodTasks.forEach(t => {
                  if (!areas[t.area]) areas[t.area] = { icon: t.area_icon, tasks: [] }
                  areas[t.area].tasks.push(t)
                })
                return (
                  <div>
                    {/* Reservas do dia */}
                    {prodRes.length > 0 && (
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>🪑 Reservas do dia ({prodRes.length})</span>
                          <span style={{ color: C.mut, fontWeight: 400 }}>{prodRes.filter(r => r.status === 'arrived').length} chegaram</span>
                        </div>
                        {prodRes.map(r => (
                          <div key={r.id} style={{ background: r.status === 'arrived' ? '#10b98110' : 'var(--c-panel)', border: `1px solid ${r.status === 'arrived' ? '#10b98133' : C.brd}`, borderRadius: 10, padding: '8px 12px', marginBottom: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div>
                                <span style={{ fontWeight: 700, fontSize: 13, color: C.txt }}>{r.name}</span>
                                {r.location && <span style={{ color: C.mut, fontSize: 12 }}> · 📍 {r.location}</span>}
                                {r.people_count && <span style={{ color: C.mut, fontSize: 12 }}> · 👥 {r.people_count}px</span>}
                              </div>
                              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: r.status === 'arrived' ? '#10b98122' : '#f59e0b22', color: r.status === 'arrived' ? '#10b981' : '#f59e0b', fontWeight: 700 }}>
                                {r.status === 'arrived' ? '✅ Chegou' : '⏳ Aguardando'}
                              </span>
                            </div>
                            {(r.reservation_items ?? []).length > 0 && (
                              <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.brd}22` }}>
                                <span style={{ fontSize: 10, color: C.mut, fontWeight: 700, marginRight: 4 }}>OPCIONAIS:</span>
                                {(r.reservation_items ?? []).map((item, i) => (
                                  <span key={i} style={{ display: 'inline-block', background: '#a78bfa22', color: '#a78bfa', border: '1px solid #a78bfa33', borderRadius: 6, padding: '1px 8px', fontSize: 11, marginRight: 4, marginBottom: 2 }}>
                                    {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            {r.observations && (
                              <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.brd}22`, fontSize: 12, color: C.gold, display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                                <span style={{ flexShrink: 0 }}>📝</span><span style={{ fontStyle: 'italic', lineHeight: 1.4 }}>{r.observations}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Areas with tasks */}
                    {Object.entries(areas).map(([area, { icon, tasks }]) => {
                      const done = tasks.filter(t => t.status === 'done').length
                      const isAdding = taskFormArea === `${area}|||${icon}`
                      return (
                        <div key={area} style={{ marginBottom: 18 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.brd}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 16 }}>{icon}</span>
                              <span style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{area}</span>
                              <span style={{ color: C.brd, fontSize: 11 }}>({done}/{tasks.length})</span>
                            </div>
                            <button onClick={() => { setTaskFormArea(`${area}|||${icon}`); setTaskForm({ title: '', deadline: '', assignee_name: '', assignee_phone: '', estimated_cost_cents: '', description: '', assignee_id: '' }) }}
                              style={{ background: 'var(--c-panel2)', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.mut, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>+ Tarefa</button>
                          </div>
                          {tasks.sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)).map(task => (
                            <div key={task.id} style={{ background: task.status === 'done' ? '#10b98108' : 'var(--c-panel)', border: `1px solid ${task.status === 'done' ? '#10b98122' : C.brd}`, borderRadius: 10, padding: '8px 10px', marginBottom: 5 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button onClick={() => toggleProdTask(task)} style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${task.status === 'done' ? '#10b981' : C.brd}`, background: task.status === 'done' ? '#10b981' : 'transparent', color: '#fff', fontSize: 12, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {task.status === 'done' ? '✓' : ''}
                                </button>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: task.status === 'done' ? C.mut : C.txt, textDecoration: task.status === 'done' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
                                  <div style={{ display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                                    {task.deadline && <span style={{ color: C.mut, fontSize: 11 }}>⏰ {new Date(task.deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>}
                                    {task.assignee_name && <span style={{ color: C.mut, fontSize: 11 }}>👤 {task.assignee_name}</span>}
                                    {task.estimated_cost_cents && <span style={{ color: '#f59e0b', fontSize: 11 }}>R$ {(task.estimated_cost_cents / 100).toFixed(2)}</span>}
                                    {task.actual_cost_cents && <span style={{ color: '#10b981', fontSize: 11, fontWeight: 700 }}>✅ R$ {(task.actual_cost_cents / 100).toFixed(2)}</span>}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                  {task.assignee_phone && (
                                    <button onClick={() => sendTaskWA(task)} title="Enviar por WhatsApp" style={{ background: '#25d36622', border: '1px solid #25d36644', borderRadius: 6, width: 28, height: 28, color: '#25d366', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📲</button>
                                  )}
                                  <button onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)} style={{ background: 'var(--c-panel2)', border: `1px solid ${C.brd}`, borderRadius: 6, width: 28, height: 28, color: C.mut, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⋯</button>
                                  <button onClick={() => deleteProdTask(task.id)} style={{ background: 'none', border: `1px solid ${C.red}33`, borderRadius: 6, width: 28, height: 28, color: C.red, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🗑</button>
                                </div>
                              </div>
                              {expandedTask === task.id && (
                                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.brd}22`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {task.description && <div style={{ fontSize: 12, color: C.mut }}>{task.description}</div>}
                                  {task.status === 'done' && (
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                      <span style={{ fontSize: 11, color: C.mut }}>Custo real:</span>
                                      {actualCostEdit?.id === task.id
                                        ? <>
                                            <input value={actualCostEdit.val} onChange={e => setActualCostEdit({ id: task.id, val: e.target.value })} placeholder="R$" style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.txt, fontSize: 12, width: 80, fontFamily: 'inherit' }} autoFocus />
                                            <button onClick={() => saveProdActualCost(task.id, actualCostEdit.val)} style={{ background: '#10b98122', border: '1px solid #10b98144', borderRadius: 6, padding: '3px 8px', color: '#10b981', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                                          </>
                                        : <button onClick={() => setActualCostEdit({ id: task.id, val: task.actual_cost_cents ? String(task.actual_cost_cents / 100) : '' })} style={{ background: 'var(--c-panel2)', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.mut, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                                            {task.actual_cost_cents ? `R$ ${(task.actual_cost_cents / 100).toFixed(2)}` : '+ Informar'}
                                          </button>
                                      }
                                    </div>
                                  )}
                                  <div style={{ fontSize: 11, color: C.mut }}>
                                    🔗 Link: <span style={{ color: '#a78bfa', cursor: 'pointer' }} onClick={() => navigator.clipboard.writeText(`${window.location.origin}/tarefa.html?t=${task.token}`)}>Copiar</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                          {isAdding && (
                            <div style={{ background: 'var(--c-panel)', border: `1px solid #f59e0b44`, borderRadius: 10, padding: '10px 12px', marginBottom: 5 }}>
                              <input value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} placeholder="Título da tarefa *" autoFocus onKeyDown={e => e.key === 'Enter' && addProdTask(area, icon)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 6 }} />
                              {executorSelect()}
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                                <input type="datetime-local" value={taskForm.deadline} onChange={e => setTaskForm(p => ({ ...p, deadline: e.target.value }))} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
                                <input value={taskForm.estimated_cost_cents} onChange={e => setTaskForm(p => ({ ...p, estimated_cost_cents: e.target.value }))} placeholder="Valor estimado (R$)" style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
                                <input value={taskForm.assignee_name} onChange={e => setTaskForm(p => ({ ...p, assignee_name: e.target.value }))} placeholder="Responsável (nome)" style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
                                <input value={taskForm.assignee_phone} onChange={e => setTaskForm(p => ({ ...p, assignee_phone: e.target.value }))} placeholder="Celular" style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
                              </div>
                              <input value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))} placeholder="Descrição / obs (opcional)" style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit', marginBottom: 6 }} />
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => addProdTask(area, icon)} style={{ background: 'linear-gradient(135deg,#d97706,#f59e0b)', border: 'none', borderRadius: 8, padding: '7px 16px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Salvar</button>
                                <button onClick={() => addProdTask(area, icon, true)} title="Salva a tarefa sem responsável para delegar depois" style={{ background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 8, padding: '7px 14px', color: '#a78bfa', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📌 Delegar depois</button>
                                <button onClick={() => setTaskFormArea(null)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Nova área recém-criada (ainda sem tarefas) → formulário da 1ª tarefa */}
                    {(() => {
                      const [formArea, formIcon] = (taskFormArea ?? '').split('|||')
                      if (!formArea || areas[formArea]) return null
                      return (
                        <div style={{ marginBottom: 18 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.brd}` }}>
                            <span style={{ fontSize: 16 }}>{formIcon}</span>
                            <span style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{formArea}</span>
                            <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>nova área</span>
                          </div>
                          <div style={{ background: 'var(--c-panel)', border: `1px solid #f59e0b44`, borderRadius: 10, padding: '10px 12px' }}>
                            <input value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} placeholder="Título da 1ª tarefa *" autoFocus onKeyDown={e => e.key === 'Enter' && addProdTask(formArea, formIcon)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 6 }} />
                            {executorSelect()}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                              <input type="datetime-local" value={taskForm.deadline} onChange={e => setTaskForm(p => ({ ...p, deadline: e.target.value }))} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
                              <input value={taskForm.estimated_cost_cents} onChange={e => setTaskForm(p => ({ ...p, estimated_cost_cents: e.target.value }))} placeholder="Valor estimado (R$)" style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
                              <input value={taskForm.assignee_name} onChange={e => setTaskForm(p => ({ ...p, assignee_name: e.target.value }))} placeholder="Responsável (nome)" style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
                              <input value={taskForm.assignee_phone} onChange={e => setTaskForm(p => ({ ...p, assignee_phone: e.target.value }))} placeholder="Celular" style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }} />
                            </div>
                            <input value={taskForm.description} onChange={e => setTaskForm(p => ({ ...p, description: e.target.value }))} placeholder="Descrição / obs (opcional)" style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit', marginBottom: 6 }} />
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => addProdTask(formArea, formIcon)} style={{ background: 'linear-gradient(135deg,#d97706,#f59e0b)', border: 'none', borderRadius: 8, padding: '7px 16px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Salvar tarefa</button>
                              <button onClick={() => addProdTask(formArea, formIcon, true)} title="Salva a tarefa sem responsável para delegar depois" style={{ background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 8, padding: '7px 14px', color: '#a78bfa', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📌 Delegar depois</button>
                              <button onClick={() => setTaskFormArea(null)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Add new area */}
                    {addingArea
                      ? (
                        <div style={{ background: 'var(--c-panel)', border: `1px solid #f59e0b44`, borderRadius: 10, padding: '12px 14px', marginTop: 8 }}>
                          <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700, marginBottom: 8 }}>Nova Área</div>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <input value={newAreaIcon} onChange={e => setNewAreaIcon(e.target.value)} placeholder="Emoji" style={{ width: 60, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 18, fontFamily: 'inherit', textAlign: 'center' }} />
                            <input value={newAreaName} onChange={e => setNewAreaName(e.target.value)} placeholder="Nome da área (ex: Decoração)" autoFocus onKeyDown={e => e.key === 'Enter' && addProdArea()} style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }} />
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={addProdArea} style={{ background: 'linear-gradient(135deg,#d97706,#f59e0b)', border: 'none', borderRadius: 8, padding: '7px 16px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Criar Área</button>
                            <button onClick={() => setAddingArea(false)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
                          </div>
                        </div>
                      )
                      : (
                        <button onClick={() => setAddingArea(true)} style={{ width: '100%', background: 'var(--c-panel)', border: `1px dashed ${C.brd}`, borderRadius: 10, padding: '10px', color: C.mut, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: Object.keys(areas).length > 0 ? 0 : 8 }}>
                          ➕ Nova Área
                        </button>
                      )
                    }
                    {prodTasks.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.brd}` }}>
                        <button onClick={printProdCosts} style={{ flex: 1, background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 0', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>🖨️ Planilha</button>
                        <button onClick={exportProdCostsCsv} style={{ flex: 1, background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 0', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>📥 CSV</button>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* ── TAB: EQUIPE (por área → freelancer) ── */}
              {prodTab === 'freelancers' && (() => {
                const roleOf = (fr: EventFreelancer) => (fr.role || (fr as any).freelancers?.work_types?.[0] || 'outros')
                const roleLabel = (r: string) => wlabel(r)
                const groups: Record<string, EventFreelancer[]> = {}
                prodFr.forEach(fr => { const r = roleOf(fr); (groups[r] ||= []).push(fr) })
                const frTotal = prodFr.reduce((s, f) => s + (f.custom_fee_cents ?? (f as any).freelancers?.daily_rate_cents ?? 0), 0)

                const memberRow = (fr: EventFreelancer) => {
                  const frData = (fr as any).freelancers
                  const dailyRate = frData?.daily_rate_cents ?? 0
                  const effectiveFee = fr.custom_fee_cents ?? dailyRate
                  return (
                    <div key={fr.id} style={{ background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: C.txt }}>{frData?.full_name ?? '—'}</div>
                          <div style={{ fontSize: 11, color: C.mut, marginTop: 2 }}>{(frData?.work_types ?? []).map((wt: string) => wlabel(wt)).join(' · ')}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {frFeeEdit?.id === fr.id
                            ? <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <input value={frFeeEdit.val} onChange={e => setFrFeeEdit({ id: fr.id, val: e.target.value })} placeholder="R$" style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.txt, fontSize: 12, width: 80, fontFamily: 'inherit' }} autoFocus />
                                <button onClick={() => saveFrFee(fr.id, frFeeEdit.val)} style={{ background: '#10b98122', border: '1px solid #10b98144', borderRadius: 6, padding: '3px 8px', color: '#10b981', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                              </div>
                            : <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>R$ {(effectiveFee / 100).toFixed(2)}</div>
                                {fr.custom_fee_cents != null && fr.custom_fee_cents !== dailyRate && <div style={{ fontSize: 10, color: C.mut }}>Diária: R$ {(dailyRate / 100).toFixed(2)}</div>}
                                <button onClick={() => setFrFeeEdit({ id: fr.id, val: String(effectiveFee / 100) })} style={{ background: 'none', border: 'none', color: '#a78bfa', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>ajustar valor</button>
                              </div>
                          }
                        </div>
                        <button onClick={() => toggleProdFrConfirmed(fr)} title={fr.confirmed ? 'Confirmado' : 'Pendente'} style={{ background: fr.confirmed ? '#10b98122' : 'var(--c-panel2)', border: `1px solid ${fr.confirmed ? '#10b98144' : C.brd}`, borderRadius: 8, padding: '5px 8px', color: fr.confirmed ? '#10b981' : C.mut, fontSize: 13, cursor: 'pointer' }}>{fr.confirmed ? '✅' : '⏳'}</button>
                        <button onClick={() => convocateFrWA(fr)} style={{ background: '#25d36622', border: '1px solid #25d36644', borderRadius: 8, padding: '5px 10px', color: '#25d366', fontSize: 13, cursor: 'pointer' }} title="Convocar via WhatsApp">📲</button>
                        <button onClick={() => removeProdFreelancer(fr.id)} title="Remover da equipe" style={{ background: 'none', border: `1px solid ${C.red}33`, borderRadius: 8, padding: '5px 8px', color: C.red, fontSize: 13, cursor: 'pointer' }}>🗑</button>
                      </div>
                    </div>
                  )
                }

                return (
                  <div>
                    {/* Quota: necessário por área (planejamento) */}
                    <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 10 }}>
                      <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 8 }}>📊 NECESSÁRIO POR ÁREA <span style={{ fontWeight: 400 }}>(quantos freelancers cada área precisa)</span></div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 6 }}>
                        {workAreas.map(a => {
                          const assigned = prodFr.filter(fr => roleOf(fr) === a.key).length
                          const need = prodStaffing[a.key] ?? 0
                          const ok = need > 0 && assigned >= need
                          return (
                            <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--c-panel)', border: `1px solid ${ok ? '#10b98144' : C.brd}`, borderRadius: 8, padding: '5px 8px' }}>
                              <span style={{ fontSize: 12, flex: 1, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.icon} {a.label}</span>
                              <span style={{ fontSize: 11, color: need > 0 ? (ok ? '#10b981' : '#f59e0b') : C.mut, fontWeight: 700 }}>{assigned}/{need || '–'}</span>
                              <input type="number" min="0" value={need || ''} onChange={e => saveStaffingNeed(a.key, parseInt(e.target.value) || 0)} placeholder="0"
                                style={{ width: 42, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 6px', color: C.txt, fontSize: 12, fontFamily: 'inherit', textAlign: 'center' }} />
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {prodFr.length === 0 && !teamArea && (
                      <div style={{ color: C.mut, textAlign: 'center', padding: '20px 0', fontSize: 13 }}>Monte a equipe por área: escolha uma área abaixo e adicione os freelancers.</div>
                    )}

                    {Object.entries(groups).map(([role, members]) => (
                      <div key={role} style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${C.brd}` }}>
                          <span style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{roleLabel(role)} <span style={{ color: C.brd, fontWeight: 400 }}>({members.length})</span></span>
                          <button onClick={() => setTeamArea(role)} style={{ background: 'var(--c-panel2)', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.mut, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>+ Freelancer</button>
                        </div>
                        {members.map(fr => memberRow(fr))}
                      </div>
                    ))}

                    {prodFr.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 12px', padding: '10px 12px', background: '#f59e0b10', border: '1px solid #f59e0b33', borderRadius: 10 }}>
                        <span style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>💰 Custo da equipe ({prodFr.length})</span>
                        <span style={{ fontSize: 15, fontWeight: 900, color: '#f59e0b' }}>R$ {(frTotal / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}

                    {!teamArea ? (
                      <div>
                        <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 8 }}>➕ ADICIONAR POR ÁREA</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {workAreas.map(a => (
                            <button key={a.key} onClick={() => setTeamArea(a.key)} style={{ background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 12px', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{a.icon} {a.label}</button>
                          ))}
                        </div>
                      </div>
                    ) : (() => {
                      const available = allFreelancers.filter(f => !prodFr.some(pf => pf.freelancer_id === f.id && roleOf(pf) === teamArea))
                      const suggested = available.filter(f => (f.work_types ?? []).includes(teamArea as never))
                      const others = available.filter(f => !(f.work_types ?? []).includes(teamArea as never))
                      const rowFn = (f: Freelancer) => (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}22` }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{f.full_name}</div>
                            <div style={{ fontSize: 11, color: C.mut }}>
                              {(f.work_types ?? []).map(wt => wlabel(wt)).join(' · ')}
                              {f.daily_rate_cents ? ` · ${fmtCurrency(f.daily_rate_cents)}/dia` : ''}
                            </div>
                          </div>
                          <button onClick={() => { addProdFreelancer(f.id, teamArea) }} style={{ background: '#f59e0b22', border: '1px solid #f59e0b44', borderRadius: 8, padding: '5px 12px', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>➕ Add</button>
                        </div>
                      )
                      const hdr = (txt: string) => <div style={{ fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '6px 0 2px' }}>{txt}</div>
                      return (
                        <div style={{ padding: '12px 14px', background: 'var(--c-panel)', border: `1px solid #f59e0b44`, borderRadius: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>Adicionar em {roleLabel(teamArea)}</span>
                            <button onClick={() => setTeamArea(null)} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 16, cursor: 'pointer' }}>✕</button>
                          </div>
                          {suggested.length === 0 && others.length === 0
                            ? <div style={{ fontSize: 12, color: C.mut, textAlign: 'center', padding: '8px 0' }}>{allFreelancers.length === 0 ? 'Nenhum freelancer cadastrado. Cadastre na aba Freelancers.' : 'Todos os freelancers já estão nesta área.'}</div>
                            : <>
                                {suggested.length > 0 && <>{hdr(`✓ Da área · ${roleLabel(teamArea)}`)}{suggested.map(rowFn)}</>}
                                {others.length > 0 && <>{hdr('Outras áreas')}{others.map(rowFn)}</>}
                              </>
                          }
                        </div>
                      )
                    })()}
                  </div>
                )
              })()}

    </>
  )

  return (
    <div style={{ paddingBottom: 40 }}>
      <Toast toast={toast} />

      {/* Event form overlay — fullscreen for both new and edit */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--c-modal-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 28px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.txt }}>{editing ? 'Editar Evento' : 'Novo Evento'}</h2>
            <button onClick={() => { setModal(false); setEditing(null); setProdEv(null) }} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 26, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
          {/* Body: 55/45 split (form / produção) — empilha no celular (.r-split) */}
          <div className="r-split" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT: event form (55%) */}
        <div className="r-split-main" style={{ flex: '0 0 55%', overflowY: 'auto', padding: '20px 28px', borderRight: `1px solid ${C.brd}` }}>
        {/* 2-column layout: left = info, right = prices + flyer */}
        <div className="r-stack" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* ── Left column ── */}
          <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nome *</label>
              <input {...inp} value={String(form.name ?? '')} onChange={e => setF('name', e.target.value)} placeholder="Nome do evento" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Data</label>
                <input type="date" {...inp} value={String(form.event_date ?? '')} onChange={e => setF('event_date', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Gênero</label>
                <select {...inp} value={String(form.genre ?? '')} onChange={e => setF('genre', e.target.value)}>
                  {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Início</label>
                <input type="time" {...inp} value={String(form.start_time ?? '')} onChange={e => setF('start_time', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fim</label>
                <input type="time" {...inp} value={String(form.end_time ?? '')} onChange={e => setF('end_time', e.target.value)} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>🎉 Promoções</label>
                <button type="button" onClick={addPromo} style={{ background: C.gold + '22', border: `1px solid ${C.gold}44`, borderRadius: 7, padding: '3px 10px', color: C.gold, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ Adicionar</button>
              </div>
              {promos.length === 0 && (
                <div style={{ color: C.mut, fontSize: 11, padding: '4px 0' }}>Nenhuma promoção. Toque em “+ Adicionar”.</div>
              )}
              {promos.map((pr, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 32px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <input {...inp} value={pr.label} onChange={e => setPromo(i, { label: e.target.value })} placeholder="Ex: Open bar 22h-23h" />
                  <input inputMode="decimal" {...inp} value={moneyVal(pr.value_cents)} placeholder="Ex: R$ 500,00" onChange={e => setPromo(i, { value_cents: parseMoneyInput(e.target.value) })} />
                  <button type="button" onClick={() => removePromo(i)} style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 7, padding: '6px 0', color: C.red, cursor: 'pointer', fontSize: 13 }}>✕</button>
                </div>
              ))}
              {promos.length > 0 && (
                <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>💡 Os valores das promoções entram no custo da Produção/Budget.</div>
              )}
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Observações</label>
              <textarea {...inp} style={{ ...inp.style, height: 60, resize: 'vertical' as const }}
                value={String(form.observations ?? '')} onChange={e => setF('observations', e.target.value)}
                placeholder="Instruções internas, notas de produção..." />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Capacidade</label>
                <input type="number" {...inp} value={String(form.capacity ?? '')} onChange={e => setF('capacity', e.target.value)} placeholder="Ilimitado" />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Repetição</label>
                <select {...inp} value={String(form.repeat_rule ?? 'none')} onChange={e => setF('repeat_rule', e.target.value)}>
                  {REPT.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                </select>
                {String(form.repeat_rule ?? 'none') !== 'none' && String(form.event_date ?? '') && (
                  <button type="button" onClick={generateRepeats}
                    style={{ marginTop: 6, width: '100%', background: C.acc + '22', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '7px 10px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    📅 Gerar datas futuras
                  </button>
                )}
                {editing && (
                  <button type="button" onClick={openSerieModal}
                    style={{ marginTop: 6, width: '100%', background: C.red + '18', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '7px 10px', color: C.red, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    🗑 Gerenciar série
                  </button>
                )}
              </div>
            </div>
            {editing && (
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Status</label>
                <select {...inp} value={String(form.status ?? 'ativo')} onChange={e => setF('status', e.target.value)}>
                  <option value="ativo">Ativo</option>
                  <option value="cancelado">Cancelado</option>
                  <option value="encerrado">Encerrado</option>
                </select>
              </div>
            )}
          </div>

          {/* ── Right column ── */}
          <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            {/* Flyer */}
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Flyer do Evento</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: C.mut }}>
                {form.flyer_url as string
                  ? <img loading="lazy" decoding="async" src={String(form.flyer_url)} alt="flyer" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                  : <span>📁</span>
                }
                <span style={{ flex: 1 }}>{form.flyer_url ? 'Trocar imagem' : 'Selecionar imagem (JPG, PNG, WEBP)'}</span>
                {form.flyer_url as string && (
                  <button onClick={e => { e.preventDefault(); setF('flyer_url', '') }} style={{ background: 'var(--c-panel2)', border: 'none', borderRadius: 4, color: C.mut, cursor: 'pointer', fontSize: 11, padding: '2px 6px' }}>✕</button>
                )}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  st2('Enviando flyer...', 'warn')
                  const url = await uploadFlyer(file)
                  if (url) { setF('flyer_url', url); st2('Flyer enviado!', 'success') }
                }} />
              </label>
            </div>
            {/* Covers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Cover Masc (R$)</label>
                <input inputMode="decimal" {...inp} value={moneyVal(form.price_male_cents as number)} placeholder="Ex: R$ 40,00" onChange={e => setF('price_male_cents', parseMoneyInput(e.target.value))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Cover Fem (R$)</label>
                <input inputMode="decimal" {...inp} value={moneyVal(form.price_female_cents as number)} placeholder="Ex: R$ 30,00" onChange={e => setF('price_female_cents', parseMoneyInput(e.target.value))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Lista Masc (R$)</label>
                <input inputMode="decimal" {...inp} value={moneyVal(form.price_male_list_cents as number)} placeholder="Ex: R$ 20,00" onChange={e => setF('price_male_list_cents', parseMoneyInput(e.target.value))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Lista Fem (R$)</label>
                <input inputMode="decimal" {...inp} value={moneyVal(form.price_female_list_cents as number)} placeholder="Ex: R$ 15,00" onChange={e => setF('price_female_list_cents', parseMoneyInput(e.target.value))} />
              </div>
            </div>

            {/* Virada de preço da lista por horário (VIP até X, depois cobra) */}
            <div style={{ border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12, background: 'var(--c-panel)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 2 }}>⏰ Virada de preço da lista (opcional)</div>
              <div style={{ fontSize: 11, color: C.mut, marginBottom: 10 }}>
                Até o horário cobra o valor abaixo (0 = grátis/VIP). Depois do horário, cobra a <b>Lista Masc/Fem</b> acima. Em branco = sem virada.
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Horário da virada</label>
                <input type="time" {...inp} value={(form.list_cutoff_time as string) ?? ''} onChange={e => setF('list_cutoff_time', e.target.value)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Masc até o horário (R$)</label>
                  <input inputMode="decimal" {...inp} value={moneyVal(form.price_male_list_early_cents as number)} placeholder="0 = grátis" onChange={e => setF('price_male_list_early_cents', parseMoneyInput(e.target.value))} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Fem até o horário (R$)</label>
                  <input inputMode="decimal" {...inp} value={moneyVal(form.price_female_list_early_cents as number)} placeholder="0 = grátis" onChange={e => setF('price_female_list_early_cents', parseMoneyInput(e.target.value))} />
                </div>
              </div>
            </div>
            {/* Lista da Casa toggle */}
            {(() => {
              const hle = !!form.house_list_enabled
              return (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 8,
                    background: hle ? '#10b98111' : 'var(--c-panel)',
                    border: `1px solid ${hle ? '#10b98144' : C.brd}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>🏠 Lista da Casa</div>
                    <div style={{ fontSize: 11, color: C.mut, marginTop: 2 }}>Gera link para convidados confirmarem presença</div>
                  </div>
                  <button
                    onClick={async () => {
                      const next = !hle
                      setF('house_list_enabled', next)
                      if (next && editing) {
                        const ev = events.find(e => e.id === editing)
                        if (ev) await ensureHouseListRecord({ ...ev, house_list_enabled: true })
                      }
                    }}
                    style={{
                      width: 52, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer',
                      background: hle ? '#10b981' : C.brd,
                      position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, left: hle ? 26 : 4,
                      width: 22, height: 22, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s', display: 'block',
                    }} />
                  </button>
                </div>
              )
            })()}
            {/* O link público da Lista da Casa agora fica na aba 👥 Lista (visão Casa), não aqui */}
            {/* Liberar evento para Promoter */}
            {(() => {
              const pe = !!form.promoter_enabled
              const mode = String(form.promoter_price_mode ?? 'list') as PromoterPriceMode
              const invites = Array.isArray(form.promoter_invites) ? (form.promoter_invites as string[]) : []
              return (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: (pe || invites.length > 0) ? '#a78bfa11' : 'var(--c-panel)', border: `1px solid ${(pe || invites.length > 0) ? '#a78bfa44' : C.brd}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>📣 Liberar para Promoter</div>
                      <div style={{ fontSize: 11, color: C.mut, marginTop: 2 }}>Liga para TODOS os promoters; ou convide específicos abaixo</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setF('promoter_enabled', !pe)}
                      style={{ width: 52, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', background: pe ? '#a78bfa' : C.brd, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}
                    >
                      <span style={{ position: 'absolute', top: 3, left: pe ? 26 : 4, width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
                    </button>
                  </div>
                  {(pe || invites.length > 0) && (
                    <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: mode === 'other' ? '1fr 130px' : '1fr', gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor da entrada do promoter</label>
                        <select {...inp} value={mode} onChange={e => setF('promoter_price_mode', e.target.value)}>
                          <option value="list">Mesmo da Lista</option>
                          <option value="other">Outro valor</option>
                          <option value="vip">VIP (cortesia)</option>
                        </select>
                      </div>
                      {mode === 'other' && (
                        <div>
                          <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor (R$)</label>
                          <input inputMode="decimal" {...inp} value={moneyVal(form.promoter_price_cents as number)} placeholder="Ex: R$ 25,00" onChange={e => setF('promoter_price_cents', parseMoneyInput(e.target.value))} />
                        </div>
                      )}
                    </div>
                  )}
                  {/* Promoters específicos (funciona mesmo com o toggle desligado) */}
                  <div style={{ marginTop: 12, borderTop: `1px solid ${C.brd}`, paddingTop: 10 }}>
                    <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
                      👤 PROMOTERS ESPECÍFICOS{invites.length > 0 ? ` (${invites.length})` : ''}
                    </div>
                    {housePromoters.length === 0
                      ? <div style={{ fontSize: 11, color: C.mut }}>Nenhum promoter cadastrado na casa.</div>
                      : (() => {
                          const available = housePromoters.filter(pr => !invites.includes(pr.id))
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {/* Dropdown de seleção */}
                              {available.length > 0 && (
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <select
                                    id="promo-dropdown"
                                    defaultValue=""
                                    style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }}
                                  >
                                    <option value="" disabled>Selecionar promoter…</option>
                                    {available.map(pr => (
                                      <option key={pr.id} value={pr.id}>{pr.full_name}</option>
                                    ))}
                                  </select>
                                  <button type="button"
                                    onClick={() => {
                                      const sel = (document.getElementById('promo-dropdown') as HTMLSelectElement)?.value
                                      if (sel) togglePromoterInvite(sel)
                                    }}
                                    style={{ background: '#a78bfa22', border: '1px solid #a78bfa44', borderRadius: 8, padding: '7px 12px', color: '#a78bfa', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                    + Adicionar
                                  </button>
                                </div>
                              )}
                              {/* Chips dos promoters convidados */}
                              {invites.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {invites.map(id => {
                                    const pr = housePromoters.find(p => p.id === id)
                                    if (!pr) return null
                                    return (
                                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#a78bfa14', border: '1px solid #a78bfa44', borderRadius: 20, padding: '4px 10px' }}>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: C.txt }}>{pr.full_name}</span>
                                        {pr.phone && (
                                          <button type="button" onClick={() => sendPromoterEventLink(pr)} disabled={invitingPromoter === pr.id || !editing}
                                            style={{ background: '#25d36614', border: '1px solid #25d36633', borderRadius: 6, padding: '2px 7px', color: '#25d366', fontSize: 10, fontWeight: 700, cursor: editing ? 'pointer' : 'not-allowed', opacity: editing ? 1 : 0.5, fontFamily: 'inherit' }}>
                                            {invitingPromoter === pr.id ? '...' : '📲'}
                                          </button>
                                        )}
                                        <button type="button" onClick={() => togglePromoterInvite(id)}
                                          style={{ background: 'none', border: 'none', color: C.mut, fontSize: 14, cursor: 'pointer', lineHeight: 1, padding: '0 2px', fontFamily: 'inherit' }}>
                                          ×
                                        </button>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                              {invites.length === 0 && <div style={{ fontSize: 11, color: C.mut }}>Nenhum promoter adicionado ainda.</div>}
                            </div>
                          )
                        })()
                    }
                    <div style={{ fontSize: 10, color: C.mut, marginTop: 6 }}>Convidados veem o evento no portal mesmo com "liberar para todos" desligado.{!editing && ' Salve para poder enviar o link.'}</div>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        {/* ── Evento Parceiro (full-width) ── */}
        <div style={{ marginTop: 14, background: 'var(--c-panel)', border: `1px solid ${(form as any).is_partner_event ? C.acc + '55' : C.brd}`, borderRadius: 12, padding: '12px 14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!(form as any).is_partner_event}
              onChange={e => setF('is_partner_event' as any, e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.acc, cursor: 'pointer' }} />
            <span style={{ fontSize: 13, color: C.txt, fontWeight: 700 }}>🤝 Evento Parceiro</span>
            <span style={{ fontSize: 11, color: C.mut, fontWeight: 400 }}>— divisão de porta, aluguel ou parceria</span>
          </label>
          {!!(form as any).is_partner_event && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 3 }}>Nome do Parceiro</label>
                <input {...inp} value={String((form as any).partner_name ?? '')} onChange={e => setF('partner_name' as any, e.target.value)} placeholder="Nome da empresa ou pessoa" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 3 }}>Modelo de Parceria</label>
                <select {...inp} value={String((form as any).partner_model ?? '')} onChange={e => setF('partner_model' as any, e.target.value)}
                  style={{ ...inp.style, cursor: 'pointer' }}>
                  <option value="">Selecionar modelo…</option>
                  <option value="50_porta_fixo">50% porta + valor fixo</option>
                  <option value="100_porta">100% porta (parceiro fica com tudo)</option>
                  <option value="casa_porta">Casa fica com a porta inteira</option>
                  <option value="divisao_lucro">Divisão do lucro líquido</option>
                  <option value="aluguel">Aluguel do espaço</option>
                  <option value="personalizado">Personalizado</option>
                </select>
              </div>
              {(form as any).partner_model === '50_porta_fixo' && (
                <div>
                  <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 3 }}>Valor Fixo (R$)</label>
                  <input inputMode="decimal" {...inp} value={moneyVal((form as any).partner_fixed_cents)} placeholder="Ex: R$ 500,00" onChange={e => setF('partner_fixed_cents' as any, parseMoneyInput(e.target.value))} />
                </div>
              )}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 3 }}>Termos / Observações da Parceria</label>
                <textarea {...inp} style={{ ...inp.style, height: 60, resize: 'vertical' as const }}
                  value={String((form as any).partner_terms ?? '')} onChange={e => setF('partner_terms' as any, e.target.value)}
                  placeholder="Ex: parceiro responsável pelo DJ, casa fornece estrutura..." />
              </div>
            </div>
          )}
        </div>

        {/* ── Espaços / Preços por Evento ── */}
        {houseSpaces.length > 0 && (
          <div style={{ marginTop: 14, background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 10 }}>🏛 Valor dos Espaços neste Evento</div>
            {(() => {
              const sel = houseSpaces.find(s => s.id === spaceSel)
              const override = sel ? spacePrices[sel.id] : undefined
              const display = sel ? (override !== undefined ? override : (sel.price_cents ?? 0)) : 0
              return (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 3 }}>Espaço</label>
                    <select {...inp} value={spaceSel} onChange={e => setSpaceSel(e.target.value)}>
                      <option value="">— Selecione um espaço —</option>
                      {houseSpaces.map(sp => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name}{spacePrices[sp.id] !== undefined ? ` · ${fmtCurrency(spacePrices[sp.id])}` : sp.price_cents ? ` · ${fmtCurrency(sp.price_cents)} (padrão)` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  {sel && (
                    <div style={{ flex: '1 1 160px', position: 'relative' }}>
                      <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 3 }}>Valor neste evento (R$)</label>
                      <input
                        type="number" step="0.01" min="0"
                        {...inp}
                        value={display > 0 ? (display / 100).toFixed(2) : ''}
                        onChange={e => {
                          const cents = Math.round((parseFloat(e.target.value) || 0) * 100)
                          setSpacePrices(p => ({ ...p, [sel.id]: cents }))
                        }}
                        placeholder={sel.price_cents ? `R$ ${(sel.price_cents / 100).toFixed(2)}` : 'Sem valor'}
                      />
                      {override !== undefined && override !== (sel.price_cents ?? 0) && (
                        <button type="button" title="Restaurar padrão"
                          onClick={() => setSpacePrices(p => { const n = { ...p }; delete n[sel.id]; return n })}
                          style={{ position: 'absolute', right: 8, top: 28, background: 'none', border: 'none', color: C.mut, cursor: 'pointer', fontSize: 14 }}>↩</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
            {/* Lista dos espaços já configurados neste evento */}
            {Object.keys(spacePrices).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {Object.entries(spacePrices).map(([id, cents]) => {
                  const sp = houseSpaces.find(s => s.id === id)
                  if (!sp) return null
                  return (
                    <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.gold + '18', border: `1px solid ${C.gold}44`, borderRadius: 8, padding: '4px 10px', fontSize: 12, color: C.gold, fontWeight: 600 }}>
                      {sp.name}: {fmtCurrency(cents)}
                      <button type="button" title="Remover" onClick={() => setSpacePrices(p => { const n = { ...p }; delete n[id]; return n })}
                        style={{ background: 'none', border: 'none', color: C.gold, cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Artists section (full width) ── */}
        <div style={{ marginTop: 14, background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>🎤 Artistas do Evento</span>
            <button onClick={addArtist} style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8, padding: '5px 12px', color: C.acc, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              + Adicionar Artista
            </button>
          </div>
          {artists.length === 0 && (
            <div style={{ color: C.mut, fontSize: 12, textAlign: 'center', padding: '10px 0' }}>Nenhum artista adicionado ainda.</div>
          )}
          {/* Header row */}
          {artists.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px 1fr 110px 36px', gap: 8, marginBottom: 2 }}>
              <label style={{ fontSize: 11, color: C.mut, fontWeight: 600 }}>Nome do Artista</label>
              <label style={{ fontSize: 11, color: C.mut, fontWeight: 600 }}>Tipo de Cachê</label>
              <label style={{ fontSize: 11, color: C.mut, fontWeight: 600 }}>Valor do Cachê</label>
              <label style={{ fontSize: 11, color: C.mut, fontWeight: 600 }}>🍺 Consumação</label>
              <span />
            </div>
          )}
          {artists.map((ar, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 1fr 110px 36px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <input {...inp} value={ar.name} onChange={e => setArtist(i, { name: e.target.value })} placeholder="Nome do artista..." />
              <select {...inp} value={ar.fee_type} onChange={e => setArtist(i, { fee_type: e.target.value as ArtistEntry['fee_type'] })}>
                <option value="fixed">Fixo (R$)</option>
                <option value="percent">% portaria</option>
                <option value="mixed">Fixo + %</option>
                <option value="tbd">A combinar</option>
              </select>
              {/* Fee value cell */}
              {ar.fee_type === 'fixed' && (
                <input inputMode="decimal" {...inp} value={`R$ ${fmtMoneyInput(ar.fee_cents)}`} onChange={e => setArtist(i, { fee_cents: parseMoneyInput(e.target.value) })} />
              )}
              {ar.fee_type === 'percent' && (
                <input type="number" step="1" min="0" max="100" {...inp} value={ar.fee_percent} onChange={e => setArtist(i, { fee_percent: parseFloat(e.target.value) || 0 })} placeholder="%" />
              )}
              {ar.fee_type === 'mixed' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <input inputMode="decimal" {...inp} value={`R$ ${fmtMoneyInput(ar.fee_cents)}`} onChange={e => setArtist(i, { fee_cents: parseMoneyInput(e.target.value) })} placeholder="R$ fixo" />
                  <input type="number" step="1" min="0" max="100" {...inp} value={ar.fee_percent} onChange={e => setArtist(i, { fee_percent: parseFloat(e.target.value) || 0 })} placeholder="%" />
                </div>
              )}
              {ar.fee_type === 'tbd' && (
                <div style={{ ...inp.style, display: 'flex', alignItems: 'center', color: C.gold, fontSize: 11 }}>A combinar</div>
              )}
              {/* Consumação */}
              <input inputMode="decimal" {...inp} value={`R$ ${fmtMoneyInput(ar.consumption_cents)}`} onChange={e => setArtist(i, { consumption_cents: parseMoneyInput(e.target.value) })} />
              <button onClick={() => removeArtist(i)} style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '6px 8px', color: C.red, cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
          ))}
        </div>

        {/* Save buttons */}
        <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
          <Btn onClick={save} style={{ flex: 1 }}>💾 Salvar</Btn>
          <Btn onClick={() => { setModal(false); setEditing(null); setProdEv(null) }} variant="ghost">Cancelar</Btn>
        </div>
        </div>{/* end LEFT */}

        {/* RIGHT: production panel (45%) — escondido no celular (.r-prod-panel); acesse pelo botão 🏭 Produção */}
        <div className="r-prod-panel" style={{ flex: '0 0 45%', overflowY: 'hidden', padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
          {!editing
            ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: C.mut }}>
                <div style={{ fontSize: 32 }}>🏭</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>Produção</div>
                <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 220 }}>Salve o evento para liberar o painel de Produção (tarefas, equipe e budget).</div>
              </div>
            : <>
                <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, letterSpacing: '0.08em', flexShrink: 0 }}>🏭 PRODUÇÃO</div>
                {prodTasks.length > 0 && (() => {
                  const done = prodTasks.filter(t => t.status === 'done').length
                  const pct = Math.round(done / prodTasks.length * 100)
                  return (
                    <div style={{ marginTop: 8, height: 5, background: C.brd, borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10b981' : 'linear-gradient(90deg,#f59e0b,#fbbf24)', borderRadius: 4 }} />
                    </div>
                  )
                })()}
                <div style={{ flexShrink: 0 }}>{renderProdTabs()}</div>
                <div style={{ flex: 1, overflowY: 'auto', marginTop: 12 }}>{renderProdBody()}</div>
              </>
          }
        </div>{/* end RIGHT */}
          </div>{/* end flex body */}
        </div>
      )}{/* end overlay */}

      {/* Nova Lista da Casa — nome + valores ♂/♀ + VIP */}
      <Modal open={newHouseListOpen} title="🏠 Nova Lista da Casa" zIndex={1300} noDirtyCheck onClose={() => setNewHouseListOpen(false)}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nome da lista *</label>
            <input autoFocus value={nhlForm.name} onChange={e => setNhlForm(p => ({ ...p, name: e.target.value }))}
              placeholder="Ex: VIP, Aniversariantes, Promoção"
              style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>Tipo de entrada</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button type="button" onClick={() => setNhlForm(p => ({ ...p, vip: false }))}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `2px solid ${!nhlForm.vip ? C.acc : C.brd}`, background: !nhlForm.vip ? C.acc + '22' : 'transparent', color: !nhlForm.vip ? C.acc : C.mut, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>💲 Com valor</button>
              <button type="button" onClick={() => setNhlForm(p => ({ ...p, vip: true }))}
                style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `2px solid ${nhlForm.vip ? C.gold : C.brd}`, background: nhlForm.vip ? C.gold + '22' : 'transparent', color: nhlForm.vip ? C.gold : C.mut, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>⭐ VIP (grátis)</button>
            </div>
            {!nhlForm.vip && (
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, display: 'block', marginBottom: 4 }}>♂ MASCULINO (R$)</label>
                  <input type="number" step="0.01" min="0" inputMode="decimal" value={nhlForm.male} onChange={e => setNhlForm(p => ({ ...p, male: e.target.value }))}
                    placeholder="0,00" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid #60a5fa55`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: '#f472b6', fontWeight: 700, display: 'block', marginBottom: 4 }}>♀ FEMININO (R$)</label>
                  <input type="number" step="0.01" min="0" inputMode="decimal" value={nhlForm.female} onChange={e => setNhlForm(p => ({ ...p, female: e.target.value }))}
                    placeholder="0,00" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid #f472b655`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
                </div>
              </div>
            )}
          </div>

          {/* Virada de horário — mesma regra das listas de promoter */}
          <div style={{ background: C.bg, border: `1px solid ${nhlForm.cut ? C.gold + '55' : C.brd}`, borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 11, color: C.gold, fontWeight: 700, display: 'block', marginBottom: 4 }}>⏰ VIRADA ÀS</label>
                <input type="time" value={nhlForm.cut} onChange={e => setNhlForm(p => ({ ...p, cut: e.target.value }))}
                  style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '9px 10px', color: C.txt, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1, minWidth: 150, color: C.mut, fontSize: 11, lineHeight: 1.5 }}>
                {nhlForm.cut
                  ? (nhlForm.vip
                      ? `Entrada grátis até ${nhlForm.cut}. Depois vale o preço do evento.`
                      : `Até ${nhlForm.cut} vale o valor "antes". Depois, o valor cheio acima.`)
                  : 'Deixe em branco para a lista ter um valor único a noite toda.'}
              </div>
            </div>

            {nhlForm.cut && !nhlForm.vip && (
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, display: 'block', marginBottom: 4 }}>♂ ANTES DAS {nhlForm.cut} (R$)</label>
                  <input type="number" step="0.01" min="0" inputMode="decimal" value={nhlForm.earlyM}
                    onChange={e => setNhlForm(p => ({ ...p, earlyM: e.target.value }))} placeholder="0,00"
                    style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: '1px solid #60a5fa55', borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: '#f472b6', fontWeight: 700, display: 'block', marginBottom: 4 }}>♀ ANTES DAS {nhlForm.cut} (R$)</label>
                  <input type="number" step="0.01" min="0" inputMode="decimal" value={nhlForm.earlyF}
                    onChange={e => setNhlForm(p => ({ ...p, earlyF: e.target.value }))} placeholder="0,00"
                    style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: '1px solid #f472b655', borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
                </div>
              </div>
            )}
          </div>

          <div style={{ color: C.mut, fontSize: 11 }}>💡 Esses valores são cobrados automaticamente no check-in conforme o gênero da pessoa.</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={createHouseList} disabled={!nhlForm.name.trim()} style={{ flex: 1 }}>✅ Criar lista</Btn>
            <Btn onClick={() => setNewHouseListOpen(false)} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      </Modal>

      {/* Editar lista — preços ♂/♀ + VIP sem horário */}
      <Modal open={!!editListOpen} title="✏️ Editar lista" zIndex={1300} noDirtyCheck onClose={() => setEditListOpen(null)}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ color: '#a855f7', fontWeight: 700, fontSize: 13 }}>📋 {editListOpen?.label}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, display: 'block', marginBottom: 4 }}>♂ MASCULINO (R$)</label>
              <input type="number" step="0.01" min="0" inputMode="decimal" value={editListForm.male} onChange={e => setEditListForm(p => ({ ...p, male: e.target.value }))}
                placeholder="0,00 = grátis" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid #60a5fa55`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: '#f472b6', fontWeight: 700, display: 'block', marginBottom: 4 }}>♀ FEMININO (R$)</label>
              <input type="number" step="0.01" min="0" inputMode="decimal" value={editListForm.female} onChange={e => setEditListForm(p => ({ ...p, female: e.target.value }))}
                placeholder="0,00 = grátis" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid #f472b655`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
            </div>
          </div>
          {/* Termos comerciais do promoter */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>💰 VALOR FIXO (R$)</label>
              <input type="number" step="0.01" min="0" inputMode="decimal" value={editListForm.fixed} onChange={e => setEditListForm(p => ({ ...p, fixed: e.target.value }))}
                placeholder="0,00" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>🎫 MÍN. ENTRADAS</label>
              <input type="number" min="0" inputMode="numeric" value={editListForm.minEntries} onChange={e => setEditListForm(p => ({ ...p, minEntries: e.target.value }))}
                placeholder="0" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.mut, fontWeight: 700, display: 'block', marginBottom: 4 }}>🍺 CONSUMAÇÃO (R$/pessoa)</label>
            <input type="number" step="0.01" min="0" inputMode="decimal" value={editListForm.consumacao} onChange={e => setEditListForm(p => ({ ...p, consumacao: e.target.value }))}
              placeholder="0,00" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit' }} />
          </div>
          <button type="button" onClick={() => setEditListForm(p => ({ ...p, cutoff_exempt: !p.cutoff_exempt }))}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', border: `2px solid ${editListForm.cutoff_exempt ? C.grn : C.brd}`, background: editListForm.cutoff_exempt ? C.grn + '18' : 'transparent' }}>
            <span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: editListForm.cutoff_exempt ? C.grn : C.txt }}>⭐ VIP sem horário (sempre grátis)</span>
              <span style={{ display: 'block', fontSize: 11, color: C.mut, marginTop: 2 }}>Ignora a virada de preço do evento — esta lista nunca passa a cobrar.</span>
            </span>
            <span style={{ flexShrink: 0, fontSize: 18 }}>{editListForm.cutoff_exempt ? '✅' : '⬜'}</span>
          </button>
          <div style={{ color: C.mut, fontSize: 11 }}>💡 Deixe 0/vazio nos dois para lista grátis (VIP). Se o evento tiver virada de preço, a lista segue a virada — a não ser que marque "sem horário".</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={saveEditList} disabled={editListSaving} style={{ flex: 1 }}>{editListSaving ? 'Salvando…' : '💾 Salvar'}</Btn>
            <Btn onClick={() => setEditListOpen(null)} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      </Modal>

      {/* Guest list modal — large, two-tab layout */}
      <Modal open={!!guestEv} title={`👥 Listas — ${guestEv?.name ?? ''}`} maxWidth={960} onClose={() => { setGuestEv(null); setGuests([]); setGuestListToken(null); setGuestListId(null); setGuestListPromoId(null); setListSummary([]); setSelHouseListId(null) }}>


        {/* Lotação do evento: ocupação prevista (confirmados + pessoas em reservas) vs capacidade */}
        {guestEv && (guestEv.capacity ?? 0) > 0 && (() => {
          const confirmados = guests.filter(g => g.confirmed_at).length
          const reservasPeople = listReservas.reduce((sum, r) => sum + (r.people_count ?? 0), 0)
          const ocup = confirmados + reservasPeople
          const cap = guestEv.capacity ?? 0
          const pct = Math.round((ocup / cap) * 100)
          const barPct = Math.min(100, pct)
          const color = pct >= 100 ? C.red : pct >= 90 ? C.gold : C.grn
          const lk = guestEv.list_locks ?? {}
          const allLocked = !!(lk.casa && lk.promoters && lk.reservas)
          return (
            <div style={{ background: 'var(--c-panel)', border: `1px solid ${pct >= 90 ? color + '55' : C.brd}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: '0.05em' }}>🎫 LOTAÇÃO</span>
                <span style={{ fontSize: 12, fontWeight: 800, color }}>{ocup} / {cap} · {pct}%</span>
              </div>
              <div style={{ height: 7, background: C.brd, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${barPct}%`, background: color, borderRadius: 4, transition: 'width .3s' }} />
              </div>
              {pct >= 90 && !allLocked && (
                <button onClick={() => setAllLocks(true)}
                  style={{ width: '100%', marginTop: 10, background: color + '14', border: `1px solid ${color}55`, borderRadius: 8, padding: '7px 12px', color, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {pct >= 100 ? '🔴 Lotação atingida — suspender todas as listas' : '⚠️ Perto da lotação — suspender todas as listas'}
                </button>
              )}
              {allLocked && (
                <button onClick={() => setAllLocks(false)}
                  style={{ width: '100%', marginTop: 10, background: '#10b98114', border: '1px solid #10b98155', borderRadius: 8, padding: '7px 12px', color: C.grn, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  🟢 Reabrir todas as listas
                </button>
              )}
            </div>
          )
        })()}

        {/* Mini-dashboard das listas: seletor de visão (corpo mostra só a selecionada) */}
        {(() => {
          const houseLists0 = listSummary.filter(r => r.kind === 'list' && r.isHouse)
          const houseTotal = houseLists0.reduce((s, r) => s + listStats(r.listId).total, 0)
          const promoterLists = listSummary.filter(r => r.kind === 'list' && !r.isHouse)
          const promoterTotal = promoterLists.reduce((s, r) => s + listStats(r.listId).total, 0)
          const reservasPeople = listReservas.reduce((s, r) => s + (r.people_count ?? 0), 0)
          // Marcador da aba: nº de listas + total de pessoas (ex: "3 · 74")
          const tabBadge = (lists: number, people: number) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 6, padding: '0 6px', fontSize: 11, fontWeight: 800 }}>{lists}</span>
              {people > 0 && <span style={{ opacity: 0.85, fontSize: 11, fontWeight: 700 }}>👥 {people}</span>}
            </span>
          )
          const navBtn = (active: boolean, color: string) => ({
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8,
            border: `1px solid ${active ? color : C.brd}`,
            background: active ? color + '22' : 'transparent',
            color: active ? color : C.mut, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          } as const)

          // Toggles de ativação rápida
          const hleOn = !!(guestEv?.house_list_enabled)
          const peOn = !!(guestEv?.promoter_enabled)

          return (
            <>
            {/* Status das listas — ativar/desativar direto daqui */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <button
                onClick={async () => {
                  if (!guestEv) return
                  const next = !hleOn
                  const updated = { ...guestEv, house_list_enabled: next }
                  setGuestEv(updated)
                  setEvents(prev => prev.map(e => e.id === guestEv.id ? { ...e, house_list_enabled: next } : e))
                  if (next) await ensureHouseListRecord(updated)
                  await supabase.from('events').update({ house_list_enabled: next }).eq('id', guestEv.id)
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, border: `1px solid ${hleOn ? '#10b98144' : C.brd}`, background: hleOn ? '#10b98114' : 'transparent', color: hleOn ? '#10b981' : C.mut, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: hleOn ? '#10b981' : C.brd, display: 'inline-block' }} />
                Lista da Casa {hleOn ? 'ativa' : 'inativa'}
              </button>
              <button
                onClick={async () => {
                  if (!guestEv) return
                  const next = !peOn
                  const updated = { ...guestEv, promoter_enabled: next }
                  setGuestEv(updated)
                  setEvents(prev => prev.map(e => e.id === guestEv.id ? { ...e, promoter_enabled: next } : e))
                  await supabase.from('events').update({ promoter_enabled: next }).eq('id', guestEv.id)
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, border: `1px solid ${peOn ? '#a855f744' : C.brd}`, background: peOn ? '#a855f714' : 'transparent', color: peOn ? '#a855f7' : C.mut, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: peOn ? '#a855f7' : C.brd, display: 'inline-block' }} />
                Promoters {peOn ? 'ativos' : 'inativos'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              <button onClick={() => setListaView('casa')} style={navBtn(listaView === 'casa', '#3b82f6')}>
                🏠 Casa {tabBadge(houseLists0.length, houseTotal)}
              </button>
              <button onClick={() => setListaView('promoters')} style={navBtn(listaView === 'promoters', '#a855f7')}>
                📣 Promoters {tabBadge(promoterLists.length, promoterTotal)}
              </button>
              <button onClick={() => setListaView('reservas')} style={navBtn(listaView === 'reservas', '#a78bfa')}>
                🪑 Reservas {tabBadge(listReservas.length, reservasPeople)}
              </button>
              <button onClick={() => { if (guestEv) { const ev = guestEv; setGuestEv(null); openFlyer(ev) } }}
                style={{ ...navBtn(false, '#25d366'), color: '#25d366', borderColor: '#25d36644', marginLeft: 'auto' }}>
                📨 Convidar Clientes
              </button>
            </div>
            </>
          )
        })()}

        {/* ── MOLDURA FIXA: dropdown → condições → placar → adicionar → corpo → CSV. Só os dados mudam. ── */}
        {(() => {
          const houseLists = listSummary.filter(r => r.kind === 'list' && r.isHouse)
          const promoterLists = listSummary.filter(r => r.kind === 'list' && !r.isHouse)
          const isReservas = listaView === 'reservas'
          // Sem seleção manual, abre na lista da casa com mais nomes (evita cair na lista vazia padrão)
          const defaultHouseRow = houseLists.slice().sort((a, b) => listStats(b.listId).total - listStats(a.listId).total)[0]
          const activeHouseId = selHouseListId ?? defaultHouseRow?.listId ?? guestListId
          const houseRow = houseLists.find(r => r.listId === activeHouseId) ?? houseLists[0]
          const promoSel = selPromoter ?? promoterLists[0]?.listId ?? null
          const activeListRow = listaView === 'casa' ? houseRow : promoterLists.find(r => r.listId === promoSel)
          const activeListId = listaView === 'casa' ? (houseRow?.listId ?? guestListId ?? undefined) : (promoSel ?? undefined)
          const s = listStats(activeListId)
          const resSel = selReserva ?? listReservas[0]?.id ?? null
          const activeRes = listReservas.find(r => r.id === resSel)
          const rgs = resSel ? (reservaGuests[resSel] ?? []) : []
          const ctrl = { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 12, boxSizing: 'border-box' as const }

          // Condições da lista selecionada (valor ♂/♀, consumação, VIP/cortesia)
          const cond: Array<[string, string]> = (() => {
            const ent = (c?: number) => fmtCurrency(c ?? 0)
            if (isReservas) {
              if (!activeRes) return []
              const m = activeRes.list_male_value_cents ?? 0, f = activeRes.list_female_value_cents ?? 0, c = activeRes.list_custom_value_cents ?? 0, a = activeRes.amount_cents ?? 0
              if (m > 0 || f > 0) return [['♂ Masc', ent(m)], ['♀ Fem', ent(f)]]
              if (c > 0) return [['Lista', ent(c)]]
              if (a > 0) return [['Reserva', ent(a)]]
              return [['⭐ VIP / Cortesia', '—']]
            }
            if (listaView === 'casa') {
              // Usa os valores da própria lista da casa selecionada; cai no preço de lista do evento como fallback
              const hasOwn = houseRow && ((houseRow.entryMale ?? 0) > 0 || (houseRow.entryFemale ?? 0) > 0)
              const isVipList = /\bvip\b/i.test(houseRow?.label ?? '')
              if (isVipList) return [['⭐ VIP', 'entrada grátis']]
              const m = hasOwn ? (houseRow!.entryMale ?? 0) : (guestEv?.price_male_list_cents ?? 0)
              const f = hasOwn ? (houseRow!.entryFemale ?? 0) : (guestEv?.price_female_list_cents ?? 0)
              return (m > 0 || f > 0) ? [['♂ Masc', ent(m)], ['♀ Fem', ent(f)]] : [['⭐ Cortesia', 'sem valor']]
            }
            if (activeListRow) {
              const out: Array<[string, string]> = []
              if ((activeListRow.entryFee ?? 0) > 0) out.push(['Entrada', ent(activeListRow.entryFee)])
              if ((activeListRow.consumacao ?? 0) > 0) out.push(['Consumação', ent(activeListRow.consumacao)])
              if ((activeListRow.minEntries ?? 0) > 0) out.push(['Mín. nomes', String(activeListRow.minEntries)])
              return out.length ? out : [['⭐ Cortesia', 'sem valor']]
            }
            return []
          })()

          // Placar (3 números) — mesma forma em todas as visões
          const score: Array<[string, number]> = isReservas
            ? [['pessoas', activeRes?.people_count ?? 0], ['na lista', rgs.length], ['entraram', rgs.filter(g => g.checked_in).length]]
            : [['enviados', s.enviados], ['confirmados', s.confirmados], ['entraram', s.entraram]]

          function onAdd() {
            if (isReservas) { if (activeRes) addReservaGuest(activeRes.id) }
            else addGuestManually(activeListId, activeListRow?.promoterId)
          }

          return (
            <>
              {/* 1) Dropdown — sempre no mesmo lugar (+ link público discreto na Casa) */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <select
                  value={listaView === 'casa' ? (houseRow?.listId ?? '') : isReservas ? (resSel ?? '') : (promoSel ?? '')}
                  onChange={e => {
                    if (listaView === 'casa') setSelHouseListId(e.target.value)
                    else if (listaView === 'promoters') setSelPromoter(e.target.value)
                    else if (isReservas) selectReserva(e.target.value)
                  }}
                  disabled={listaView === 'casa' && houseLists.length <= 1}
                  style={{ ...ctrl, marginBottom: 0, flex: 1, minWidth: 0 }}
                >
                  {listaView === 'casa' && (houseLists.length === 0
                    ? <option value={guestListId ?? ''}>🏠 Lista da Casa</option>
                    : houseLists.map(r => <option key={r.key} value={r.listId ?? ''}>{r.icon} {r.label} ({listStats(r.listId).total})</option>))}
                  {listaView === 'promoters' && (promoterLists.length === 0
                    ? <option value="">Nenhum promoter com lista</option>
                    : promoterLists.map(r => <option key={r.key} value={r.listId}>{r.label} — {listStats(r.listId).confirmados} conf.</option>))}
                  {isReservas && (listReservas.length === 0
                    ? <option value="">Nenhuma reserva</option>
                    : listReservas.map(r => <option key={r.id} value={r.id}>{r.location ? `${r.location} · ` : ''}{r.name}{r.people_count ? ` (${r.people_count}p)` : ''}</option>))}
                </select>
                {!isReservas && activeListId && (
                  <button title="Editar preços e VIP sem horário desta lista"
                    onClick={() => openEditList(activeListId, activeListRow?.label ?? 'Lista')}
                    style={{ flexShrink: 0, background: '#a855f714', border: '1px solid #a855f740', borderRadius: 10, padding: '0 12px', color: '#a855f7', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ✏️ Editar
                  </button>
                )}
                {listaView === 'casa' && (houseRow?.token ?? guestListToken) && (
                  <button title="Copiar link público de auto-cadastro desta lista"
                    onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/lista/${houseRow?.token ?? guestListToken}`); st2('Link público copiado!', 'success') }}
                    style={{ flexShrink: 0, background: '#10b98114', border: '1px solid #10b98140', borderRadius: 10, padding: '0 12px', color: '#10b981', fontSize: 16, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <i className="bi bi-link-45deg" />
                  </button>
                )}
                {listaView === 'casa' && guestEv && (
                  <button title="Criar nova lista da casa para este evento"
                    onClick={() => { setNhlForm({ name: '', male: '', female: '', vip: false, cut: '', earlyM: '', earlyF: '' }); setNewHouseListOpen(true) }}
                    style={{ flexShrink: 0, background: '#3b82f614', border: '1px solid #3b82f640', borderRadius: 10, padding: '0 12px', color: '#3b82f6', fontSize: 18, cursor: 'pointer', fontFamily: 'inherit' }}>
                    ＋
                  </button>
                )}
                {listaView === 'casa' && guestEv && houseRow?.listId && (
                  <button title="Excluir esta lista da casa"
                    onClick={() => deleteHouseList(houseRow.listId, houseRow.label)}
                    style={{ flexShrink: 0, background: '#ef444414', border: '1px solid #ef444440', borderRadius: 10, padding: '0 12px', color: '#ef4444', fontSize: 16, cursor: 'pointer', fontFamily: 'inherit' }}>
                    <i className="bi bi-trash3-fill" />
                  </button>
                )}
              </div>

              {/* 1b) Suspender / reabrir cadastro público deste tipo de lista */}
              {(() => {
                const locked = !!(guestEv?.list_locks?.[listaView])
                const scopeLabel = listaView === 'casa' ? 'Lista da Casa' : listaView === 'promoters' ? 'Listas de promoters' : 'Reservas'
                return (
                  <button onClick={() => toggleListLock(listaView)}
                    title={locked ? 'Cadastro público bloqueado — toque para reabrir' : 'Cadastro público aberto — toque para suspender (lotação)'}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, background: locked ? '#f8717112' : '#10b98112', border: `1px solid ${locked ? '#f8717140' : '#10b98140'}`, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <span style={{ display: 'inline-flex', width: 34, height: 18, borderRadius: 10, background: locked ? C.brd : C.grn, position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}>
                      <span style={{ position: 'absolute', top: 2, left: locked ? 2 : 18, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px #0004' }} />
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: locked ? C.red : C.grn, textAlign: 'left' }}>
                      {locked ? `🔴 ${scopeLabel} suspensa — toque para reabrir` : `🟢 ${scopeLabel} aberta — toque para suspender`}
                    </span>
                  </button>
                )
              })()}

              {/* 2) Condições da lista — logo abaixo do dropdown */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {cond.map(([label, val], i) => (
                  <div key={i} style={{ flex: '1 1 110px', background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 12px' }}>
                    <div style={{ fontSize: 10, color: C.mut, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: C.txt }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* 3) Placar — 3 números, sempre a mesma forma */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {score.map(([label, val], i) => (
                  <div key={i} style={{ flex: 1, background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: i === 1 ? C.grn : i === 2 ? C.acc : C.txt }}>{val}</div>
                    <div style={{ fontSize: 10, color: C.mut, fontWeight: 600 }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Ação contextual (mesmo lugar): lembrete (Casa/Promoter) ou msg ao responsável (Reservas) */}
              {!isReservas && s.pendentes > 0 && activeListRow && (
                <button disabled={remindBusy === activeListRow.listId} onClick={() => remindPending(activeListRow)}
                  style={{ width: '100%', marginBottom: 12, background: '#f59e0b14', border: '1px solid #f59e0b40', borderRadius: 8, padding: '7px 12px', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: remindBusy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  {remindBusy === activeListRow.listId ? 'Enviando lembretes…' : `⏰ Lembrar ${s.pendentes} pendente(s) sem confirmação`}
                </button>
              )}
              {isReservas && activeRes && activeRes.phone && (
                <button onClick={() => sendReservaWA(activeRes)}
                  style={{ width: '100%', marginBottom: 12, background: '#25d36614', border: '1px solid #25d36640', borderRadius: 8, padding: '7px 12px', color: '#25d366', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <i className="bi bi-whatsapp" /> Mensagem ao responsável
                </button>
              )}

              {/* 4) Adicionar pessoa — Nome · Telefone · + (igual em todas as visões) */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                <input placeholder="Nome" value={isReservas ? reservaGuestForm.name : guestAddForm.name}
                  onChange={e => isReservas ? setReservaGuestForm(p => ({ ...p, name: e.target.value })) : setGuestAddForm(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && onAdd()}
                  style={{ flex: '2 1 150px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                <input placeholder="Telefone" value={isReservas ? reservaGuestForm.phone : guestAddForm.phone}
                  onChange={e => isReservas ? setReservaGuestForm(p => ({ ...p, phone: e.target.value })) : setGuestAddForm(p => ({ ...p, phone: e.target.value }))}
                  style={{ flex: '1 1 120px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                <Btn onClick={onAdd} disabled={(isReservas ? !reservaGuestForm.name.trim() : !guestAddForm.name.trim()) || guestAdding} small>{guestAdding ? '...' : 'Adicionar'}</Btn>
                <label title="Importar planilha .xlsx/.xls/.csv (colunas: nome, telefone, gênero, nascimento)"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#22c55e14', border: '1px solid #22c55e44', borderRadius: 8, padding: '0 12px', color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: importingList ? 'default' : 'pointer', fontFamily: 'inherit', opacity: importingList ? 0.6 : 1 }}>
                  {importingList ? '...' : '📥 XLS'}
                  <input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" disabled={importingList} style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) importListXlsx(f, isReservas ? { reservaId: activeRes?.id } : { listId: activeListId, promoterId: activeListRow?.promoterId }) }} />
                </label>
              </div>

              {/* 5) CORPO: linhas de pessoas — só os dados mudam */}
              {!isReservas
                ? (s.confirmedGuests.length === 0
                    ? <div style={{ color: C.mut, fontSize: 12, textAlign: 'center', padding: '16px 0' }}>Nenhum confirmado ainda{s.enviados > 0 ? ` · ${s.enviados} convite(s) enviado(s)` : ''}</div>
                    : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{s.confirmedGuests.map(g => renderGuestRow(g, true))}</div>
                  )
                : (!activeRes ? <div style={{ color: C.mut, fontSize: 12, textAlign: 'center', padding: '16px 0' }}>Selecione uma reserva</div>
                    : rgs.length === 0
                      ? <div style={{ color: C.mut, fontSize: 12, textAlign: 'center', padding: '16px 0' }}>Nenhum convidado nesta reserva ainda</div>
                      : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {rgs.map(g => {
                            const missing = !g.phone || !g.birth_date
                            return (
                            <div key={g.id} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 18, flexShrink: 0 }}>{g.checked_in ? '✅' : '👤'}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: g.checked_in ? C.grn : C.txt, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                                <div style={{ color: C.mut, fontSize: 11, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {g.phone && <span>📱 {g.phone}</span>}
                                  {g.birth_date && <span>🎂 {new Date(g.birth_date + 'T12:00').toLocaleDateString('pt-BR')}</span>}
                                  {!g.checked_in && missing && <span style={{ color: C.gold }}>⚠️ falta cel/nascimento</span>}
                                </div>
                              </div>
                              <button onClick={() => toggleReservaGuestCheckin(activeRes.id, g)}
                                style={{ background: g.checked_in ? C.grn + '22' : missing ? C.gold + '11' : 'transparent', border: `1px solid ${g.checked_in ? C.grn : missing ? C.gold + '44' : C.brd}`, borderRadius: 7, padding: '4px 12px', color: g.checked_in ? C.grn : missing ? C.gold : C.mut, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                                {g.checked_in ? '✓ Entrou' : missing ? '📝 Completar' : 'Check-in'}
                              </button>
                            </div>
                            )
                          })}
                        </div>
                  )
              }

              {/* 6) CSV — exporta os check-in da visão atual */}
              <div style={{ display: 'flex', marginTop: 10 }}>
                <Btn small variant="secondary" style={{ marginLeft: 'auto' }}
                  onClick={() => isReservas
                    ? doExport(rgs.map(g => ({ name: g.name, checked_in: g.checked_in })), 'reserva')
                    : doExport(s.confirmedGuests.map(g => ({ name: g.full_name, gender: g.gender, birth_date: g.birth_date, is_vip: g.is_vip, checked_in: g.checked_in })), listaView)}>
                  📥 CSV (check-in)
                </Btn>
              </div>
            </>
          )
        })()}

      </Modal>

      {/* Montagem modal — todas as reservas do dia para um montador */}
      <Modal open={!!montagemEv} title={`📐 Montagem — ${montagemEv?.name ?? ''}`} onClose={() => setMontagemEv(null)} zIndex={1300}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Montador — escalados deste dia</label>
            <select value={montagemFr} onChange={e => setMontagemFr(e.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }}>
              <option value="">— Selecionar montador —</option>
              {montagemEscala.map(f => (
                <option key={f.id} value={f.id}>
                  {f.full_name}{f.role ? ` · ${wlabel(f.role)}` : ''}{f.phone ? '' : ' · sem telefone'}
                </option>
              ))}
            </select>
            {montagemEscala.length === 0 && (
              <div style={{ fontSize: 11, color: C.gold, marginTop: 4 }}>
                Ninguém escalado neste evento ainda. Escale a equipe pelo botão 👷 Equipe.
              </div>
            )}
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Tarefa de montagem (todas as reservas do dia)</label>
            <textarea value={montagemMsg} onChange={e => setMontagemMsg(e.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', minHeight: 220, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={sendMontagem} disabled={!montagemFr} style={{ flex: 1, background: '#25d36622', color: '#25d366', border: '1px solid #25d36644' }}>✅ Enviar e criar tarefa</Btn>
            <Btn onClick={() => setMontagemEv(null)} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      </Modal>

      {/* Completar cadastro — telefone + nascimento obrigatórios antes de liberar check-in do convidado */}
      <Modal open={!!completeRGuest} title={`📝 Completar cadastro — ${completeRGuest?.guest.name ?? ''}`} onClose={() => setCompleteRGuest(null)} zIndex={1300} noDirtyCheck>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ color: C.mut, fontSize: 12 }}>Telefone e data de nascimento são obrigatórios para liberar o check-in.</div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Telefone</label>
            <input value={completeRGForm.phone} onChange={e => setCompleteRGForm(p => ({ ...p, phone: e.target.value }))}
              placeholder="(11) 99999-9999" style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nascimento</label>
            <input type="date" value={completeRGForm.birth_date} onChange={e => setCompleteRGForm(p => ({ ...p, birth_date: e.target.value }))}
              style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={saveCompleteRGuest} disabled={!completeRGForm.phone.trim() || !completeRGForm.birth_date} style={{ flex: 1 }}>✅ Salvar e liberar entrada</Btn>
            <Btn onClick={() => setCompleteRGuest(null)} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      </Modal>

      {/* Reservations modal */}
      <Modal open={!!resEv} title={`🪑 Reservas — ${resEv?.name ?? ''}`} onClose={() => { setResEv(null); setResList([]) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: C.mut, fontSize: 13 }}>{resList.length} reservas</span>
          <Btn onClick={() => { setResAddOpen(true); setResEdit(null); setResForm(RDEF2) }} small>➕ Nova</Btn>
        </div>
        {resAddOpen && (
          <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>Nome *</label>
                <input style={{ width: '100%', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 13, boxSizing: 'border-box' as const }}
                  value={resForm.name} onChange={e => setResForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>Pessoas</label>
                <input type="number" style={{ width: '100%', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 13, boxSizing: 'border-box' as const }}
                  value={resForm.people_count} onChange={e => setResForm(p => ({ ...p, people_count: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>Local / Mesa</label>
                <input style={{ width: '100%', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 13, boxSizing: 'border-box' as const }}
                  value={resForm.location} onChange={e => setResForm(p => ({ ...p, location: e.target.value }))} placeholder="Mesa VIP 01" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>Valor (R$)</label>
                <input type="number" step="0.01" style={{ width: '100%', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '7px 10px', color: C.txt, fontSize: 13, boxSizing: 'border-box' as const }}
                  value={resForm.amount_cents} onChange={e => setResForm(p => ({ ...p, amount_cents: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={saveRes} small>💾 Salvar</Btn>
              <Btn onClick={() => { setResAddOpen(false); setResEdit(null) }} small variant="ghost">Cancelar</Btn>
            </div>
          </div>
        )}
        {resList.map(res => (
          <div key={res.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brd}` }}>
            <span style={{ background: (STATUS_COLOR[res.status] ?? C.mut) + '22', color: STATUS_COLOR[res.status] ?? C.mut, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              {STATUS_LABEL[res.status] ?? res.status}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{res.name}</div>
              <div style={{ color: C.mut, fontSize: 11 }}>
                {res.people_count && `👥 ${res.people_count}`}
                {res.location && ` · 📍 ${res.location}`}
                {res.amount_cents ? ` · ${fmtCurrency(res.amount_cents)}` : ''}
                {res.expected_arrival && ` · 🕐 ${res.expected_arrival.slice(0, 5)}`}
              </div>
            </div>
            {res.status === 'pending' && <Btn onClick={() => markArrived(res.id)} small style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44` }}>✅</Btn>}
            <Btn onClick={() => delRes(res.id)} small variant="danger">🗑</Btn>
          </div>
        ))}
      </Modal>

      {/* Freelancers modal */}
      <Modal open={!!frModal} title={`👷 Equipe — ${frModal?.name ?? ''}`} maxWidth={900} onClose={() => { setFrModal(null); setEvFreelancers([]); setFrModalArea(null); setFrBusca('') }}>
        {(() => {
          const roleOf = (ef: EventFreelancer) => (ef.role || ef.freelancers?.work_types?.[0] || 'outros')
          const groups: Record<string, EventFreelancer[]> = {}
          evFreelancers.forEach(ef => { const r = roleOf(ef); (groups[r] ||= []).push(ef) })
          const confirmed = evFreelancers.filter(ef => ef.confirmed).length
          const needs = frModal?.staffing_needs ?? {}
          // Áreas cobertas pela equipe: considera a área de escala (role) E as áreas
          // do cadastro de cada pessoa — senão contava 1 quando todos entram pela mesma seção.
          const areaSet = new Set<string>()
          evFreelancers.forEach(ef => {
            if (ef.role) areaSet.add(ef.role)
            ;(ef.freelancers?.work_types ?? []).forEach(w => { if (w) areaSet.add(String(w)) })
          })
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: C.mut }}>Escale a equipe por área e defina o <strong style={{ color: C.sub }}>horário de entrada</strong> de cada um. Metas vêm de <strong style={{ color: C.sub }}>Produção › Equipe</strong>.</div>
                {evFreelancers.length > 0 && frModal && (
                  <button onClick={() => printEscala(frModal)} style={{ flexShrink: 0, background: 'var(--c-panel2)', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', color: C.sub, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>🖨️ Escala / Ponto</button>
                )}
              </div>

              {/* Stats */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {[
                  { label: 'Escalados', val: evFreelancers.length, color: C.acc },
                  { label: 'Confirmados', val: confirmed, color: C.grn },
                  { label: 'Áreas', val: areaSet.size, color: C.gold },
                ].map((b, i) => (
                  <div key={i} style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: b.color }}>{b.val}</div>
                    <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>{b.label}</div>
                  </div>
                ))}
              </div>

              {/* Progresso das metas */}
              {Object.keys(needs).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                  {Object.entries(needs).map(([key, need]) => {
                    const assigned = evFreelancers.filter(ef => roleOf(ef) === key).length
                    const ok = assigned >= (need as number)
                    return (
                      <span key={key} style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: ok ? '#10b98118' : '#f59e0b18', color: ok ? '#10b981' : '#f59e0b', border: `1px solid ${ok ? '#10b98144' : '#f59e0b44'}` }}>
                        {wlabel(key)} {assigned}/{need as number}
                      </span>
                    )
                  })}
                </div>
              )}

              {/* Membros por área */}
              {Object.entries(groups).map(([role, members]) => (
                <div key={role} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${C.brd}` }}>
                    <span style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{wlabel(role)} <span style={{ color: C.brd, fontWeight: 400 }}>({members.length}{needs[role] ? `/${needs[role]}` : ''})</span></span>
                    <button onClick={() => setFrModalArea(role)} style={{ background: 'var(--c-panel2)', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.mut, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>+ Freelancer</button>
                  </div>
                  {members.map(ef => (
                    <div key={ef.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}22` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{ef.freelancers?.full_name ?? '—'}</div>
                        <div style={{ color: C.mut, fontSize: 11 }}>{(ef.freelancers?.work_types ?? []).map(wt => wlabel(wt)).join(' · ')}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                        <span style={{ fontSize: 9, color: C.mut, fontWeight: 600 }}>ENTRADA</span>
                        <input type="time" value={ef.entry_time ?? ''} onChange={e => saveEvFrEntryTime(ef.id, e.target.value)}
                          style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '4px 6px', color: ef.entry_time ? C.txt : C.mut, fontSize: 12, fontFamily: 'inherit', width: 96 }} />
                      </div>
                      <button onClick={() => toggleEvFrConfirmed(ef)} title={ef.confirmed ? 'Confirmado' : 'Pendente'} style={{ background: ef.confirmed ? C.grn + '22' : 'var(--c-panel2)', border: `1px solid ${ef.confirmed ? C.grn + '44' : C.brd}`, borderRadius: 8, padding: '4px 8px', color: ef.confirmed ? C.grn : C.mut, fontSize: 12, cursor: 'pointer' }}>{ef.confirmed ? '✅' : '⏳'}</button>
                      <button onClick={() => removeEvFreelancer(ef.id)} title="Remover" style={{ background: 'none', border: `1px solid ${C.red}33`, borderRadius: 8, padding: '4px 8px', color: C.red, fontSize: 12, cursor: 'pointer' }}>🗑</button>
                    </div>
                  ))}
                </div>
              ))}

              {/* Escalar por área */}
              {!frModalArea ? (
                <div style={{ marginTop: 4 }}>
                  {/* Busca por nome: acha a pessoa direto, sem precisar saber a área dela */}
                  <input
                    value={frBusca}
                    onChange={e => setFrBusca(e.target.value)}
                    placeholder="🔎 Buscar pessoa pelo nome…"
                    style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${frBusca ? C.acc + '66' : C.brd}`, borderRadius: 9, padding: '9px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginBottom: 10 }}
                  />

                  {frBusca.trim().length >= 2 ? (() => {
                    const q = frBusca.trim().toLowerCase()
                    const achados = allFreelancers
                      .filter(f => (f.full_name ?? '').toLowerCase().includes(q))
                      .filter(f => !evFreelancers.some(ef => ef.freelancer_id === f.id))
                    if (achados.length === 0) return (
                      <div style={{ fontSize: 12, color: C.mut, textAlign: 'center', padding: '14px 0', lineHeight: 1.6 }}>
                        Nenhuma pessoa encontrada com esse nome.<br />
                        {allFreelancers.some(f => (f.full_name ?? '').toLowerCase().includes(q))
                          ? 'Quem tem esse nome já está escalado neste evento.'
                          : 'Confira a grafia ou cadastre na aba Equipe.'}
                      </div>
                    )
                    return (
                      <div style={{ padding: '10px 12px', background: 'var(--c-panel)', border: `1px solid ${C.acc}44`, borderRadius: 10 }}>
                        <div style={{ fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>
                          {achados.length} PESSOA(S) ENCONTRADA(S)
                        </div>
                        {achados.slice(0, 12).map(f => (
                          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}22` }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{f.full_name}</div>
                              <div style={{ fontSize: 11, color: C.mut }}>
                                {(f.work_types ?? []).map(wt => wlabel(wt)).join(' · ') || 'sem área definida'}
                                {f.daily_rate_cents ? ` · ${fmtCurrency(f.daily_rate_cents)}/dia` : ''}
                              </div>
                            </div>
                            {/* 'outros' é só o padrão: resolveRole troca pela área do cadastro da pessoa */}
                            <button onClick={() => { addEvFreelancer(f.id, 'outros'); setFrBusca('') }}
                              style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '5px 12px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                              ➕ Add
                            </button>
                          </div>
                        ))}
                        {achados.length > 12 && (
                          <div style={{ fontSize: 11, color: C.mut, marginTop: 6 }}>+{achados.length - 12} — refine a busca</div>
                        )}
                      </div>
                    )
                  })() : (
                  <>
                  <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 8 }}>➕ ESCALAR POR ÁREA</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {workAreas.map(a => {
                      const assigned = evFreelancers.filter(ef => roleOf(ef) === a.key).length
                      const need = needs[a.key] ?? 0
                      return (
                        <button key={a.key} onClick={() => setFrModalArea(a.key)} style={{ background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 12px', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {a.icon} {a.label}{need ? <span style={{ color: assigned >= need ? '#10b981' : '#f59e0b', marginLeft: 4, fontWeight: 700 }}>{assigned}/{need}</span> : ''}
                        </button>
                      )
                    })}
                  </div>
                  </>
                  )}
                </div>
              ) : (() => {
                const available = allFreelancers.filter(f => !evFreelancers.some(ef => ef.freelancer_id === f.id && roleOf(ef) === frModalArea))
                const suggested = available.filter(f => (f.work_types ?? []).includes(frModalArea as never))
                const others = available.filter(f => !(f.work_types ?? []).includes(frModalArea as never))
                const rowFn = (f: Freelancer) => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}22` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{f.full_name}</div>
                      <div style={{ fontSize: 11, color: C.mut }}>{(f.work_types ?? []).map(wt => wlabel(wt)).join(' · ')}{f.daily_rate_cents ? ` · ${fmtCurrency(f.daily_rate_cents)}/dia` : ''}</div>
                    </div>
                    <button onClick={() => addEvFreelancer(f.id, frModalArea)} style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '5px 12px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>➕ Add</button>
                  </div>
                )
                const hdr = (txt: string) => <div style={{ fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '6px 0 2px' }}>{txt}</div>
                return (
                  <div style={{ padding: '12px 14px', background: 'var(--c-panel)', border: `1px solid ${C.acc}44`, borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: C.acc, fontWeight: 700 }}>Escalar em {wlabel(frModalArea)}</span>
                      <button onClick={() => { setFrModalArea(null); setFrBusca('') }} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 16, cursor: 'pointer' }}>✕</button>
                    </div>
                    {suggested.length === 0 && others.length === 0
                      ? <div style={{ fontSize: 12, color: C.mut, textAlign: 'center', padding: '8px 0' }}>{allFreelancers.length === 0 ? 'Nenhum freelancer cadastrado. Cadastre na aba Equipe.' : 'Todos já estão nesta área.'}</div>
                      : <>
                          {suggested.length > 0 && <>{hdr(`✓ Da área · ${wlabel(frModalArea)}`)}{suggested.map(rowFn)}</>}
                          {others.length > 0 && <>{hdr('Outras áreas')}{others.map(rowFn)}</>}
                        </>
                    }
                  </div>
                )
              })()}
            </div>
          )
        })()}
      </Modal>

      {/* Checklist do card — checagem das tarefas de produção */}
      <Modal open={!!checkEv} title={`📋 Checklist — ${checkEv?.name ?? ''}`} onClose={() => {
        if (checkEv) {
          const done = checkTasks.filter(t => t.status === 'done').length
          setEvents(prev => prev.map(e => e.id === checkEv.id ? { ...e, tasksDone: done, tasksTotal: checkTasks.length } : e))
        }
        setCheckEv(null); setCheckTasks([])
      }}>
        {(() => {
          const total = checkTasks.length
          const done = checkTasks.filter(t => t.status === 'done').length
          const pct = total ? Math.round(done / total * 100) : 0
          const areas: Record<string, { icon: string; tasks: EventTask[] }> = {}
          checkTasks.forEach(t => { if (!areas[t.area]) areas[t.area] = { icon: t.area_icon, tasks: [] }; areas[t.area].tasks.push(t) })
          return (
            <div>
              <div style={{ fontSize: 12, color: C.mut, marginBottom: 12 }}>Marque as tarefas conforme forem concluídas. As tarefas são cadastradas em Produção › Tarefas.</div>
              {total === 0
                ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: 24 }}>Nenhuma tarefa cadastrada na Produção deste evento.</div>
                : <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                      <div style={{ flex: 1, height: 8, background: C.brd, borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10b981' : 'linear-gradient(90deg,#f59e0b,#fbbf24)', borderRadius: 6, transition: 'width .3s' }} />
                      </div>
                      <span style={{ fontSize: 12, color: pct === 100 ? '#10b981' : C.sub, fontWeight: 700 }}>{done}/{total} ({pct}%)</span>
                      <button onClick={() => checkEv && printCheck(checkEv)} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.brd}`, background: 'transparent', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>🖨️ Imprimir</button>
                    </div>
                    {Object.entries(areas).map(([area, g]) => (
                      <div key={area} style={{ marginBottom: 16 }}>
                        <div style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${C.brd}` }}>
                          {g.icon} {area} <span style={{ color: C.brd, fontWeight: 400 }}>({g.tasks.filter(t => t.status === 'done').length}/{g.tasks.length})</span>
                        </div>
                        {g.tasks.map(t => (
                          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}22` }}>
                            <button onClick={() => toggleCheckTask(t)} style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${t.status === 'done' ? '#10b981' : C.brd}`, background: t.status === 'done' ? '#10b981' : 'transparent', color: '#fff', fontSize: 13, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.status === 'done' ? '✓' : ''}</button>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: t.status === 'done' ? C.mut : C.txt, fontSize: 14, fontWeight: 500, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</div>
                              {(t.assignee_name || t.deadline) && (
                                <div style={{ fontSize: 11, color: C.mut, marginTop: 1 }}>
                                  {t.assignee_name ? `👤 ${t.assignee_name}` : ''}{t.assignee_name && t.deadline ? ' · ' : ''}{t.deadline ? `⏰ ${new Date(t.deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
              }
            </div>
          )
        })()}
      </Modal>

      {/* Tickets modal */}
      {/* ── Visão geral de ingressos (todos os eventos) ── */}
      <Modal open={allTk} title="🎫 Ingressos — visão geral" onClose={() => { setAllTk(false); setOpenBatch(null); closeBatchForm() }} wide noDirtyCheck>
        {allTkLdg ? (
          <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: 30 }}>Carregando…</div>
        ) : allBatches.length === 0 ? (
          <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '30px 20px', lineHeight: 1.6 }}>
            Nenhum lote de ingresso criado ainda.<br />
            Abra um evento e use <b style={{ color: C.txt }}>🎫 Ingressos → ➕ Novo lote</b> para começar a vender.
          </div>
        ) : (() => {
          const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
          const ehFuturo = (d: string) => (d ? new Date(d + 'T12:00') >= hoje : false)
          const q = tkQuery.trim().toLowerCase()

          // Filtro: período + data exata + texto (nome do evento ou do lote)
          const batchesF = allBatches.filter(b => {
            const d = b.events?.event_date ?? ''
            if (tkScope === 'prox' && !ehFuturo(d)) return false
            if (tkScope === 'enc' && ehFuturo(d)) return false
            if (tkDate && d !== tkDate) return false
            if (q && !`${b.events?.name ?? ''} ${b.name}`.toLowerCase().includes(q)) return false
            return true
          })
          const evIds = new Set(batchesF.map(b => b.event_id))
          const ordersF = allOrders.filter(o => evIds.has(o.event_id))

          const pagos = ordersF.filter(o => o.payment_status === 'paid')
          const pend = ordersF.filter(o => o.payment_status === 'pending')
          const receita = pagos.reduce((s, o) => s + (o.amount_cents ?? 0), 0)
          const vendidos = pagos.reduce((s, o) => s + (o.quantity ?? 0), 0)
          const aVenda = batchesF.reduce((s, b) => {
            const venc = !!b.expires_at && new Date(b.expires_at) <= new Date()
            return s + (b.active && !venc ? Math.max(0, b.quantity - b.sold) : 0)
          }, 0)

          // Agrupa por evento; futuros primeiro (é onde ainda dá para agir)
          const porEvento = new Map<string, { nome: string; data: string; lotes: typeof allBatches }>()
          for (const b of batchesF) {
            const k = b.event_id
            if (!porEvento.has(k)) porEvento.set(k, { nome: b.events?.name ?? '—', data: b.events?.event_date ?? '', lotes: [] })
            porEvento.get(k)!.lotes.push(b)
          }
          const grupos = [...porEvento.entries()]
            .map(([id, g]) => ({ id, ...g, futuro: ehFuturo(g.data) }))
            .sort((a, b) => (a.futuro === b.futuro ? a.data.localeCompare(b.data) : a.futuro ? -1 : 1))

          // Datas disponíveis no datalist — evita procurar dia que não tem ingresso
          const datas = [...new Set(allBatches.map(b => b.events?.event_date).filter(Boolean))].sort() as string[]

          const kpis = [
            { label: 'EVENTOS', val: String(evIds.size), cor: C.acc },
            { label: 'VENDIDOS', val: String(vendidos), cor: C.grn },
            { label: 'RECEITA', val: fmtCurrency(receita), cor: C.acc, pequeno: true },
            { label: 'À VENDA', val: String(aVenda), cor: C.txt },
            { label: 'PENDENTES', val: String(pend.length), cor: pend.length ? C.gold : C.mut },
          ]

          const fInp = { background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 9, padding: '8px 11px', color: C.txt, fontSize: 12.5, fontFamily: 'inherit', boxSizing: 'border-box' as const }
          const filtrando = !!q || !!tkDate || tkScope !== 'prox'

          return (
            <div>
              {/* Busca por nome e por data do evento */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <input value={tkQuery} onChange={e => setTkQuery(e.target.value)}
                  placeholder="🔎 Evento, lote ou comprador (nome/telefone/CPF)…"
                  style={{ ...fInp, flex: '1 1 180px', minWidth: 0 }} />
                <input type="date" value={tkDate} onChange={e => setTkDate(e.target.value)} list="tk-datas"
                  title="Data do evento" style={{ ...fInp, flex: '0 1 150px' }} />
                <datalist id="tk-datas">{datas.map(d => <option key={d} value={d} />)}</datalist>
                {filtrando && (
                  <Btn small variant="ghost" onClick={() => { setTkQuery(''); setTkDate(''); setTkScope('prox') }}>✕ Limpar</Btn>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {([['prox', 'Próximos'], ['enc', 'Encerrados'], ['todos', 'Todos']] as const).map(([v, lb]) => (
                  <button key={v} onClick={() => setTkScope(v)}
                    style={{ padding: '5px 13px', borderRadius: 8, border: `1px solid ${tkScope === v ? C.acc : C.brd}`, background: tkScope === v ? C.acc + '22' : 'transparent', color: tkScope === v ? C.acc : C.mut, fontSize: 11.5, fontWeight: tkScope === v ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {lb}
                  </button>
                ))}
              </div>
              {/* auto-fit: 4 colunas no desktop, 2 no celular (o valor em R$ não cabe em 1/4 de 343px) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginBottom: 18 }}>
                {kpis.map(k => (
                  <div key={k.label} style={{ background: C.bg, borderRadius: 10, padding: '10px 4px', textAlign: 'center', border: `1px solid ${C.brd}` }}>
                    <div style={{ color: k.cor, fontWeight: 900, fontSize: k.pequeno ? 13 : 20 }}>{k.val}</div>
                    <div style={{ color: C.mut, fontSize: 9, fontWeight: 700, marginTop: 3 }}>{k.label}</div>
                  </div>
                ))}
              </div>

              {/* Pendentes primeiro: são os que exigem ação (PIX manual esperando confirmação) */}
              {pend.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ color: C.gold, fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
                    ⏳ AGUARDANDO CONFIRMAÇÃO DE PAGAMENTO ({pend.length})
                  </div>
                  {pend.map(o => (
                    <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.gold + '10', border: `1px solid ${C.gold}33`, borderRadius: 10, padding: '9px 12px', marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{o.buyer_name}</div>
                        <div style={{ color: C.mut, fontSize: 11 }}>
                          {o.events?.name} · {o.quantity}x {o.ticket_batches?.name ?? ''} · {fmtCurrency(o.amount_cents)}
                        </div>
                      </div>
                      <Btn onClick={() => confirmOrder(o, 'paid')} small style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44` }}>✅</Btn>
                      <Btn onClick={() => confirmOrder(o, 'cancelled')} small variant="danger">✕</Btn>
                    </div>
                  ))}
                </div>
              )}

              {/* Busca de comprador: ignora o filtro de período — quem chega na porta
                  procurando o ingresso perdido pode ter comprado para qualquer data */}
              {q.length >= 3 && (() => {
                const dig = q.replace(/\D/g, '')
                const achados = allOrders.filter(o =>
                  (o.buyer_name ?? '').toLowerCase().includes(q) ||
                  (dig.length >= 4 && ((o.buyer_phone ?? '').replace(/\D/g, '').includes(dig) ||
                                       (o.buyer_cpf ?? '').replace(/\D/g, '').includes(dig)))
                ).slice(0, 8)
                if (achados.length === 0) return null
                return (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ color: C.acc, fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
                      👤 COMPRADORES ({achados.length})
                    </div>
                    {achados.map(o => (
                      <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '9px 12px', marginBottom: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{o.buyer_name}</div>
                          <div style={{ color: C.mut, fontSize: 11 }}>
                            {o.events?.name} · {o.quantity}x {o.ticket_batches?.name ?? ''} · {fmtCurrency(o.amount_cents)}
                            {' · '}
                            <span style={{ color: o.payment_status === 'paid' ? C.grn : o.payment_status === 'pending' ? C.gold : C.red, fontWeight: 700 }}>
                              {o.payment_status === 'paid' ? 'pago' : o.payment_status === 'pending' ? 'pendente' : 'cancelado'}
                            </span>
                          </div>
                          {o.buyer_phone && <div style={{ color: C.mut, fontSize: 11 }}>📱 {o.buyer_phone}</div>}
                        </div>
                        {o.payment_status === 'paid' && (
                          <Btn small variant="secondary" disabled={resending === o.id}
                            onClick={() => resendTicket(o)} style={cbtn('#22c55e')}>
                            {resending === o.id ? '…' : '📲 Reenviar'}
                          </Btn>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()}

              {grupos.length === 0 && (
                <div style={{ color: C.mut, fontSize: 12.5, textAlign: 'center', padding: '26px 16px', background: C.bg, border: `1px dashed ${C.brd}`, borderRadius: 10, lineHeight: 1.6 }}>
                  Nenhum ingresso encontrado com esse filtro.
                  {tkScope === 'prox' && <><br />Os eventos já encerrados ficam em <b style={{ color: C.txt }}>Encerrados</b>.</>}
                </div>
              )}

              {grupos.map(g => {
                const gVend = g.lotes.reduce((s, b) => s + b.sold, 0)
                const gTot = g.lotes.reduce((s, b) => s + b.quantity, 0)
                return (
                  <div key={g.id} style={{ marginBottom: 16, opacity: g.futuro ? 1 : 0.62 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ color: C.txt, fontSize: 13, fontWeight: 700 }}>{g.nome}</span>
                      <span style={{ color: C.mut, fontSize: 11 }}>
                        {g.data ? new Date(g.data + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}
                        {!g.futuro && ' · encerrado'}
                      </span>
                      <span style={{ flex: 1 }} />
                      <span style={{ color: C.mut, fontSize: 11, fontWeight: 700 }}>{gVend}/{gTot}</span>
                      <Btn small variant="ghost" onClick={() => startNewBatch(g.id)} title="Novo lote neste evento">➕</Btn>
                      <Btn small variant="ghost" onClick={() => {
                        const ev = events.find(e => e.id === g.id)
                        if (ev) { setAllTk(false); openTickets(ev) }
                        else sT(setToast, 'Evento fora do período exibido — abra pelo calendário', 'warn')
                      }} title="Abrir o modal completo deste evento">Abrir</Btn>
                    </div>

                    {/* Form de novo lote deste evento, ou de edição de um lote dele */}
                    {addingBatch && (batchEvId === g.id) && batchFormBox()}

                    {g.lotes.map(b => {
                      const venc = !!b.expires_at && new Date(b.expires_at) <= new Date()
                      const rest = Math.max(0, b.quantity - b.sold)
                      const tag = !b.active ? { t: '⏸ Pausado', c: C.mut }
                        : venc ? { t: '⏰ Vencido', c: C.gold }
                        : rest === 0 ? { t: '🚫 Esgotado', c: C.gold }
                        : { t: '🟢 À venda', c: C.grn }
                      const pct = b.quantity > 0 ? Math.round((b.sold / b.quantity) * 100) : 0
                      const aberto = openBatch === b.id
                      // Compradores deste lote — o clique na barra de vendas abre a lista
                      const compradores = aberto ? allOrders.filter(o => o.batch_id === b.id) : []
                      if (editingBatch?.id === b.id && addingBatch) return null  // linha vira o form acima
                      return (
                        <div key={b.id} style={{ background: C.bg, border: `1px solid ${aberto ? C.acc + '55' : C.brd}`, borderRadius: 10, padding: '8px 12px', marginBottom: 5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: C.txt, fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }}>{b.name}</span>
                            <span style={{ color: tag.c, fontSize: 10, fontWeight: 700 }}>{tag.t}</span>
                            <span style={{ color: C.mut, fontSize: 11, minWidth: 60, textAlign: 'right' as const }}>
                              {b.price_cents === 0 ? 'Grátis' : fmtCurrency(b.price_cents)}
                            </span>
                            <Btn small variant="ghost" onClick={() => startEditBatch(b)} title="Editar lote">✏️</Btn>
                            <Btn small variant={b.active ? 'secondary' : 'ghost'} onClick={() => toggleBatch(b.id, b.active)}
                              title={b.active ? 'Pausar venda' : 'Colocar à venda'}>{b.active ? '⏸' : '▶️'}</Btn>
                          </div>

                          {/* Barra clicável: abre os compradores do lote */}
                          <button onClick={() => setOpenBatch(aberto ? null : b.id)}
                            title={b.sold > 0 ? 'Ver compradores deste lote' : 'Nenhuma venda ainda'}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
                            <div style={{ flex: 1, height: 5, background: C.brd, borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? C.gold : C.grn, borderRadius: 3 }} />
                            </div>
                            <span style={{ color: aberto ? C.acc : C.mut, fontSize: 10, fontWeight: 600, minWidth: 88, textAlign: 'right' as const }}>
                              {b.sold}/{b.quantity} · {rest} rest. {aberto ? '▴' : '▾'}
                            </span>
                          </button>

                          {aberto && (
                            <div style={{ marginTop: 8, borderTop: `1px solid ${C.brd}`, paddingTop: 8 }}>
                              {compradores.length === 0 ? (
                                <div style={{ color: C.mut, fontSize: 11, textAlign: 'center', padding: '6px 0' }}>Nenhuma venda neste lote ainda.</div>
                              ) : compradores.map(o => (
                                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ color: C.txt, fontSize: 12, fontWeight: 600 }}>{o.buyer_name}</div>
                                    <div style={{ color: C.mut, fontSize: 10.5 }}>
                                      {o.quantity}x · {fmtCurrency(o.amount_cents)}
                                      {o.buyer_phone ? ` · ${o.buyer_phone}` : ''}
                                      {' · '}
                                      <span style={{ color: o.payment_status === 'paid' ? C.grn : o.payment_status === 'pending' ? C.gold : C.red, fontWeight: 700 }}>
                                        {o.payment_status === 'paid' ? 'pago' : o.payment_status === 'pending' ? 'pendente' : 'cancelado'}
                                      </span>
                                    </div>
                                  </div>
                                  {o.payment_status === 'paid' && (
                                    <Btn small variant="ghost" disabled={resending === o.id} onClick={() => resendTicket(o)} title="Reenviar ingresso por WhatsApp">
                                      {resending === o.id ? '…' : '📲'}
                                    </Btn>
                                  )}
                                  {o.payment_status === 'pending' && (
                                    <Btn small onClick={() => confirmOrder(o, 'paid')} style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44` }}>✅</Btn>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </Modal>

      <Modal open={!!ticketEv} title={`🎫 Ingressos — ${ticketEv?.name ?? ''}`} onClose={() => { setTicketEv(null); setBatches([]) }}>
        {ticketEv && (
          <div>
            {/* Share link */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', marginBottom: 18 }}>
              <span style={{ color: C.mut, fontSize: 12, flex: 1, wordBreak: 'break-all' as const }}>
                {window.location.origin}/e/{ticketEv.id}
              </span>
              <Btn onClick={() => copyLink(ticketEv)} small variant={copied ? 'secondary' : 'ghost'}>
                {copied ? '✅ Copiado' : '📋 Copiar'}
              </Btn>
            </div>

            {/* Sem meio de pagamento o lote pago é criado mas o comprador não consegue concluir */}
            {payCfg && !payCfg.pix && !payCfg.mp && (
              <div style={{ background: C.gold + '15', border: `1px solid ${C.gold}44`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, color: C.gold, fontSize: 12, lineHeight: 1.5 }}>
                ⚠️ Esta casa não tem <b>chave PIX</b> nem <b>Mercado Pago</b> configurado em Configurações.
                Lotes pagos vão aparecer no link, mas o comprador não conseguirá pagar. Lotes com preço 0 (grátis) funcionam normalmente.
              </div>
            )}

            {/* Stats */}
            {orders.length > 0 && (() => {
              const paid = orders.filter(o => o.payment_status === 'paid')
              const pending = orders.filter(o => o.payment_status === 'pending')
              const revenue = paid.reduce((s, o) => s + o.amount_cents, 0)
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 18 }}>
                  {[
                    { label: 'VENDIDOS', value: paid.reduce((s, o) => s + o.quantity, 0), color: C.grn },
                    { label: 'PENDENTES', value: pending.reduce((s, o) => s + o.quantity, 0), color: C.gold },
                    { label: 'RECEITA', value: fmtCurrency(revenue), color: C.acc, raw: true },
                  ].map(s => (
                    <div key={s.label} style={{ background: C.bg, borderRadius: 10, padding: '10px 0', textAlign: 'center', border: `1px solid ${C.brd}` }}>
                      <div style={{ color: s.color, fontWeight: 900, fontSize: s.raw ? 14 : 22 }}>{s.value}</div>
                      <div style={{ color: C.mut, fontSize: 10, fontWeight: 600, marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Batches */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ color: C.txt, fontSize: 13, fontWeight: 700 }}>Lotes</span>
              <Btn onClick={() => ticketEv && startNewBatch(ticketEv.id)} small>➕ Novo lote</Btn>
            </div>

            {addingBatch && batchFormBox()}

            {batches.length === 0 && !addingBatch && (
              <div style={{ color: C.mut, fontSize: 12, textAlign: 'center', padding: '18px 12px', background: C.bg, border: `1px dashed ${C.brd}`, borderRadius: 10 }}>
                Nenhum lote criado ainda.<br />Crie um lote em <b style={{ color: C.txt }}>➕ Novo lote</b> para começar a vender pelo link acima.
              </div>
            )}

            {batches.map(b => {
              const avail = Math.max(0, b.quantity - b.sold)
              const expirado = !!b.expires_at && new Date(b.expires_at) <= new Date()
              const esgotado = avail === 0
              // "À venda" só se ativo, dentro do prazo e com ingresso sobrando — é o que a página pública filtra
              const tag = !b.active ? { txt: '⏸ Pausado', col: C.mut }
                : expirado ? { txt: '⏰ Prazo vencido', col: C.gold }
                : esgotado ? { txt: '🚫 Esgotado', col: C.gold }
                : { txt: '🟢 À venda', col: C.grn }
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brd}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>
                      {b.name} <span style={{ color: tag.col, fontSize: 10, fontWeight: 700 }}>{tag.txt}</span>
                    </div>
                    <div style={{ color: C.mut, fontSize: 11 }}>
                      {b.price_cents === 0 ? 'Grátis' : fmtCurrency(b.price_cents)}
                      {Number(b.service_fee_pct ?? 0) > 0 && ` + ${fmtCurrency(Math.round(b.price_cents * Number(b.service_fee_pct) / 100))} taxa`}
                      {' · '}{b.sold}/{b.quantity} vendidos · {avail} restantes
                      {b.expires_at && ` · até ${new Date(b.expires_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                  </div>
                  {/* Link direto do lote: abre a página pública já neste lote selecionado */}
                  <Btn small variant="ghost" title="Copiar link de venda deste lote"
                    onClick={() => {
                      const url = `${window.location.origin}/e/${ticketEv?.id}?lote=${b.id}`
                      navigator.clipboard.writeText(url)
                        .then(() => sT(setToast, `Link do lote "${b.name}" copiado`))
                        .catch(() => sT(setToast, 'Não foi possível copiar', 'error'))
                    }}>🔗</Btn>
                  <Btn onClick={() => startEditBatch(b)} small variant="ghost">✏️</Btn>
                  <Btn onClick={() => toggleBatch(b.id, b.active)} small variant={b.active ? 'secondary' : 'ghost'}>
                    {b.active ? '⏸ Pausar' : '▶️ Vender'}
                  </Btn>
                  <Btn onClick={() => deleteBatch(b)} small variant="danger">🗑</Btn>
                </div>
              )
            })}

            {/* Orders */}
            {orders.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ color: C.txt, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Pedidos ({orders.length})</div>
                {orders.map(o => (
                  <div key={o.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.brd}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{o.buyer_name}</div>
                        <div style={{ color: C.mut, fontSize: 11 }}>
                          {o.buyer_phone} · {o.quantity}x {(o.ticket_batches as { name?: string })?.name ?? ''} · {fmtCurrency(o.amount_cents)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {o.payment_status === 'pending' && <>
                          <Btn onClick={() => confirmOrder(o, 'paid')} small style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44` }}>✅</Btn>
                          <Btn onClick={() => confirmOrder(o, 'cancelled')} small variant="danger">✕</Btn>
                        </>}
                        {o.payment_status === 'paid' && <span style={{ color: C.grn, fontSize: 12, fontWeight: 700 }}>✅ Pago</span>}
                        {o.payment_status === 'cancelled' && <span style={{ color: C.red, fontSize: 12, fontWeight: 700 }}>❌</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Reservas — consulta (somente leitura + impressão p/ montagem) */}
      <Modal open={!!resViewEv} title={`🪑 Reservas — ${resViewEv?.name ?? ''}`} onClose={() => { setResViewEv(null); setResViewList([]) }} wide>
        {resViewEv && (() => {
          const totalPeople = resViewList.reduce((s, r) => s + (r.people_count ?? 0), 0)
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: C.mut }}>{resViewList.length} reservas · {totalPeople} pessoas previstas</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {onGoToReservas && <Btn onClick={() => { onGoToReservas(resViewEv.event_date, resViewEv.id); setResViewEv(null) }} small variant="secondary" style={cbtn('#94a3b8')}>✏️ Gerenciar</Btn>}
                  <Btn onClick={() => printResView(resViewEv)} small variant="secondary" style={cbtn('#3b82f6')}>🖨️ Imprimir</Btn>
                  <Btn onClick={() => openMontagem(resViewEv)} small variant="secondary" style={cbtn('#f59e0b')}>📐 Montagem</Btn>
                </div>
              </div>
              {resViewList.length === 0
                ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: 24 }}>Nenhuma reserva para este evento.</div>
                : resViewList.map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: `1px solid ${C.brd}` }}>
                    <div style={{ minWidth: 60, flexShrink: 0 }}>
                      <div style={{ background: '#a78bfa22', color: '#a78bfa', border: '1px solid #a78bfa44', borderRadius: 8, padding: '4px 6px', fontSize: 13, fontWeight: 800, textAlign: 'center' }}>{r.location || '—'}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>{r.name}</div>
                      {r.observations && <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>📝 {r.observations}</div>}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right', color: C.sub, fontSize: 13, fontWeight: 700 }}>👥 {r.people_count ?? '-'}</div>
                  </div>
                ))
              }
            </div>
          )
        })()}
      </Modal>

      {/* Enviar flyer */}
      {/* ── Modal avaliação de equipe ── */}
      <Modal open={!!ratingEv} title={`⭐ Avaliar equipe — ${ratingEv?.name ?? ''}`} onClose={() => setRatingEv(null)} wide>
        {ratingEv && (
          <div style={{ display: 'grid', gap: 12 }}>
            {ratingEntries.length === 0 ? (
              <div style={{ textAlign: 'center', color: C.mut, padding: '24px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👷</div>
                <div>Nenhum membro escalado para este evento.</div>
              </div>
            ) : (
              ratingEntries.map((e, i) => (
                <div key={e.freelancer_id} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <span style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>{e.full_name}</span>
                      {e.role && <span style={{ color: C.mut, fontSize: 11, marginLeft: 8 }}>{e.role}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[1,2,3,4,5].map(star => (
                        <button key={star} onClick={() => setRatingEntries(prev => prev.map((r, idx) => idx === i ? { ...r, rating: r.rating === star ? 0 : star } : r))}
                          style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: star <= e.rating ? '#f59e0b' : C.brd, padding: '0 1px', lineHeight: 1 }}>
                          ★
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    value={e.comment}
                    onChange={ev2 => setRatingEntries(prev => prev.map((r, idx) => idx === i ? { ...r, comment: ev2.target.value } : r))}
                    placeholder="Comentário opcional..."
                    style={{ width: '100%', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '6px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                </div>
              ))
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              {ratingEntries.length > 0 && (
                <Btn onClick={saveRatings} style={{ flex: 1 }} disabled={ratingSaving}>
                  {ratingSaving ? 'Salvando...' : '💾 Salvar avaliações'}
                </Btn>
              )}
              <Btn onClick={() => setRatingEv(null)} variant="ghost" style={ratingEntries.length === 0 ? { flex: 1 } : undefined}>Cancelar</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!flyerEv} title={`📤 Enviar flyer — ${flyerEv?.name ?? ''}`} onClose={() => { if (!flyerSending) { setFlyerEv(null); setFlyerClients([]) } }} wide>
        {flyerEv && (() => {
          const filtered = flyerClients.filter(c => {
            const mg = flyerGender === 'all' || (c.gender ?? '') === flyerGender
            const ms = !flyerSearch || c.full_name.toLowerCase().includes(flyerSearch.toLowerCase()) || (c.phone ?? '').includes(flyerSearch)
            return mg && ms
          })
          const allSel = filtered.length > 0 && filtered.every(c => flyerSel.has(c.id))
          const toggle = (id: string) => setFlyerSel(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
          const toggleAll = () => setFlyerSel(prev => { const n = new Set(prev); if (allSel) filtered.forEach(c => n.delete(c.id)); else filtered.forEach(c => n.add(c.id)); return n })
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                {flyerEv.flyer_url
                  ? <img loading="lazy" decoding="async" src={flyerEv.flyer_url} alt="flyer" style={{ width: '100%', borderRadius: 10, marginBottom: 10, maxHeight: 280, objectFit: 'cover' }} />
                  : <div style={{ background: C.bg, border: `1px dashed ${C.brd}`, borderRadius: 10, padding: 20, textAlign: 'center', color: C.mut, fontSize: 13, marginBottom: 10 }}>Sem flyer cadastrado — será enviado só o texto.</div>}
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>Mensagem (use {'{{nome}}'} para o nome e {'{{link}}'} para o link individual)</label>
                <textarea value={flyerMsg} onChange={e => setFlyerMsg(e.target.value)} style={{ width: '100%', minHeight: 150, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginTop: 4, boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px' }}>
                  <span style={{ fontSize: 13, color: C.txt, fontWeight: 600, flex: 1 }}>👥 Convidar amigos</span>
                  {flyerFriendsOn && (
                    <input type="number" min="0" max="99" value={flyerMaxFriends}
                      title="0 = ilimitado"
                      onChange={e => setFlyerMaxFriends(Math.max(0, parseInt(e.target.value || '0')))}
                      style={{ width: 50, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '5px 8px', color: C.txt, fontSize: 13, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }} />
                  )}
                  {/* toggle ON/OFF */}
                  <button onClick={() => setFlyerFriendsOn(v => !v)}
                    title={flyerFriendsOn ? 'Ligado — clique para desligar' : 'Desligado — clique para ligar'}
                    style={{ display: 'inline-flex', width: 44, height: 24, borderRadius: 12, background: flyerFriendsOn ? C.grn : C.brd, border: 'none', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s' }}>
                    <span style={{ position: 'absolute', top: 2, left: flyerFriendsOn ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px #0005' }} />
                  </button>
                </div>
                {flyerFriendsOn && flyerMaxFriends === 0 && (
                  <div style={{ fontSize: 11, color: '#10b981', fontWeight: 600, marginTop: 4 }}>♾️ Amigos ilimitados (0 = sem limite)</div>
                )}

                {/* Toggle Convidado VIP */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, background: C.bg, border: `1px solid ${flyerVip ? C.gold + '66' : C.brd}`, borderRadius: 8, padding: '8px 10px' }}>
                  <span style={{ fontSize: 13, color: flyerVip ? C.gold : C.txt, fontWeight: 600, flex: 1 }}>⭐ Convidado VIP</span>
                  <button onClick={() => setFlyerVip(v => !v)}
                    title={flyerVip ? 'VIP ligado — clique para desligar' : 'Desligado — clique para ligar'}
                    style={{ display: 'inline-flex', width: 44, height: 24, borderRadius: 12, background: flyerVip ? C.gold : C.brd, border: 'none', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s' }}>
                    <span style={{ position: 'absolute', top: 2, left: flyerVip ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px #0005' }} />
                  </button>
                </div>

                <div style={{ fontSize: 11, color: C.mut, marginTop: 6 }}>
                  🔗 Cada cliente recebe um link <span style={{ color: '#a78bfa' }}>/confirmar</span> exclusivo — confirma presença com 1 clique, sem preencher cadastro{flyerFriendsOn ? (flyerMaxFriends === 0 ? ', e pode convidar amigos ilimitados pelo link' : `, e pode convidar até ${flyerMaxFriends} amigo(s) pelo link`) : ' (convite de amigos desligado)'}.{flyerVip ? ' A mensagem incluirá "VOCÊ É NOSSO CONVIDADO VIP" e marcará os convidados como VIP.' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <input value={flyerSearch} onChange={e => setFlyerSearch(e.target.value)} placeholder="🔍 Buscar contato" style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit', marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                  {([['all', 'Todos'], ['masculino', '♂'], ['feminino', '♀']] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setFlyerGender(v)} style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${flyerGender === v ? C.acc : C.brd}`, background: flyerGender === v ? C.acc + '22' : 'transparent', color: flyerGender === v ? C.acc : C.mut, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
                  ))}
                  <button onClick={toggleAll} style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 7, border: `1px solid ${C.brd}`, background: 'transparent', color: C.sub, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{allSel ? 'Limpar' : 'Todos'}</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', maxHeight: 320, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
                  {filtered.length === 0
                    ? <div style={{ color: C.mut, fontSize: 12, textAlign: 'center', padding: 20 }}>Nenhum contato com telefone.</div>
                    : filtered.map(c => {
                      const on = flyerSel.has(c.id)
                      return (
                        <div key={c.id} onClick={() => toggle(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: `1px solid ${C.brd}22`, cursor: 'pointer', background: on ? C.acc + '11' : 'transparent' }}>
                          <span style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${on ? C.acc : C.brd}`, background: on ? C.acc : 'transparent', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{on ? '✓' : ''}</span>
                          <span style={{ flex: 1, color: C.txt, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}{c.gender ? <span style={{ color: c.gender === 'feminino' ? '#f472b6' : C.acc, marginLeft: 5 }}>{c.gender === 'feminino' ? '♀' : '♂'}</span> : ''}</span>
                          <span style={{ color: C.mut, fontSize: 11, flexShrink: 0 }}>{c.phone}</span>
                        </div>
                      )
                    })}
                </div>
                <div style={{ marginTop: 10 }}>
                  {flyerSending
                    ? <div style={{ textAlign: 'center', color: C.sub, fontSize: 13, fontWeight: 700 }}>Enviando… {flyerProgress.sent}/{flyerProgress.total}</div>
                    : <Btn onClick={sendFlyer} style={{ width: '100%' }} disabled={flyerSel.size === 0}>📤 Enviar para {flyerSel.size} contato(s)</Btn>}
                  <div style={{ fontSize: 11, color: C.mut, textAlign: 'center', marginTop: 6 }}>Envio automático pelo WhatsApp da casa (Evolution API).</div>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Budget modal */}
      <Modal open={!!budgetEv} title={`💰 Budget — ${budgetEv?.name ?? ''}`} onClose={() => { setBudgetEv(null); setBudgetFreelancers([]); setBudgetPromoters([]); setBudgetResItems([]); setBudgetExpenses([]); setBudgetRes([]); setBudgetTasks([]); setBudgetOverrides({}); setEditKey(null) }} wide noDirtyCheck>
        {budgetEv && (() => {
          const B = budgetLeafTotals(budgetEv)
          const { ab, cache, consumacao, producao, freelancerTotal, promoterTotal, resItemsTotal, tasksTotal, total, reservasRevenue, checkinRev, otherRevenue, revenue, margin, artistFees } = B
          const promos = budgetEv.promotions_list ?? []
          const taskAreas: Record<string, { icon: string; tasks: EventTask[] }> = {}
          budgetTasks.forEach(t => { if (!taskAreas[t.area]) taskAreas[t.area] = { icon: t.area_icon, tasks: [] }; taskAreas[t.area].tasks.push(t) })

          // Célula de valor editável: mostra o ajuste manual se existir, com ✏️ para ajustar e ↺ para reverter ao calculado
          const editableAmount = (key: string, computed: number, color: string, label: string, sz = 15) => {
            const ov = budgetOverrides[key]
            const shown = ov?.amount_cents ?? computed
            if (editKey === key) {
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input value={editVal} autoFocus onChange={e => setEditVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitOverride(budgetEv.id, key, label); if (e.key === 'Escape') setEditKey(null) }}
                    style={{ width: 84, background: C.bg, border: `1px solid ${C.acc}`, borderRadius: 6, padding: '4px 6px', color: C.txt, fontSize: 13, fontFamily: 'inherit', textAlign: 'right' }} />
                  <button onClick={() => commitOverride(budgetEv.id, key, label)} title="Salvar" style={{ background: C.acc, border: 'none', borderRadius: 6, padding: '4px 7px', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✓</button>
                  <button onClick={() => setEditKey(null)} title="Cancelar" style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '4px 6px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                </div>
              )
            }
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {ov && <span title="valor ajustado manualmente" style={{ fontSize: 9, color: C.acc, background: `${C.acc}22`, borderRadius: 5, padding: '1px 5px', fontWeight: 700, textTransform: 'uppercase' }}>ajust.</span>}
                <span style={{ color, fontWeight: 700, fontSize: sz }}>{fmtCurrency(shown)}</span>
                {ov && <button onClick={() => clearOverride(key)} title="Reverter ao valor calculado" style={{ background: 'none', border: 'none', color: C.mut, fontSize: 12, cursor: 'pointer', padding: 0, lineHeight: 1 }}>↺</button>}
                <button onClick={() => beginEdit(key, shown)} title="Ajustar valor" style={{ background: 'none', border: 'none', color: C.mut, fontSize: 12, cursor: 'pointer', padding: 0, lineHeight: 1 }}>✏️</button>
              </div>
            )
          }

          const row = (icon: string, label: string, value: number, color: string, sub?: string, key?: string) => (
            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${C.brd}` }}>
              <div style={{ fontSize: 20, width: 34 }}>{icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.txt, fontSize: 14, fontWeight: 600 }}>{label}</div>
                {sub && <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>{sub}</div>}
              </div>
              {key ? editableAmount(key, value, color, label) : <div style={{ color, fontWeight: 700, fontSize: 15 }}>{fmtCurrency(value)}</div>}
            </div>
          )

          return (
            <div>
              {/* Resumo */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button onClick={() => printBudget(budgetEv)} style={{ background: 'var(--c-panel2)', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 12px', color: C.sub, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🖨️ Imprimir fechamento</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#10b98110', border: '1px solid #10b98133', borderRadius: 10, padding: '10px 12px', textAlign: 'center', position: 'relative' }}>
                  <button onClick={() => { setRevAdding(true); setRevForm({ description: '', amount: '' }) }} title="Adicionar outra receita" style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 6, border: '1px solid #10b98144', background: '#10b98122', color: '#10b981', fontSize: 14, fontWeight: 900, cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                  <div style={{ fontSize: 10, color: '#10b981', fontWeight: 700, textTransform: 'uppercase' }}>Receita</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#10b981' }}>{fmtCurrency(revenue)}</div>
                  <div style={{ fontSize: 10, color: C.mut }}>{checkinRev > 0 ? 'portaria + ' : ''}{budgetRes.length} reservas{otherRevenue > 0 ? ` + extras` : ''}</div>
                </div>
                <div style={{ background: '#f59e0b10', border: '1px solid #f59e0b33', borderRadius: 10, padding: '10px 12px', textAlign: 'center', position: 'relative' }}>
                  <button onClick={() => { setExpAdding(true); setExpForm(p => ({ description: '', amount: '', area: p.area })) }} title="Adicionar despesa" style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 6, border: '1px solid #f59e0b44', background: '#f59e0b22', color: '#f59e0b', fontSize: 16, fontWeight: 900, cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                  <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase' }}>Despesas</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#f59e0b' }}>{fmtCurrency(total)}</div>
                </div>
                <div style={{ background: margin >= 0 ? '#10b98110' : '#f8717110', border: `1px solid ${margin >= 0 ? '#10b98133' : '#f8717133'}`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: margin >= 0 ? '#10b981' : '#f87171', fontWeight: 700, textTransform: 'uppercase' }}>Margem</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: margin >= 0 ? '#10b981' : '#f87171' }}>{fmtCurrency(margin)}</div>
                </div>
              </div>

              {/* Receita: portaria (check-ins) + reservas + outras receitas */}
              {(checkinRev > 0 || budgetOverrides['checkin']) && row('🚪', 'Receita de portaria (check-ins)', checkinRev, '#10b981', 'Entradas pagas na porta', 'checkin')}
              {row('🪑', 'Receita de reservas', reservasRevenue, '#10b981', `${budgetRes.length} reservas do dia`, 'reservas')}
              {renderRevenues(budgetExpenses, budgetEv)}
              {/* Artistas */}
              {ab.list.length > 0
                ? ab.list.map((a, i) => (
                  <Fragment key={i}>{row('🎤', a.name || `Artista ${i + 1}`, artistFees[i], C.gold, a.fee_type === 'percent' ? `${a.fee_percent}% da portaria${(a.fee_cents ?? 0) > 0 ? ` · mín. ${fmtCurrency(a.fee_cents ?? 0)}` : ''}` : (a.fee_type === 'tbd' ? 'A combinar' : undefined), 'artist:' + i)}</Fragment>
                ))
                : row('🎤', 'Cachê do Artista', cache, C.gold, undefined, 'cache')}

              {(consumacao > 0 || budgetOverrides['consumacao']) && row('🍺', 'Consumação (artistas)', consumacao, '#f59e0b', undefined, 'consumacao')}
              {row('🔧', 'Gastos de Produção', producao, '#8b5cf6', undefined, 'producao')}

              {/* Promoções — referência de venda, não entram no custo */}
              {promos.length > 0 && (
                <div style={{ borderBottom: `1px solid ${C.brd}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0 6px' }}>
                    <div style={{ fontSize: 20, width: 34 }}>🎉</div>
                    <div style={{ flex: 1, color: C.txt, fontSize: 14, fontWeight: 600 }}>Promoções</div>
                    <span style={{ fontSize: 10, background: '#f59e0b22', color: '#f59e0b', borderRadius: 6, padding: '2px 7px', fontWeight: 700 }}>referência</span>
                  </div>
                  {promos.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '3px 0 3px 34px' }}>
                      <div style={{ flex: 1, color: C.mut, fontSize: 12 }}>{p.label || `Promoção ${i + 1}`}</div>
                      {(p.value_cents ?? 0) > 0 && <div style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}>{fmtCurrency(p.value_cents ?? 0)}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* Freelancers agrupados por área */}
              {(() => {
                const anyFrIn = budgetFreelancers.some(ef => !!(ef as any).checkin_at)
                const counts = (ef: typeof budgetFreelancers[number]) => !anyFrIn || !!(ef as any).checkin_at
                const presentN = budgetFreelancers.filter(counts).length
                const byArea = new Map<string, typeof budgetFreelancers>()
                for (const ef of budgetFreelancers) {
                  const area = ef.freelancers?.work_types?.[0] ?? 'outros'
                  byArea.set(area, [...(byArea.get(area) ?? []), ef])
                }
                return (
                  <div style={{ borderBottom: `1px solid ${C.brd}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0 6px' }}>
                      <div style={{ fontSize: 20, width: 34 }}>👷</div>
                      <div style={{ flex: 1, color: C.txt, fontSize: 14, fontWeight: 600 }}>Freelancers ({anyFrIn ? `${presentN}/${budgetFreelancers.length} presentes` : budgetFreelancers.length})</div>
                      <div style={{ color: C.acc, fontWeight: 700, fontSize: 15 }}>{fmtCurrency(freelancerTotal)}</div>
                    </div>
                    {[...byArea.entries()].map(([area, frs]) => {
                      const areaTotal = frs.filter(counts).reduce((s, ef) => s + effVal('fr:' + ef.id, custoFr(ef)), 0)
                      return (
                        <div key={area} style={{ paddingLeft: 34, marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
                            <div style={{ flex: 1, color: C.sub, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{wlabel(area)}</div>
                            <div style={{ color: C.sub, fontSize: 11, fontWeight: 700 }}>{fmtCurrency(areaTotal)}</div>
                          </div>
                          {frs.map(ef => {
                            const absent = anyFrIn && !(ef as any).checkin_at
                            return (
                              <div key={ef.id} style={{ display: 'flex', alignItems: 'center', padding: '2px 0 2px 12px', opacity: absent ? 0.55 : 1 }}>
                                <div style={{ flex: 1, color: C.mut, fontSize: 12, textDecoration: absent ? 'line-through' : 'none' }}>{ef.freelancers?.full_name}{absent && <span style={{ color: C.red, fontSize: 10, fontWeight: 700, marginLeft: 6, textDecoration: 'none' }}>faltou</span>}</div>
                                {absent
                                  ? <span style={{ color: C.mut, fontSize: 12 }}>—</span>
                                  : editableAmount('fr:' + ef.id, custoFr(ef), C.mut, ef.freelancers?.full_name ?? 'Freelancer', 12)}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}

              {/* Promoters */}
              <div style={{ borderBottom: `1px solid ${C.brd}` }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0 6px' }}>
                  <div style={{ fontSize: 20, width: 34 }}>📋</div>
                  <div style={{ flex: 1, color: C.txt, fontSize: 14, fontWeight: 600 }}>Promoters ({budgetPromoters.length} listas)</div>
                  <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: 15 }}>{fmtCurrency(promoterTotal)}</div>
                </div>
                {budgetPromoters.map(l => {
                  const ent = Math.max(l.guest_count, l.min_entries)
                  const sub = [
                    l.fixed_fee_cents > 0 ? `Fixo: ${fmtCurrency(l.fixed_fee_cents)}` : null,
                    ent > 0 && l.entry_fee_cents > 0 ? `${ent} entradas × ${fmtCurrency(l.entry_fee_cents)}` : null,
                    ent > 0 && l.consumacao_cents > 0 ? `Consumação: ${fmtCurrency(ent * l.consumacao_cents)}` : null,
                  ].filter(Boolean).join(' · ')
                  const listTotal = l.fixed_fee_cents + ent * l.entry_fee_cents + ent * l.consumacao_cents
                  const pname = (l.promoters as { full_name: string } | undefined)?.full_name ?? l.name
                  return (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '3px 0 3px 34px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.mut, fontSize: 12 }}>{pname}</div>
                        {sub && <div style={{ color: C.brd, fontSize: 11 }}>{sub} · {l.guest_count} convidados</div>}
                      </div>
                      {editableAmount('promoter:' + l.id, listTotal, C.mut, pname, 12)}
                    </div>
                  )
                })}
              </div>

              {/* Reservas — opcionais */}
              {budgetResItems.length > 0 && (
                <div style={{ borderBottom: `1px solid ${C.brd}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0 6px' }}>
                    <div style={{ fontSize: 20, width: 34 }}>🪑</div>
                    <div style={{ flex: 1, color: C.txt, fontSize: 14, fontWeight: 600 }}>Reservas — Opcionais</div>
                    <div style={{ color: C.gold, fontWeight: 700, fontSize: 15 }}>{fmtCurrency(resItemsTotal)}</div>
                  </div>
                  {budgetResItems.map((i, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', padding: '3px 0 3px 34px' }}>
                      <div style={{ flex: 1, color: C.mut, fontSize: 12 }}>
                        {i.quantity > 1 ? `${i.quantity}× ` : ''}{i.name}
                        {(i.reservations as { name: string } | undefined)?.name ? ` (${(i.reservations as { name: string }).name})` : ''}
                      </div>
                      {editableAmount('resitem:' + idx, (i.quantity || 1) * (i.unit_cost_cents || 0), C.mut, i.name, 12)}
                    </div>
                  ))}
                </div>
              )}

              {/* Tarefas de produção */}
              {budgetTasks.length > 0 && (
                <div style={{ borderBottom: `1px solid ${C.brd}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0 6px' }}>
                    <div style={{ fontSize: 20, width: 34 }}>📋</div>
                    <div style={{ flex: 1, color: C.txt, fontSize: 14, fontWeight: 600 }}>Tarefas de produção</div>
                    <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 15 }}>{fmtCurrency(tasksTotal)}</div>
                  </div>
                  {Object.entries(taskAreas).map(([area, g]) => {
                    const at = g.tasks.reduce((s, t) => s + (t.actual_cost_cents ?? t.estimated_cost_cents ?? 0), 0)
                    if (at === 0 && !budgetOverrides['taskarea:' + area]) return null
                    return (
                      <div key={area} style={{ display: 'flex', alignItems: 'center', padding: '3px 0 3px 34px' }}>
                        <div style={{ flex: 1, color: C.mut, fontSize: 12 }}>{g.icon} {area}</div>
                        {editableAmount('taskarea:' + area, at, C.mut, area, 12)}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Outras despesas */}
              {budgetEv && renderExpenses(budgetExpenses, budgetEv)}

              {/* Total de despesas + Margem */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '14px 0 4px', borderTop: `2px solid ${C.brd}`, marginTop: 6 }}>
                <div style={{ fontSize: 20, width: 34 }}>📤</div>
                <div style={{ flex: 1, color: C.txt, fontSize: 15, fontWeight: 800 }}>Total de despesas</div>
                <div style={{ color: '#f59e0b', fontWeight: 900, fontSize: 18 }}>{fmtCurrency(total)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0 4px', background: `linear-gradient(135deg,${(margin >= 0 ? C.grn : C.red)}10,transparent)`, borderRadius: 8 }}>
                <div style={{ fontSize: 22, width: 34 }}>{margin >= 0 ? '🟢' : '🔴'}</div>
                <div style={{ flex: 1, color: C.txt, fontSize: 16, fontWeight: 900 }}>{margin >= 0 ? 'MARGEM' : 'PREJUÍZO'}</div>
                <div style={{ color: margin >= 0 ? C.grn : C.red, fontWeight: 900, fontSize: 22 }}>{fmtCurrency(margin)}</div>
              </div>
              <div style={{ fontSize: 11, color: C.mut, marginTop: 8 }}>Receita = reservas do dia. Custos de tarefas usam o valor real quando informado, senão o estimado.</div>
            </div>
          )
        })()}
      </Modal>

      <div className="r-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h1 style={{ color: C.txt, fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>🎉 Eventos</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(() => {
            const today = new Date()
            const ds = selDate ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
            const label = new Date(ds + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
            return (
              <Btn onClick={() => createOperationDay(ds)} disabled={opDayBusy} variant="secondary"
                title="Dia sem evento em que a casa abre e precisa de equipe escalada (permite escala, check-in da equipe e budget)">
                🛠️ Dia de operação ({label})
              </Btn>
            )
          })()}
          {canFeat('ingressos') && (
            <Btn onClick={openAllTickets} variant="secondary" style={cbtn('#ec4899')}
              title="Visão geral das vendas de ingressos de todos os eventos">
              🎫 Ingressos{pendCount > 0 ? ` (${pendCount})` : ''}
            </Btn>
          )}
          <Btn onClick={openNew} icon="➕">Novo Evento</Btn>
        </div>
      </div>

      {/* Próximos / Arquivo */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {([[false, `📅 Próximos (${upcomingEvents.filter(inCalMonth).length})`], [true, `📦 Arquivo (${pastEvents.filter(inCalMonth).length})`]] as const).map(([arch, label]) => (
          <button key={String(arch)} onClick={() => { setShowArchive(arch); setSelDate(null) }}
            style={{ padding: '8px 16px', borderRadius: 10, border: `1px solid ${showArchive === arch ? C.acc : C.brd}`, background: showArchive === arch ? C.acc + '22' : 'transparent', color: showArchive === arch ? C.acc : C.mut, fontSize: 13, fontWeight: showArchive === arch ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Calendar strip */}
      <Card style={{ padding: '10px 14px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => { let m = calM - 1; let y = calY; if (m < 0) { m = 11; y-- } setCalM(m); setCalY(y) }}
            style={{ background: 'none', border: 'none', color: C.mut, cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>‹</button>
          <span style={{ color: C.txt, fontSize: 13, fontWeight: 700, minWidth: 110, textAlign: 'center' }}>{MONTHS[calM]} {calY}</span>
          <button onClick={() => { let m = calM + 1; let y = calY; if (m > 11) { m = 0; y++ } setCalM(m); setCalY(y) }}
            style={{ background: 'none', border: 'none', color: C.mut, cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>›</button>
          <div style={{ flex: 1, display: 'flex', gap: 3, overflowX: 'auto' }}>
            {Array.from({ length: daysInMonth(calY, calM) }).map((_, i) => {
              const day = i + 1
              const dateStr = `${calY}-${String(calM + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const hasEv = eventDates.has(dateStr)
              const isSel = selDate === dateStr
              return (
                <button key={day} onClick={() => setSelDate(isSel ? null : dateStr)}
                  style={{ background: isSel ? C.acc : hasEv ? C.acc + '22' : 'transparent', color: isSel ? '#fff' : hasEv ? C.acc : C.mut, border: 'none', borderRadius: 5, padding: '4px 6px', fontSize: 11, cursor: 'pointer', fontWeight: hasEv ? 700 : 400, flexShrink: 0 }}>
                  {day}
                  {hasEv && <div style={{ width: 4, height: 4, borderRadius: '50%', background: isSel ? '#fff' : C.acc, margin: '1px auto 0' }} />}
                </button>
              )
            })}
          </div>
          {selDate && (
            <button onClick={() => setSelDate(null)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '5px 10px', color: C.mut, fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>
              Ver todos
            </button>
          )}
        </div>
      </Card>

      {/* Event cards */}
      {filteredEvents.length === 0
        ? <Card><div style={{ color: C.mut, textAlign: 'center', padding: 40 }}>{selDate ? 'Nenhum evento nesta data' : `Nenhum evento ${showArchive ? 'arquivado' : ''} em ${MONTHS[calM]} ${calY}`}</div></Card>
        : showArchive
          /* ── ARQUIVO: cards compactos em lista ── */
          ? <Card style={{ padding: 0 }}>
              {filteredEvents.map((ev, idx) => (
                <div key={ev.id} className="arch-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: idx < filteredEvents.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
                  {/* Thumb */}
                  {ev.flyer_url
                    ? <img loading="lazy" decoding="async" src={ev.flyer_url} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0, border: `1px solid ${C.brd}` }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    : <div style={{ width: 40, height: 40, borderRadius: 6, background: C.card, border: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🎉</div>
                  }
                  {/* Info */}
                  <div className="arch-info" style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.name}</div>
                    <div style={{ color: C.mut, fontSize: 12, display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
                      <span>📅 {fd(ev.event_date)}</span>
                      {!!ev.checkinCount && <span style={{ color: C.grn }}>✓ {ev.checkinCount}</span>}
                      {!!ev.pagantesCount && <span style={{ color: C.gold }}>💰 {ev.pagantesCount} pag.</span>}
                      {!!ev.cortesiasCount && <span style={{ color: '#38bdf8' }}>🎁 {ev.cortesiasCount} cort.</span>}
                      {!!ev.resCount && <span style={{ color: '#a78bfa' }}>🪑 {ev.resCount}</span>}
                      {!!((ev.resPeople ?? 0) + (ev.listGuests ?? 0)) && <span style={{ color: C.acc }}>👥 {(ev.resPeople ?? 0) + (ev.listGuests ?? 0)}</span>}
                    </div>
                  </div>
                  {/* Status + ações */}
                  <div className="arch-actions" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Pill color={evStatusColor(ev.status ?? 'ativo')} small>{ev.status ?? 'ativo'}</Pill>
                    <Btn onClick={() => openEdit(ev)} small variant="ghost" title="Editar">✏️</Btn>
                    {canFeat('budget') && <Btn onClick={() => openBudget(ev)} small variant="secondary" style={cbtn('#10b981')} title="Budget">💰</Btn>}
                    <Btn onClick={() => openRating(ev)} small variant="secondary" style={cbtn('#f59e0b')} title="Avaliar equipe">⭐ Avaliar</Btn>
                    {ev.status !== 'encerrado' && (
                      <Btn onClick={() => closeEv(ev)} small variant="secondary" style={cbtn('#6366f1')} title="Encerrar evento e arquivar reservas">
                        <i className="bi bi-archive-fill" /> Encerrar
                      </Btn>
                    )}
                    {ev.status === 'encerrado' && (
                      <Btn onClick={() => cancelEv(ev)} small variant="secondary" style={cbtn('#10b981')} title="Reativar evento">
                        ↩ Reativar
                      </Btn>
                    )}
                    <Btn onClick={() => deleteEv(ev)} small variant="danger" title="Excluir permanentemente">
                      <i className="bi bi-trash3-fill" />
                    </Btn>
                  </div>
                </div>
              ))}
            </Card>
          /* ── PRÓXIMOS: cards completos em grid ── */
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
            {filteredEvents.map(ev => (
              <Card key={ev.id}>
                {/* Flyer */}
                {ev.flyer_url && (
                  <div style={{ position: 'relative', width: '100%', paddingBottom: '56%', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
                    <img loading="lazy" decoding="async" src={ev.flyer_url} alt={ev.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                )}
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <div style={{ color: C.txt, fontWeight: 700, fontSize: 15, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.name}</div>
                      {(ev as { is_operation?: boolean }).is_operation && (
                        <span title="Dia de operação (sem evento) — só escala/equipe" style={{ flexShrink: 0, background: C.mut + '22', color: C.mut, border: `1px solid ${C.brd}`, borderRadius: 6, padding: '1px 7px', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>operação</span>
                      )}
                    </div>
                    <div style={{ color: C.mut, fontSize: 12 }}>{fd(ev.event_date)} · {(ev.start_time ?? '').slice(0, 5)}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0, marginLeft: 8 }}>
                    <Pill color={evStatusColor(ev.status ?? 'ativo')} small>{ev.status ?? 'ativo'}</Pill>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {!!ev.checkinCount && <span style={{ background: C.grn + '22', color: C.grn, borderRadius: 8, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{ev.checkinCount} ✓</span>}
                      {!!ev.resCount && <span style={{ background: '#a78bfa22', color: '#a78bfa', borderRadius: 8, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{ev.resCount} 🪑</span>}
                      {!!((ev.resPeople ?? 0) + (ev.listGuests ?? 0)) && (
                        <span title={`Previstas: ${ev.resPeople ?? 0} em reservas + ${ev.listGuests ?? 0} em listas`} style={{ background: C.acc + '22', color: C.acc, borderRadius: 8, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>👥 {(ev.resPeople ?? 0) + (ev.listGuests ?? 0)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => openFlyer(ev)} title="Enviar flyer para contatos" style={{ width: '100%', background: '#25d36614', border: '1px solid #25d36633', borderRadius: 8, padding: '6px 12px', color: '#25d366', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginBottom: 8 }}>📤 Enviar flyer</button>
                {ev.genre && <div style={{ color: C.acc, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>🎵 {ev.genre}</div>}
                {(() => {
                  const names = (ev.artists ?? []).map(a => a.name).filter(n => n && n.trim())
                  return names.length > 0 ? (
                    <div style={{ color: '#f472b6', fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                      <span>🎤</span><span>{names.join(' · ')}</span>
                    </div>
                  ) : null
                })()}
                {ev.promotions && <div style={{ color: C.gold, fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 5 }}><span>🎉</span><span>{ev.promotions}</span></div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11, color: C.mut, marginBottom: 10 }}>
                  {ev.price_male_cents ? <span>♂ {fmtCurrency(ev.price_male_cents)}</span> : null}
                  {ev.price_female_cents ? <span>♀ {fmtCurrency(ev.price_female_cents)}</span> : null}
                  {ev.capacity ? <span>👥 Cap. {ev.capacity}</span> : null}
                  {(ev as any).artist_fee_type === 'percent'
                    ? <span style={{ color: C.gold }}>🎤 {(ev as any).artist_fee_percent}% portaria</span>
                    : (ev as any).artist_fee_type === 'tbd'
                      ? <span style={{ color: C.gold }}>🎤 A combinar</span>
                      : ev.artist_fee_cents ? <span style={{ color: C.gold }}>🎤 {fmtCurrency(ev.artist_fee_cents)}</span> : null}
                </div>
                {/* Checklist */}
                {(() => {
                  const total = ev.tasksTotal ?? 0
                  const done = ev.tasksDone ?? 0
                  const pct = total > 0 ? Math.round(done / total * 100) : 0
                  const complete = total > 0 && done === total
                  return (
                    <button onClick={() => openCheck(ev)} title="Abrir checklist de produção" style={{ width: '100%', textAlign: 'left', background: complete ? '#10b98112' : '#7c3aed12', border: `1px solid ${complete ? '#10b98140' : '#7c3aed33'}`, borderRadius: 10, padding: '8px 12px', marginBottom: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: total > 0 ? 6 : 0 }}>
                        <span style={{ color: complete ? C.grn : '#a78bfa', fontSize: 12, fontWeight: 700 }}>📋 Checklist</span>
                        <span style={{ color: complete ? C.grn : C.mut, fontSize: 11, fontWeight: 700 }}>{total > 0 ? `${done}/${total} · ${pct}%` : 'sem tarefas'}</span>
                      </div>
                      {total > 0 && (
                        <div style={{ height: 6, background: C.brd, borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: complete ? '#10b981' : 'linear-gradient(90deg,#7c3aed,#a78bfa)', borderRadius: 4, transition: 'width .3s' }} />
                        </div>
                      )}
                    </button>
                  )
                })()}
                {/* Botões */}
                {(() => {
                  const needs = ev.staffing_needs ?? {}
                  const totalMissing = Object.entries(needs).reduce((sum, [key, need]) => {
                    const assigned = ev.teamByArea?.[key] ?? 0
                    return sum + Math.max(0, (need as number) - assigned)
                  }, 0)
                  return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <Btn onClick={() => openEdit(ev)} small variant="secondary" style={cbtn('#94a3b8')}>✏️ Editar</Btn>
                  {canFeat('listas') && <Btn onClick={() => loadGuests(ev)} small variant="secondary" style={cbtn('#3b82f6')}>👥 Listas</Btn>}
                  {canFeat('reservas') && <Btn onClick={() => openResView(ev)} small variant="secondary" style={cbtn('#a78bfa')}>🪑 Reservas{(ev.resCount ?? 0) > 0 ? ` (${ev.resCount})` : ''}</Btn>}
                  {canFeat('equipe') && <Btn onClick={() => loadEvFreelancers(ev)} small variant="secondary" style={{ ...cbtn('#22d3ee'), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    👷 Equipe
                    {(ev.teamTotal ?? 0) > 0 && (
                      <span title={`${ev.teamTotal} escalado(s) · ${ev.teamOk} confirmou(aram)`}
                        style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {ev.teamTotal}/<span style={{ color: ev.teamOk === ev.teamTotal ? C.grn : '#f59e0b' }}>{ev.teamOk}</span>
                      </span>
                    )}
                    {totalMissing > 0 && (
                      <span style={{ background: '#f59e0b', color: '#000', borderRadius: '50%', width: 18, height: 18, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, animation: 'badgePulse 1.4s ease-in-out infinite' }}>{totalMissing}</span>
                    )}
                  </Btn>}
                  {canFeat('ingressos') && <Btn onClick={() => openTickets(ev)} small variant="secondary" style={cbtn('#ec4899')}>🎫 Ingressos</Btn>}
                  {canFeat('budget') && <Btn onClick={() => openBudget(ev)} small variant="secondary" style={cbtn('#10b981')}>💰 Budget</Btn>}
                  {canFeat('producao') && <Btn onClick={() => openProd(ev)} small variant="secondary" style={cbtn('#f59e0b')}>🏭 Produção</Btn>}
                  {/* Encerrar → escolhe entre arquivar ou excluir (cadastro errado) */}
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <Btn onClick={() => setEndMenu(endMenu === ev.id ? null : ev.id)} small variant="secondary" style={cbtn('#6366f1')} title="Encerrar: arquivar ou excluir">📦 Encerrar ▾</Btn>
                    {endMenu === ev.id && (<>
                      <div onClick={() => setEndMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                      <div style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 6, zIndex: 41, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 6, minWidth: 230, boxShadow: '0 14px 36px rgba(0,0,0,0.35)', display: 'grid', gap: 2 }}>
                        <button onClick={() => { setEndMenu(null); closeEv(ev) }}
                          style={{ textAlign: 'left', background: 'none', border: 'none', borderRadius: 8, padding: '9px 12px', color: C.txt, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                          onMouseEnter={e => (e.currentTarget.style.background = C.acc + '15')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                          📦 Arquivar<div style={{ fontSize: 11, color: C.mut, fontWeight: 400 }}>Guarda no Arquivo com o histórico</div>
                        </button>
                        <button onClick={() => { setEndMenu(null); deleteEv(ev) }}
                          style={{ textAlign: 'left', background: 'none', border: 'none', borderRadius: 8, padding: '9px 12px', color: C.red, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                          onMouseEnter={e => (e.currentTarget.style.background = C.red + '15')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                          🗑 Excluir<div style={{ fontSize: 11, color: C.mut, fontWeight: 400 }}>Apaga de vez (cadastro errado)</div>
                        </button>
                      </div>
                    </>)}
                  </div>
                </div>
                  )
                })()}
              </Card>
            ))}
          </div>
      }

      {/* ── Production panel (drawer standalone — só fora do cadastro) ── */}
      {prodEv && !modal && (
        <>
          <div onClick={() => setProdEv(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 680, background: C.card, borderLeft: `1px solid ${C.brd}`, zIndex: 1001, display: 'flex', flexDirection: 'column' }}>

            {/* Header */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 2 }}>🏭 PRODUÇÃO</div>
                  <div style={{ fontSize: 17, fontWeight: 900, color: C.txt }}>{prodEv.name}</div>
                  <div style={{ fontSize: 12, color: C.mut, marginTop: 2 }}>
                    {new Date(prodEv.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                    {prodEv.start_time ? ` · ${prodEv.start_time.slice(0,5)}` : ''}
                  </div>
                </div>
                <button onClick={() => setProdEv(null)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, width: 32, height: 32, color: C.mut, fontSize: 18, cursor: 'pointer' }}>✕</button>
              </div>
              {/* Progress bar */}
              {prodTasks.length > 0 && (() => {
                const done = prodTasks.filter(t => t.status === 'done').length
                const pct = Math.round(done / prodTasks.length * 100)
                return (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.mut, marginBottom: 4 }}>
                      <span>{done}/{prodTasks.length} tarefas concluídas</span>
                      <span style={{ color: pct === 100 ? '#10b981' : '#f59e0b', fontWeight: 700 }}>{pct}%</span>
                    </div>
                    <div style={{ height: 6, background: C.brd, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10b981' : 'linear-gradient(90deg,#f59e0b,#fbbf24)', borderRadius: 4, transition: 'width .3s' }} />
                    </div>
                  </div>
                )
              })()}
              {/* Tabs */}
              {renderProdTabs()}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {renderProdBody()}
            </div>
          </div>
        </>
      )}


      {/* ── Modal de confirmação com senha (cancelar / encerrar / excluir) ── */}
      {cancelConfirm && (
        <>
          <div onClick={() => setCancelConfirm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2001, background: C.card, borderRadius: 16, padding: 24, width: 'min(90vw,400px)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ fontSize: 24, textAlign: 'center', marginBottom: 12 }}>
              {cancelConfirm.action === 'delete' ? '🗑️' : cancelConfirm.action === 'close' ? '📦' : '❌'}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.txt, textAlign: 'center', marginBottom: 6 }}>
              {cancelConfirm.action === 'delete' ? 'Excluir evento' : cancelConfirm.action === 'close' ? 'Encerrar e arquivar' : 'Cancelar evento'}
            </div>
            <div style={{ fontSize: 13, color: C.mut, textAlign: 'center', marginBottom: 20 }}>
              {cancelConfirm.action === 'delete'
                ? `"${cancelConfirm.ev.name}" será excluído permanentemente.`
                : cancelConfirm.action === 'close'
                  ? `"${cancelConfirm.ev.name}" será encerrado e as reservas arquivadas.`
                  : `"${cancelConfirm.ev.name}" será marcado como cancelado.`}
            </div>
            <div style={{ fontSize: 12, color: C.mut, marginBottom: 6, fontWeight: 600 }}>Digite <strong>CONFIRMAR</strong> para prosseguir:</div>
            <input
              autoFocus
              value={cancelPin}
              onChange={e => setCancelPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && execCancelConfirm()}
              placeholder="CONFIRMAR"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${C.brd}`, background: C.bg, color: C.txt, fontSize: 14, boxSizing: 'border-box', marginBottom: 16, fontFamily: 'inherit', textTransform: 'uppercase' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setCancelConfirm(null)} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: `1px solid ${C.brd}`, background: 'transparent', color: C.mut, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Voltar</button>
              <button onClick={execCancelConfirm} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: cancelConfirm.action === 'delete' ? '#ef4444' : '#f59e0b', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                {cancelConfirm.action === 'delete' ? 'Excluir' : cancelConfirm.action === 'close' ? 'Encerrar' : 'Cancelar evento'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal: Gerenciar série de eventos futuros */}
      <Modal open={serieModal} title="🗑 Gerenciar eventos futuros da série" onClose={() => setSerieModal(false)} wide>
        <div style={{ display: 'grid', gap: 10 }}>
          {serieFutures.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.mut, padding: '24px 0' }}>Nenhum evento futuro encontrado com este nome.</div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.mut, marginBottom: 4 }}>Selecione os eventos futuros da série "{String(form.name ?? '')}" que deseja excluir:</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <Btn small variant="ghost" onClick={() => setSerieDeleting(new Set(serieFutures.map(e => e.id)))}>Selecionar todos</Btn>
                <Btn small variant="ghost" onClick={() => setSerieDeleting(new Set())}>Desmarcar todos</Btn>
              </div>
              {serieFutures.map(ev => {
                const checked = serieDeleting.has(ev.id)
                const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
                return (
                  <div key={ev.id} onClick={() => setSerieDeleting(p => { const s = new Set(p); checked ? s.delete(ev.id) : s.add(ev.id); return s })}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: `1px solid ${checked ? C.red : C.brd}`, background: checked ? C.red + '11' : C.bg, cursor: 'pointer' }}>
                    <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${checked ? C.red : C.brd}`, background: checked ? C.red : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {checked && <span style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: C.txt, fontWeight: 600, fontSize: 13 }}>{ev.name}</div>
                      <div style={{ color: C.mut, fontSize: 12 }}>📅 {dateStr}</div>
                    </div>
                  </div>
                )
              })}
              {serieDeleting.size > 0 && (
                <Btn onClick={deleteSerieFutures} variant="danger">{`🗑 Excluir ${serieDeleting.size} evento(s) selecionado(s)`}</Btn>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
