import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal, FAB, Pill } from '../components/ui'
import { fd, fmtCurrency } from '../utils/format'
import { fmtWAPhone } from '../utils/whatsapp'
import { sT, _err, type ToastState } from '../utils/toast'
import type { House, Event, ArtistEntry, Freelancer, EventFreelancer, TicketBatch, TicketOrder } from '../types'
import { DEFAULT_AREAS, areaMeta, type WorkArea } from '../constants/areas'

function fmtMoneyInput(v: number | string): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')) || 0
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function parseMoneyInput(raw: string): number {
  return parseInt(raw.replace(/\D/g, '') || '0', 10) / 100
}

interface Props { house: House; onGoToReservas?: (date: string, eventId: string) => void }

interface EventWithCounts extends Event {
  checkinCount?: number
  resCount?: number
  resPeople?: number
  listGuests?: number
  tasksTotal?: number
  tasksDone?: number
}

interface Guest {
  id?: string
  full_name: string
  phone?: string
  gender?: string
  birth_date?: string
  list_type?: string
  checked_in?: boolean
  promoter_id?: string
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
  promotions: '', repeat_rule: 'none', capacity: '', birthday_list_enabled: false, house_list_enabled: false,
  attractions: '', flyer_url: '', observations: '',
  artist_fee_cents: 0, artist_fee_type: 'fixed', artist_fee_percent: 0,
  consumption_cents: 0, production_cost_cents: 0, status: 'ativo',
}
const RDEF2 = { name: '', people_count: '2', location: '', amount_cents: '', expected_arrival: '22:00' }

function evStatusColor(s: string) {
  return s === 'ativo' ? C.grn : s === 'cancelado' ? C.red : C.mut
}

export function EventsPage({ house, onGoToReservas }: Props) {
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

  // Guest modal
  const [guestEv, setGuestEv] = useState<EventWithCounts | null>(null)
  const [guests, setGuests] = useState<Guest[]>([])
  const [guestFilter, setGuestFilter] = useState('all')
  const [guestListToken, setGuestListToken] = useState<string | null>(null)
  const [guestListId, setGuestListId] = useState<string | null>(null)
  const [guestListPromoId, setGuestListPromoId] = useState<string | null>(null)
  const [guestAddForm, setGuestAddForm] = useState({ name: '', phone: '', gender: '', birth_date: '' })
  const [guestAdding, setGuestAdding] = useState(false)
  const [listaTab, setListaTab] = useState<'lista' | 'convidar'>('lista')
  const [listaClients, setListaClients] = useState<FlyerClient[]>([])
  const [listaSearch, setListaSearch] = useState('')

  // House list link in event form
  const [houseListToken, setHouseListToken] = useState<string | null>(null)

  // Freelancers
  const [allFreelancers, setAllFreelancers] = useState<Freelancer[]>([])
  const [workAreas, setWorkAreas] = useState<WorkArea[]>(DEFAULT_AREAS)
  const wlabel = (key: string) => { const m = areaMeta(workAreas, key); return `${m.icon} ${m.label}` }
  const [evFreelancers, setEvFreelancers] = useState<EventFreelancer[]>([])
  const [frModal, setFrModal] = useState<EventWithCounts | null>(null)

  // ── Montagem: envia todas as reservas do dia a um montador ──
  const [montagemEv, setMontagemEv] = useState<EventWithCounts | null>(null)
  const [montagemFr, setMontagemFr] = useState('')
  const [montagemMsg, setMontagemMsg] = useState('')

  // Budget modal
  const [budgetEv, setBudgetEv] = useState<EventWithCounts | null>(null)
  const [budgetFreelancers, setBudgetFreelancers] = useState<EventFreelancer[]>([])
  interface BudgetPromoterList { id: string; name: string; fixed_fee_cents: number; min_entries: number; entry_fee_cents: number; consumacao_cents: number; guest_count: number; promoters?: { full_name: string } }
  interface BudgetResItem { name: string; quantity: number; unit_cost_cents: number; reservations?: { name: string } }
  const [budgetPromoters, setBudgetPromoters] = useState<BudgetPromoterList[]>([])
  const [budgetResItems, setBudgetResItems] = useState<BudgetResItem[]>([])

  // Tickets modal
  const [ticketEv, setTicketEv] = useState<EventWithCounts | null>(null)
  const [batches, setBatches] = useState<TicketBatch[]>([])
  const [orders, setOrders] = useState<TicketOrder[]>([])
  const [batchForm, setBatchForm] = useState({ name: '', gender: 'both', price_cents: '', quantity: '', expires_at: '' })
  const [addingBatch, setAddingBatch] = useState(false)
  const [copied, setCopied] = useState(false)

  // Production panel
  const [prodEv, setProdEv] = useState<EventWithCounts | null>(null)
  const [prodTasks, setProdTasks] = useState<EventTask[]>([])
  const [prodRes, setProdRes] = useState<ProdReservation[]>([])
  const [prodTab, setProdTab] = useState<'tasks' | 'freelancers' | 'budget' | 'layout'>('tasks')
  const [prodFr, setProdFr] = useState<EventFreelancer[]>([])
  const [prodStaffing, setProdStaffing] = useState<Record<string, number>>({})
  const [teamArea, setTeamArea] = useState<string | null>(null)
  const [frModalArea, setFrModalArea] = useState<string | null>(null)
  const [addingArea, setAddingArea] = useState(false)
  const [newAreaIcon, setNewAreaIcon] = useState('📋')
  const [newAreaName, setNewAreaName] = useState('')
  const [taskFormArea, setTaskFormArea] = useState<string | null>(null)
  const [taskForm, setTaskForm] = useState({ title: '', deadline: '', assignee_name: '', assignee_phone: '', estimated_cost_cents: '', description: '' })
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const [actualCostEdit, setActualCostEdit] = useState<{ id: string; val: string } | null>(null)
  const [frFeeEdit, setFrFeeEdit] = useState<{ id: string; val: string } | null>(null)

  // Artists
  const [artists, setArtists] = useState<ArtistEntry[]>([])
  function addArtist() { setArtists(a => [...a, { name: '', fee_type: 'fixed', fee_cents: 0, fee_percent: 0, consumption_cents: 0 }]) }
  function removeArtist(i: number) { setArtists(a => a.filter((_, idx) => idx !== i)) }
  function setArtist(i: number, patch: Partial<ArtistEntry>) { setArtists(a => a.map((ar, idx) => idx === i ? { ...ar, ...patch } : ar)) }

  // Checklist do card — checagem das tarefas adicionadas na Produção
  const [checkEv, setCheckEv] = useState<EventWithCounts | null>(null)
  const [checkTasks, setCheckTasks] = useState<EventTask[]>([])

  // Outras despesas do evento (budget)
  interface EventExpense { id: string; event_id: string; description: string; amount_cents: number; kind?: string; area?: string | null }
  const [budgetExpenses, setBudgetExpenses] = useState<EventExpense[]>([])
  const [budgetRes, setBudgetRes] = useState<ProdReservation[]>([])
  const [budgetTasks, setBudgetTasks] = useState<EventTask[]>([])
  const [expForm, setExpForm] = useState({ description: '', amount: '', area: '' })
  const [expAdding, setExpAdding] = useState(false)
  const [revForm, setRevForm] = useState({ description: '', amount: '' })
  const [revAdding, setRevAdding] = useState(false)

  // Reservations modal
  const [resEv, setResEv] = useState<EventWithCounts | null>(null)
  const [resList, setResList] = useState<ResItem[]>([])
  const [resAddOpen, setResAddOpen] = useState(false)
  const [resForm, setResForm] = useState(RDEF2)
  const [resEdit, setResEdit] = useState<string | null>(null)

  // Consulta de reservas do card (somente leitura + impressão)
  interface ResView { id: string; name: string; location?: string; people_count?: number; observations?: string; status: string; expected_arrival?: string }
  const [resViewEv, setResViewEv] = useState<EventWithCounts | null>(null)
  const [resViewList, setResViewList] = useState<ResView[]>([])

  // Enviar flyer (broadcast WhatsApp)
  interface FlyerClient { id: string; full_name: string; phone?: string; gender?: string }
  const [flyerEv, setFlyerEv] = useState<EventWithCounts | null>(null)
  const [flyerClients, setFlyerClients] = useState<FlyerClient[]>([])
  const [flyerSel, setFlyerSel] = useState<Set<string>>(new Set())
  const [flyerMsg, setFlyerMsg] = useState('')
  const [flyerLink, setFlyerLink] = useState('')
  const [flyerSearch, setFlyerSearch] = useState('')
  const [flyerGender, setFlyerGender] = useState<'all' | 'masculino' | 'feminino'>('all')
  const [flyerSending, setFlyerSending] = useState(false)
  const [flyerProgress, setFlyerProgress] = useState({ sent: 0, total: 0 })

  function st2(m: string, t?: string) { sT(setToast, m, t as 'success' | 'error' | 'warn') }

  async function openProd(ev: EventWithCounts) {
    setProdEv(ev); setProdTasks([]); setProdRes([]); setProdTab('tasks'); setProdFr([]); setTeamArea(null); setProdStaffing(ev.staffing_needs ?? {})
    const [tasksR, resR, frR] = await Promise.all([
      supabase.from('event_tasks').select('*').eq('event_id', ev.id).order('area').order('sort_order'),
      supabase.from('reservations').select('*, reservation_items(name, quantity, unit_cost_cents)')
        .eq('house_id', house.id).eq('reservation_date', ev.event_date).neq('status', 'cancelled'),
      supabase.from('event_freelancers').select('*, freelancers(full_name, work_types, daily_rate_cents, phone)').eq('event_id', ev.id),
    ])
    setProdTasks((tasksR.data ?? []) as EventTask[])
    setProdRes((resR.data ?? []) as ProdReservation[])
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
    await supabase.from('event_freelancers').insert({ event_id: prodEv.id, freelancer_id: freelancerId, confirmed: false, role })
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

  // Associação de freelancers pelo modal Equipe do card (recrutamento)
  async function addEvFreelancer(freelancerId: string, role: string) {
    if (!frModal) return
    await supabase.from('event_freelancers').insert({ event_id: frModal.id, freelancer_id: freelancerId, confirmed: false, role })
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
    setTaskForm({ title: '', deadline: '', assignee_name: '', assignee_phone: '', estimated_cost_cents: '', description: '' })
  }

  async function addProdTask(area: string, icon: string) {
    if (!taskForm.title.trim() || !prodEv) return
    const sort = prodTasks.filter(t => t.area === area).length
    const { data } = await supabase.from('event_tasks').insert({
      event_id: prodEv.id, house_id: house.id,
      area, area_icon: icon, title: taskForm.title.trim(),
      description: taskForm.description || null,
      deadline: taskForm.deadline || null,
      assignee_name: taskForm.assignee_name || null,
      assignee_phone: taskForm.assignee_phone || null,
      estimated_cost_cents: taskForm.estimated_cost_cents ? Math.round(parseFloat(taskForm.estimated_cost_cents) * 100) : null,
      sort_order: sort, status: 'pending',
    }).select().single()
    if (data) { setProdTasks(p => [...p, data as EventTask]); setTaskForm({ title: '', deadline: '', assignee_name: '', assignee_phone: '', estimated_cost_cents: '', description: '' }); setTaskFormArea(null) }
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

  function sendTaskWA(task: EventTask) {
    const url = `https://nightpass-app.vercel.app/tarefa.html?t=${task.token}`
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
    const ph = (task.assignee_phone ?? '').replace(/\D/g, '')
    window.open(`https://wa.me/${ph ? '55' + ph : ''}?text=${encodeURIComponent(lines)}`, '_blank')
  }

  async function saveFrFee(id: string, val: string) {
    const cents = val ? Math.round(parseFloat(val) * 100) : null
    await supabase.from('event_freelancers').update({ custom_fee_cents: cents }).eq('id', id)
    setProdFr(p => p.map(f => f.id === id ? { ...f, custom_fee_cents: cents } as EventFreelancer : f))
    setFrFeeEdit(null)
  }

  function convocateFrWA(fr: EventFreelancer) {
    const frData = (fr as any).freelancers
    const ph = (frData?.phone ?? '').replace(/\D/g, '')
    if (!ph) { alert('Freelancer sem telefone cadastrado'); return }
    const lines = [
      `Olá ${frData?.full_name ?? ''}! 👋`,
      prodEv ? `Temos uma vaga para você no evento *${prodEv.name}* — ${new Date(prodEv.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}` : '',
      `Confirme sua disponibilidade respondendo esta mensagem.`,
    ].filter(Boolean).join('\n')
    window.open(`https://wa.me/55${ph}?text=${encodeURIComponent(lines)}`, '_blank')
  }

  function openCheck(ev: EventWithCounts) {
    setCheckEv(ev); setCheckTasks([])
    supabase.from('event_tasks').select('*').eq('event_id', ev.id).order('area').order('sort_order')
      .then(r => setCheckTasks((r.data ?? []) as EventTask[]))
  }

  async function toggleCheckTask(task: EventTask) {
    const done = task.status !== 'done'
    await supabase.from('event_tasks').update({ status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : null, completed_by: done ? 'operador' : null }).eq('id', task.id)
    setCheckTasks(p => p.map(t => t.id === task.id ? { ...t, status: done ? 'done' : 'pending' } as EventTask : t))
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
        supabase.from('checkins').select('event_id').in('event_id', ids)
          .then(cr => {
            const ct: Record<string, number> = {}
            ;(cr.data ?? []).forEach(c => { if (c.event_id) ct[c.event_id] = (ct[c.event_id] ?? 0) + 1 })
            setEvents(prev => prev.map(e => ({ ...e, checkinCount: ct[e.id] ?? 0 })))
          })
        supabase.from('reservations').select('event_id,people_count').in('event_id', ids)
          .then(rr => {
            const rc: Record<string, number> = {}
            const rp: Record<string, number> = {}
            ;(rr.data ?? []).forEach(r => {
              if (!r.event_id) return
              rc[r.event_id] = (rc[r.event_id] ?? 0) + 1
              rp[r.event_id] = (rp[r.event_id] ?? 0) + (r.people_count ?? 0)
            })
            setEvents(prev => prev.map(e => ({ ...e, resCount: rc[e.id] ?? 0, resPeople: rp[e.id] ?? 0 })))
          })
        supabase.from('promoter_list_guests').select('event_id').in('event_id', ids)
          .then(gr => {
            const gc: Record<string, number> = {}
            ;(gr.data ?? []).forEach(g => { if (g.event_id) gc[g.event_id] = (gc[g.event_id] ?? 0) + 1 })
            setEvents(prev => prev.map(e => ({ ...e, listGuests: gc[e.id] ?? 0 })))
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

  useEffect(() => { load() }, [house.id])

  useEffect(() => {
    supabase.from('freelancers').select('*').eq('house_id', house.id).eq('status', 'ativo').order('full_name')
      .then(r => setAllFreelancers((r.data ?? []) as Freelancer[]))
    supabase.from('work_areas').select('*').eq('house_id', house.id).order('sort_order').order('label')
      .then(r => { if (r.data && r.data.length) setWorkAreas(r.data as WorkArea[]) })
  }, [house.id])

  function loadEvFreelancers(ev: EventWithCounts) {
    setFrModal(ev)
    setEvFreelancers([])
    supabase.from('event_freelancers').select('*,freelancers(full_name,work_types,daily_rate_cents,phone)')
      .eq('event_id', ev.id)
      .then(r => setEvFreelancers((r.data ?? []) as EventFreelancer[]))
  }

  // Monta a tarefa de montagem consolidando TODAS as reservas do dia do evento
  async function openMontagem(ev: EventWithCounts) {
    setMontagemEv(ev); setMontagemFr('')
    const { data } = await supabase.from('reservations')
      .select('name, location, people_count, expected_arrival, observations, reservation_items(name, quantity)')
      .eq('house_id', house.id).eq('reservation_date', ev.event_date).neq('status', 'cancelled')
      .order('location')
    const res = (data ?? []) as Array<{ name: string; location?: string; people_count?: number; expected_arrival?: string; observations?: string; reservation_items?: Array<{ name: string; quantity: number }> }>
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

  function sendMontagem() {
    const fr = allFreelancers.find(f => f.id === montagemFr)
    const ph = (fr?.phone ?? '').replace(/\D/g, '')
    window.open(`https://wa.me/${ph ? '55' + ph : ''}?text=${encodeURIComponent(montagemMsg)}`, '_blank')
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

  function printBudget(ev: EventWithCounts) {
    const ab = artistsBreakdown(ev)
    const cache = ab.fee, consumacao = ab.cons
    const producao = ev.production_cost_cents ?? 0
    const freelancerTotal = budgetFreelancers.reduce((s, ef) => s + ((ef as any).custom_fee_cents ?? ef.freelancers?.daily_rate_cents ?? 0), 0)
    const promoterTotal = budgetPromoters.reduce((s, l) => { const ent = Math.max(l.guest_count, l.min_entries); return s + l.fixed_fee_cents + ent * l.entry_fee_cents + ent * l.consumacao_cents }, 0)
    const resItemsTotal = budgetResItems.reduce((s, i) => s + (i.quantity || 1) * (i.unit_cost_cents || 0), 0)
    const manualExp = budgetExpenses.filter(e => e.kind !== 'revenue')
    const expensesTotal = manualExp.reduce((s, e) => s + e.amount_cents, 0)
    const tasksReal = budgetTasks.reduce((s, t) => s + (t.actual_cost_cents ?? 0), 0)
    const tasksEst = budgetTasks.reduce((s, t) => s + (t.estimated_cost_cents ?? 0), 0)
    const tasksTotal = tasksReal > 0 ? tasksReal : tasksEst
    const total = cache + consumacao + producao + freelancerTotal + promoterTotal + resItemsTotal + expensesTotal + tasksTotal
    const reservasRevenue = budgetRes.reduce((s, r) => s + (r.amount_cents ?? 0), 0)
    const otherRev = budgetExpenses.filter(e => e.kind === 'revenue')
    const otherRevTotal = otherRev.reduce((s, e) => s + e.amount_cents, 0)
    const revenue = reservasRevenue + otherRevTotal
    const margin = revenue - total
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
    <table>${rowH(`Reservas do dia (${budgetRes.length})`, reservasRevenue)}${otherRev.map(e => rowH('➕ ' + e.description, e.amount_cents)).join('')}</table>
    <div class="tot"><span>Total de receitas</span><span style="color:#0a7d34">${fmt(revenue)}</span></div>

    <h2>Despesas</h2>
    <table>
      ${ab.list.length > 0 ? ab.list.map((a, i) => rowH('🎤 ' + (a.name || `Artista ${i + 1}`), a.fee_cents ?? 0)).join('') : rowH('🎤 Cachê do artista', cache)}
      ${consumacao > 0 ? rowH('🍺 Consumação (artistas)', consumacao) : ''}
      ${producao > 0 ? rowH('🔧 Gastos de produção', producao) : ''}
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
    setBudgetEv(ev); setBudgetFreelancers([]); setBudgetPromoters([]); setBudgetResItems([]); setBudgetExpenses([]); setBudgetRes([]); setBudgetTasks([]); setExpAdding(false)
    supabase.from('event_expenses').select('*').eq('event_id', ev.id).order('created_at').then(r => setBudgetExpenses((r.data ?? []) as EventExpense[]))
    supabase.from('reservations').select('id,name,location,people_count,amount_cents,status').eq('house_id', house.id).eq('reservation_date', ev.event_date).neq('status', 'cancelled').then(r => setBudgetRes((r.data ?? []) as ProdReservation[]))
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
    setTicketEv(ev); setBatches([]); setOrders([]); setAddingBatch(false)
    supabase.from('ticket_batches').select('*').eq('event_id', ev.id).order('price_cents')
      .then(r => setBatches((r.data ?? []) as TicketBatch[]))
    supabase.from('ticket_orders').select('*,ticket_batches(name,gender,price_cents)')
      .eq('event_id', ev.id).order('created_at', { ascending: false })
      .then(r => setOrders((r.data ?? []) as TicketOrder[]))
  }

  function saveBatch() {
    if (!ticketEv || !batchForm.name.trim() || !batchForm.quantity) return
    const data = {
      event_id: ticketEv.id, house_id: house.id,
      name: batchForm.name.trim(), gender: batchForm.gender,
      price_cents: Math.round((parseFloat(batchForm.price_cents) || 0) * 100),
      quantity: parseInt(batchForm.quantity), sold: 0, active: true,
      expires_at: batchForm.expires_at || null,
    }
    supabase.from('ticket_batches').insert(data).then(() => {
      setBatchForm({ name: '', gender: 'both', price_cents: '', quantity: '', expires_at: '' })
      setAddingBatch(false)
      openTickets(ticketEv)
    })
  }

  function toggleBatch(id: string, active: boolean) {
    supabase.from('ticket_batches').update({ active: !active }).eq('id', id)
      .then(() => { if (ticketEv) openTickets(ticketEv) })
  }

  function deleteBatch(id: string) {
    if (!confirm('Excluir este lote?')) return
    supabase.from('ticket_batches').delete().eq('id', id)
      .then(() => { if (ticketEv) openTickets(ticketEv) })
  }

  function confirmOrder(id: string, status: string) {
    supabase.from('ticket_orders').update({ payment_status: status }).eq('id', id)
      .then(() => { if (ticketEv) openTickets(ticketEv) })
  }

  function copyLink(ev: EventWithCounts) {
    const url = `${window.location.origin}/e/${ev.id}`
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  async function loadGuests(ev: EventWithCounts) {
    setGuestEv(ev)
    setGuests([])
    setGuestFilter('all')
    setGuestListToken(null)
    setGuestListId(null)
    setGuestListPromoId(null)
    setGuestAddForm({ name: '', phone: '', gender: '', birth_date: '' })
    setListaTab('lista')
    setListaSearch('')
    setListaClients([])
    reloadGuests(ev.id)
    const [rec, cl] = await Promise.all([
      ensureHouseListRecord(ev),
      supabase.from('clients').select('id,full_name,phone,gender').eq('house_id', house.id).order('full_name'),
    ])
    if (rec) {
      setGuestListToken(rec.token)
      setGuestListId(rec.listId)
      setGuestListPromoId(rec.promoterId)
    }
    setListaClients((cl.data ?? []) as FlyerClient[])
  }

  function reloadGuests(eventId: string) {
    supabase.from('promoter_list_guests').select('id,full_name,phone,gender,birth_date,list_type,checked_in,promoter_id')
      .eq('event_id', eventId).order('full_name')
      .then(r => setGuests((r.data ?? []) as Guest[]))
  }

  async function addGuestManually() {
    if (!guestAddForm.name.trim() || !guestEv) return
    setGuestAdding(true)
    // Garante que a lista da casa exista (corrige caso o registro ainda não tenha carregado)
    let listId = guestListId, promoId = guestListPromoId
    if (!listId || !promoId) {
      const rec = await ensureHouseListRecord(guestEv)
      if (rec) { listId = rec.listId; promoId = rec.promoterId; setGuestListId(rec.listId); setGuestListPromoId(rec.promoterId); setGuestListToken(rec.token) }
    }
    if (!listId || !promoId) { setGuestAdding(false); st2('Erro: lista da casa não pôde ser criada', 'error'); return }
    const { error } = await supabase.from('promoter_list_guests').insert({
      list_id: listId,
      house_id: house.id,
      event_id: guestEv.id,
      promoter_id: promoId,
      full_name: guestAddForm.name.trim(),
      phone: guestAddForm.phone.replace(/\D/g, '') || null,
      gender: guestAddForm.gender || null,
      birth_date: guestAddForm.birth_date || null,
      list_type: 'normal',
      promoter_confirmed: true,
    })
    setGuestAdding(false)
    if (error) { st2('Erro ao adicionar: ' + error.message, 'error'); return }
    setGuestAddForm({ name: '', phone: '', gender: '', birth_date: '' })
    reloadGuests(guestEv.id)
    st2('Convidado adicionado!', 'success')
  }

  async function toggleGuestVip(g: Guest) {
    if (!g.id || !guestEv) return
    const next = g.list_type === 'vip' ? 'normal' : 'vip'
    await supabase.from('promoter_list_guests').update({ list_type: next }).eq('id', g.id)
    reloadGuests(guestEv.id)
  }

  function doExport() {
    const rows = [['Nome', 'Gênero', 'Lista', 'Check-in']]
    guests.forEach(g => rows.push([g.full_name, g.gender ?? '', g.list_type ?? '', g.checked_in ? 'Sim' : 'Não']))
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = (guestEv?.name ?? 'guests') + '.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function openNew() { setEditing(null); setForm(DEF); setArtists([]); setModal(true) }

  function openEdit(ev: EventWithCounts) {
    setEditing(ev.id)
    setHouseListToken(null)
    // Carrega o MESMO painel de Produção (tarefas, reservas, equipe e checklist) inline no cadastro
    openProd(ev)
    setForm({
      ...ev,
      price_male_cents: ((ev.price_male_cents ?? 0) / 100) || 0,
      price_female_cents: ((ev.price_female_cents ?? 0) / 100) || 0,
      price_male_list_cents: ((ev.price_male_list_cents ?? 0) / 100) || 0,
      price_female_list_cents: ((ev.price_female_list_cents ?? 0) / 100) || 0,
      capacity: ev.capacity ?? '',
      consumption_cents: ((ev.consumption_cents ?? 0) / 100) || 0,
      production_cost_cents: ((ev.production_cost_cents ?? 0) / 100) || 0,
    })
    if (ev.house_list_enabled) {
      ensureHouseListRecord(ev).then(rec => { if (rec) setHouseListToken(rec.token) })
    }
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
  function repeatDates(start: string, rule: string): string[] {
    if (rule === 'none' || !start) return []
    const out: string[] = []
    const horizon = new Date(); horizon.setMonth(horizon.getMonth() + 6)
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

  async function ensureHouseListToken(ev: EventWithCounts): Promise<string | null> {
    const rec = await ensureHouseListRecord(ev)
    return rec?.token ?? null
  }

  async function openFlyer(ev: EventWithCounts) {
    setFlyerEv(ev); setFlyerSel(new Set()); setFlyerSearch(''); setFlyerGender('all'); setFlyerProgress({ sent: 0, total: 0 }); setFlyerClients([])
    const { data } = await supabase.from('clients').select('id,full_name,phone,gender').eq('house_id', house.id).not('phone', 'is', null).order('full_name')
    setFlyerClients((data ?? []) as FlyerClient[])
    const token = await ensureHouseListToken(ev)
    const link = token ? `${window.location.origin}/lista/${token}` : ''
    setFlyerLink(link)
    const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
    setFlyerMsg(`🎉 Olá {{nome}}! Não perca *${ev.name}* — ${dateStr}${ev.start_time ? ` às ${ev.start_time.slice(0, 5)}` : ''}!` + (link ? `\n\n✅ Confirme sua presença na lista da casa: ${link}` : '') + `\n\nTe esperamos! 🔥`)
  }

  async function sendFlyer() {
    if (!flyerEv) return
    const { data: cfg } = await supabase.from('whatsapp_config').select('*').eq('house_id', house.id).limit(1).single()
    if (!cfg?.active) { st2('Ative a integração WhatsApp em Configurações para enviar.', 'error'); return }
    const sel = flyerClients.filter(c => flyerSel.has(c.id) && c.phone)
    if (sel.length === 0) { st2('Selecione ao menos um contato.', 'warn'); return }
    setFlyerSending(true); setFlyerProgress({ sent: 0, total: sel.length })
    let ok = 0
    for (const c of sel) {
      const fph = fmtWAPhone(c.phone ?? '')
      if (fph) {
        const msg = flyerMsg.replace(/\{\{nome\}\}/g, (c.full_name || '').split(' ')[0])
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

  function save() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { checkinCount, resCount, resPeople, listGuests, tasksTotal, tasksDone, id, created_at, artist_fee_cents, artist_fee_type, artist_fee_percent, consumption_cents: _cc, ...formRest } = form as Record<string, unknown>
    const d = {
      ...formRest,
      house_id: house.id,
      price_male_cents: Math.round((parseFloat(String(form.price_male_cents)) || 0) * 100),
      price_female_cents: Math.round((parseFloat(String(form.price_female_cents)) || 0) * 100),
      price_male_list_cents: Math.round((parseFloat(String(form.price_male_list_cents)) || 0) * 100),
      price_female_list_cents: Math.round((parseFloat(String(form.price_female_list_cents)) || 0) * 100),
      capacity: form.capacity ? parseInt(String(form.capacity)) : null,
      artists: artists.map(a => ({ ...a, fee_cents: Math.round((a.fee_cents ?? 0) * 100), consumption_cents: Math.round((a.consumption_cents ?? 0) * 100) })),
      production_cost_cents: Math.round((parseFloat(String(form.production_cost_cents)) || 0) * 100),
      status: editing ? (form.status ?? 'ativo') : 'ativo',
      updated_at: new Date().toISOString(),
    }
    if (editing) {
      supabase.from('events').update(d).eq('id', editing).then(r => {
        if (r.error) st2('Erro: ' + r.error.message, 'error')
        else { st2('Atualizado!'); setModal(false); load() }
      })
      return
    }
    // Create: generate future occurrences if a repeat rule is set
    const rule = String(form.repeat_rule ?? 'none')
    const extras = repeatDates(String(form.event_date ?? ''), rule).filter(dt => !eventDates.has(dt))
    const rows = [d, ...extras.map(dt => ({ ...d, event_date: dt, repeat_rule: 'none' }))]
    supabase.from('events').insert(rows).select().then(r => {
      if (r.error) { st2('Erro: ' + r.error.message, 'error'); return }
      st2(extras.length > 0 ? `Criado! +${extras.length} eventos repetidos` : 'Criado!')
      load()
      const created = (r.data ?? [])[0] as EventWithCounts | undefined
      if (created) {
        // Mantém o cadastro aberto em modo edição e já ativa a Produção do evento criado
        setEditing(created.id)
        setForm(f => ({ ...f, id: created.id, status: created.status ?? 'ativo' }))
        openProd(created)
      } else {
        setModal(false)
      }
    })
  }

  function cancelEv(ev: EventWithCounts) {
    const ns = ev.status === 'cancelado' ? 'ativo' : 'cancelado'
    if (!confirm(ev.status === 'cancelado' ? 'Reativar este evento?' : 'Cancelar este evento?')) return
    supabase.from('events').update({ status: ns, updated_at: new Date().toISOString() }).eq('id', ev.id)
      .then(r => { if (!r.error) load(); else _err(r.error.message) })
  }

  async function closeEv(ev: EventWithCounts) {
    if (!confirm(`Encerrar "${ev.name}"?\n\nO evento será marcado como encerrado e todas as suas reservas serão arquivadas (saem da view principal mas ficam no histórico).`)) return
    const now = new Date().toISOString()
    await supabase.from('events').update({ status: 'encerrado', updated_at: now }).eq('id', ev.id)
    await supabase.from('reservations').update({ archived_at: now }).eq('house_id', house.id).eq('event_id', ev.id).is('archived_at', null)
    load()
  }

  function deleteEv(ev: EventWithCounts) {
    if (!confirm(`Excluir permanentemente "${ev.name}"?\n\nEsta ação não pode ser desfeita. Check-ins e reservas vinculados também serão excluídos.`)) return
    supabase.from('events').delete().eq('id', ev.id)
      .then(r => { if (!r.error) load(); else _err(r.error.message) })
  }

  function openRes(ev: EventWithCounts) {
    setResEv(ev)
    supabase.from('reservations').select('*').eq('event_id', ev.id).order('expected_arrival')
      .then(r => setResList((r.data ?? []) as ResItem[]))
  }

  function openResView(ev: EventWithCounts) {
    setResViewEv(ev); setResViewList([])
    supabase.from('reservations').select('id,name,location,people_count,observations,status,expected_arrival')
      .eq('house_id', house.id).or(`reservation_date.eq.${ev.event_date},event_id.eq.${ev.id}`).neq('status', 'cancelled')
      .order('location', { nullsFirst: false }).order('name')
      .then(r => setResViewList((r.data ?? []) as ResView[]))
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
  async function uploadFlyer(file: File): Promise<string | null> {
    const ext = file.name.split('.').pop()
    const path = `${house.id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('event-flyers').upload(path, file, { upsert: true })
    if (error) { st2('Erro no upload: ' + error.message, 'error'); return null }
    const { data } = supabase.storage.from('event-flyers').getPublicUrl(path)
    return data.publicUrl
  }

  // Calendar helpers
  const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
  const eventDates = new Set(events.map(e => e.event_date))
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

  const todayStr = new Date().toISOString().slice(0, 10)
  const sortedAsc = [...events].sort((a, b) => a.event_date.localeCompare(b.event_date))
  const upcomingEvents = sortedAsc.filter(e => e.event_date >= todayStr)
  const pastEvents = [...sortedAsc.filter(e => e.event_date < todayStr)].reverse()
  const filteredEvents = selDate
    ? sortedAsc.filter(e => e.event_date === selDate)
    : showArchive ? pastEvents : upcomingEvents
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>{fmtCurrency(e.amount_cents)}</span>
                    <button onClick={() => deleteExpense(e.id)} title="Remover" style={{ background: 'none', border: 'none', color: C.red, fontSize: 13, cursor: 'pointer' }}>🗑</button>
                  </div>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#10b981', fontWeight: 600 }}>{fmtCurrency(e.amount_cents)}</span>
              <button onClick={() => deleteExpense(e.id)} title="Remover" style={{ background: 'none', border: 'none', color: C.red, fontSize: 13, cursor: 'pointer' }}>🗑</button>
            </div>
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
    <select value="" onChange={e => { const f = allFreelancers.find(x => x.id === e.target.value); if (f) setTaskForm(p => ({ ...p, assignee_name: f.full_name, assignee_phone: f.phone ?? '' })) }}
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
                          <div key={r.id} style={{ background: r.status === 'arrived' ? '#10b98110' : '#ffffff06', border: `1px solid ${r.status === 'arrived' ? '#10b98133' : C.brd}`, borderRadius: 10, padding: '8px 12px', marginBottom: 6 }}>
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
                            <button onClick={() => { setTaskFormArea(`${area}|||${icon}`); setTaskForm({ title: '', deadline: '', assignee_name: '', assignee_phone: '', estimated_cost_cents: '', description: '' }) }}
                              style={{ background: '#ffffff08', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.mut, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>+ Tarefa</button>
                          </div>
                          {tasks.sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0)).map(task => (
                            <div key={task.id} style={{ background: task.status === 'done' ? '#10b98108' : '#ffffff06', border: `1px solid ${task.status === 'done' ? '#10b98122' : C.brd}`, borderRadius: 10, padding: '8px 10px', marginBottom: 5 }}>
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
                                  <button onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)} style={{ background: '#ffffff08', border: `1px solid ${C.brd}`, borderRadius: 6, width: 28, height: 28, color: C.mut, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⋯</button>
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
                                        : <button onClick={() => setActualCostEdit({ id: task.id, val: task.actual_cost_cents ? String(task.actual_cost_cents / 100) : '' })} style={{ background: '#ffffff08', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.mut, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                                            {task.actual_cost_cents ? `R$ ${(task.actual_cost_cents / 100).toFixed(2)}` : '+ Informar'}
                                          </button>
                                      }
                                    </div>
                                  )}
                                  <div style={{ fontSize: 11, color: C.mut }}>
                                    🔗 Link: <span style={{ color: '#a78bfa', cursor: 'pointer' }} onClick={() => navigator.clipboard.writeText(`https://nightpass-app.vercel.app/tarefa.html?t=${task.token}`)}>Copiar</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                          {isAdding && (
                            <div style={{ background: '#ffffff06', border: `1px solid #f59e0b44`, borderRadius: 10, padding: '10px 12px', marginBottom: 5 }}>
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
                          <div style={{ background: '#ffffff06', border: `1px solid #f59e0b44`, borderRadius: 10, padding: '10px 12px' }}>
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
                              <button onClick={() => setTaskFormArea(null)} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
                            </div>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Add new area */}
                    {addingArea
                      ? (
                        <div style={{ background: '#ffffff06', border: `1px solid #f59e0b44`, borderRadius: 10, padding: '12px 14px', marginTop: 8 }}>
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
                        <button onClick={() => setAddingArea(true)} style={{ width: '100%', background: '#ffffff06', border: `1px dashed ${C.brd}`, borderRadius: 10, padding: '10px', color: C.mut, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: Object.keys(areas).length > 0 ? 0 : 8 }}>
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
                    <div key={fr.id} style={{ background: '#ffffff06', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
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
                        <button onClick={() => toggleProdFrConfirmed(fr)} title={fr.confirmed ? 'Confirmado' : 'Pendente'} style={{ background: fr.confirmed ? '#10b98122' : '#ffffff08', border: `1px solid ${fr.confirmed ? '#10b98144' : C.brd}`, borderRadius: 8, padding: '5px 8px', color: fr.confirmed ? '#10b981' : C.mut, fontSize: 13, cursor: 'pointer' }}>{fr.confirmed ? '✅' : '⏳'}</button>
                        <button onClick={() => convocateFrWA(fr)} style={{ background: '#25d36622', border: '1px solid #25d36644', borderRadius: 8, padding: '5px 10px', color: '#25d366', fontSize: 13, cursor: 'pointer' }} title="Convocar via WhatsApp">📲</button>
                        <button onClick={() => removeProdFreelancer(fr.id)} title="Remover da equipe" style={{ background: 'none', border: `1px solid ${C.red}33`, borderRadius: 8, padding: '5px 8px', color: C.red, fontSize: 13, cursor: 'pointer' }}>🗑</button>
                      </div>
                    </div>
                  )
                }

                return (
                  <div>
                    {/* Quota: necessário por área (planejamento) */}
                    <div style={{ marginBottom: 16, padding: '10px 12px', background: '#ffffff04', border: `1px solid ${C.brd}`, borderRadius: 10 }}>
                      <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 8 }}>📊 NECESSÁRIO POR ÁREA <span style={{ fontWeight: 400 }}>(quantos freelancers cada área precisa)</span></div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 6 }}>
                        {workAreas.map(a => {
                          const assigned = prodFr.filter(fr => roleOf(fr) === a.key).length
                          const need = prodStaffing[a.key] ?? 0
                          const ok = need > 0 && assigned >= need
                          return (
                            <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#ffffff06', border: `1px solid ${ok ? '#10b98144' : C.brd}`, borderRadius: 8, padding: '5px 8px' }}>
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
                          <button onClick={() => setTeamArea(role)} style={{ background: '#ffffff08', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.mut, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>+ Freelancer</button>
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
                            <button key={a.key} onClick={() => setTeamArea(a.key)} style={{ background: '#ffffff06', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 12px', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{a.icon} {a.label}</button>
                          ))}
                        </div>
                      </div>
                    ) : (() => {
                      const available = allFreelancers.filter(f => !prodFr.some(pf => pf.freelancer_id === f.id && roleOf(pf) === teamArea))
                      const suggested = available.filter(f => (f.work_types ?? []).includes(teamArea as never))
                      const others = available.filter(f => !(f.work_types ?? []).includes(teamArea as never))
                      const ordered = [...suggested, ...others]
                      return (
                        <div style={{ padding: '12px 14px', background: '#ffffff06', border: `1px solid #f59e0b44`, borderRadius: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>Adicionar em {roleLabel(teamArea)}</span>
                            <button onClick={() => setTeamArea(null)} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 16, cursor: 'pointer' }}>✕</button>
                          </div>
                          {ordered.length === 0
                            ? <div style={{ fontSize: 12, color: C.mut, textAlign: 'center', padding: '8px 0' }}>{allFreelancers.length === 0 ? 'Nenhum freelancer cadastrado. Cadastre na aba Freelancers.' : 'Todos os freelancers já estão nesta área.'}</div>
                            : ordered.map(f => (
                              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}22` }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{f.full_name} {(f.work_types ?? []).includes(teamArea as never) && <span style={{ fontSize: 10, color: '#10b981' }}>• da função</span>}</div>
                                  <div style={{ fontSize: 11, color: C.mut }}>
                                    {(f.work_types ?? []).map(wt => wlabel(wt)).join(' · ')}
                                    {f.daily_rate_cents ? ` · ${fmtCurrency(f.daily_rate_cents)}/dia` : ''}
                                  </div>
                                </div>
                                <button onClick={() => { addProdFreelancer(f.id, teamArea) }} style={{ background: '#f59e0b22', border: '1px solid #f59e0b44', borderRadius: 8, padding: '5px 12px', color: '#f59e0b', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>➕ Add</button>
                              </div>
                            ))
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(4,6,18,0.97)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 28px', borderBottom: `1px solid ${C.brd}`, flexShrink: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.txt }}>{editing ? 'Editar Evento' : 'Novo Evento'}</h2>
            <button onClick={() => { setModal(false); setEditing(null); setProdEv(null) }} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 26, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
          {/* Body: 55/45 split (form / produção) */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT: event form (55%) */}
        <div style={{ flex: '0 0 55%', overflowY: 'auto', padding: '20px 28px', borderRight: `1px solid ${C.brd}` }}>
        {/* 2-column layout: left = info, right = prices + flyer */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

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
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Promoções</label>
              <input {...inp} value={String(form.promotions ?? '')} onChange={e => setF('promotions', e.target.value)} placeholder="Open bar 22h-23h..." />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Observações</label>
              <textarea {...inp} style={{ ...inp.style, height: 60, resize: 'vertical' as const }}
                value={String(form.observations ?? '')} onChange={e => setF('observations', e.target.value)}
                placeholder="Instruções internas, notas de produção..." />
            </div>
          </div>

          {/* ── Right column ── */}
          <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            {/* Flyer */}
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Flyer do Evento</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: C.mut }}>
                {form.flyer_url as string
                  ? <img src={String(form.flyer_url)} alt="flyer" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                  : <span>📁</span>
                }
                <span style={{ flex: 1 }}>{form.flyer_url ? 'Trocar imagem' : 'Selecionar imagem (JPG, PNG, WEBP)'}</span>
                {form.flyer_url as string && (
                  <button onClick={e => { e.preventDefault(); setF('flyer_url', '') }} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 4, color: C.mut, cursor: 'pointer', fontSize: 11, padding: '2px 6px' }}>✕</button>
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
                <input inputMode="decimal" {...inp} value={`R$ ${fmtMoneyInput(form.price_male_cents as number)}`} onChange={e => setF('price_male_cents', parseMoneyInput(e.target.value))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Cover Fem (R$)</label>
                <input inputMode="decimal" {...inp} value={`R$ ${fmtMoneyInput(form.price_female_cents as number)}`} onChange={e => setF('price_female_cents', parseMoneyInput(e.target.value))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Lista Masc (R$)</label>
                <input inputMode="decimal" {...inp} value={`R$ ${fmtMoneyInput(form.price_male_list_cents as number)}`} onChange={e => setF('price_male_list_cents', parseMoneyInput(e.target.value))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Lista Fem (R$)</label>
                <input inputMode="decimal" {...inp} value={`R$ ${fmtMoneyInput(form.price_female_list_cents as number)}`} onChange={e => setF('price_female_list_cents', parseMoneyInput(e.target.value))} />
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
                    background: hle ? '#10b98111' : 'rgba(255,255,255,0.03)',
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
                        if (ev) {
                          const rec = await ensureHouseListRecord({ ...ev, house_list_enabled: true })
                          if (rec) setHouseListToken(rec.token)
                        }
                      } else if (!next) {
                        setHouseListToken(null)
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
            {/* Link da lista (visível ao editar com toggle ON) */}
            {editing && !!form.house_list_enabled && houseListToken && (
              <div style={{ background: '#10b98111', border: '1px solid #10b98133', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <i className="bi bi-link-45deg" style={{ color: '#10b981', fontSize: 16, flexShrink: 0 }} />
                <span style={{ color: '#10b981', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {`${window.location.origin}/lista/${houseListToken}`}
                </span>
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/lista/${houseListToken}`); st2('Link copiado!', 'success') }}
                  style={{ background: '#10b98133', border: '1px solid #10b98166', borderRadius: 6, padding: '3px 10px', color: '#10b981', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                  Copiar
                </button>
              </div>
            )}
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
        </div>

        {/* ── Artists section (full width) ── */}
        <div style={{ marginTop: 14, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 14px' }}>
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

        {/* RIGHT: production panel (45%) — MESMO painel inline (renderProdTabs/renderProdBody) */}
        <div style={{ flex: '0 0 45%', overflowY: 'hidden', padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
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

      {/* Guest list modal — large, two-tab layout */}
      <Modal open={!!guestEv} title={`👥 Lista da Casa — ${guestEv?.name ?? ''}`} maxWidth={960} onClose={() => { setGuestEv(null); setGuests([]); setGuestListToken(null); setGuestListId(null); setGuestListPromoId(null); setListaClients([]) }}>

        {/* Link compartilhável */}
        {guestListToken && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#10b98111', border: '1px solid #10b98133', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
            <i className="bi bi-link-45deg" style={{ color: '#10b981', fontSize: 18, flexShrink: 0 }} />
            <span style={{ color: '#10b981', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {`${window.location.origin}/lista/${guestListToken}`}
            </span>
            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/lista/${guestListToken}`); st2('Link copiado!', 'success') }}
              style={{ background: '#10b98133', border: '1px solid #10b98166', borderRadius: 7, padding: '5px 14px', color: '#10b981', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
              Copiar Link
            </button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['lista', 'convidar'] as const).map(t => (
            <button key={t} onClick={() => setListaTab(t)} style={{
              padding: '8px 18px', borderRadius: 8, border: `1px solid ${listaTab === t ? C.acc : C.brd}`,
              background: listaTab === t ? C.acc + '22' : 'transparent',
              color: listaTab === t ? C.acc : C.mut, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {t === 'lista' ? `📋 Lista (${guests.length})` : `📨 Convidar Clientes`}
            </button>
          ))}
        </div>

        {/* ── ABA LISTA ── */}
        {listaTab === 'lista' && (
          <>
            {/* Valor da lista (cadastrado no evento) */}
            {guestEv && ((guestEv.price_male_list_cents ?? 0) > 0 || (guestEv.price_female_list_cents ?? 0) > 0) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 130, background: '#3b82f610', border: '1px solid #3b82f633', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>♂</span>
                  <div><div style={{ fontSize: 10, color: C.mut, fontWeight: 600 }}>LISTA MASC</div><div style={{ fontSize: 15, fontWeight: 800, color: '#60a5fa' }}>{fmtCurrency(guestEv.price_male_list_cents ?? 0)}</div></div>
                </div>
                <div style={{ flex: 1, minWidth: 130, background: '#ec489910', border: '1px solid #ec489933', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>♀</span>
                  <div><div style={{ fontSize: 10, color: C.mut, fontWeight: 600 }}>LISTA FEM</div><div style={{ fontSize: 15, fontWeight: 800, color: '#f472b6' }}>{fmtCurrency(guestEv.price_female_list_cents ?? 0)}</div></div>
                </div>
              </div>
            )}

            {/* Adicionar manualmente */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, marginBottom: 8, letterSpacing: '0.06em' }}>➕ ADICIONAR MANUALMENTE</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input placeholder="Nome *" value={guestAddForm.name} onChange={e => setGuestAddForm(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addGuestManually()}
                  style={{ flex: '2 1 160px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                <input placeholder="Telefone" value={guestAddForm.phone} onChange={e => setGuestAddForm(p => ({ ...p, phone: e.target.value }))}
                  style={{ flex: '1 1 130px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
                <select value={guestAddForm.gender} onChange={e => setGuestAddForm(p => ({ ...p, gender: e.target.value }))}
                  style={{ flex: '0 0 100px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }}>
                  <option value="">Gênero</option>
                  <option value="M">♂ Masc</option>
                  <option value="F">♀ Fem</option>
                </select>
                <input type="date" placeholder="Nascimento" value={guestAddForm.birth_date} onChange={e => setGuestAddForm(p => ({ ...p, birth_date: e.target.value }))}
                  title="Data de nascimento (cadastra o cliente automaticamente no check-in)"
                  style={{ flex: '0 0 140px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: guestAddForm.birth_date ? C.txt : C.mut, fontSize: 13, fontFamily: 'inherit' }} />
                <Btn onClick={addGuestManually} disabled={!guestAddForm.name.trim() || guestAdding} small>
                  {guestAdding ? '...' : 'Adicionar'}
                </Btn>
              </div>
            </div>

            {/* Filtros */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {(['all', 'present', 'pending'] as const).map(f => (
                <Btn key={f} onClick={() => setGuestFilter(f)} variant={guestFilter === f ? 'primary' : 'ghost'} small>
                  {f === 'all' ? `Todos (${guests.length})` : f === 'present' ? `✅ Presentes (${guests.filter(g => g.checked_in).length})` : `⏳ Pendentes (${guests.filter(g => !g.checked_in).length})`}
                </Btn>
              ))}
              <Btn onClick={doExport} small variant="secondary" style={{ marginLeft: 'auto' }}>📥 CSV</Btn>
            </div>

            {/* Lista de convidados — grid de 2 colunas se houver espaço */}
            {guests.length === 0
              ? <div style={{ color: C.mut, textAlign: 'center', padding: '32px 0' }}>Nenhum convidado na lista ainda</div>
              : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0 24px' }}>
                  {guests
                    .filter(g => guestFilter === 'all' ? true : guestFilter === 'present' ? g.checked_in : !g.checked_in)
                    .map((g, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brd}` }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{g.checked_in ? '✅' : g.gender === 'F' ? '♀' : g.gender === 'M' ? '♂' : '👤'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: g.checked_in ? C.grn : C.txt, fontSize: 13, fontWeight: g.checked_in ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {g.full_name}{g.list_type === 'vip' && <span style={{ color: C.gold, marginLeft: 6, fontSize: 11, fontWeight: 800 }}>⭐ VIP</span>}
                          </div>
                          <div style={{ color: C.mut, fontSize: 11, display: 'flex', gap: 8 }}>
                            {g.phone && <span>{g.phone}</span>}
                            {g.birth_date && <span style={{ color: C.acc }}>🎂 {new Date(g.birth_date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>}
                          </div>
                        </div>
                        <button onClick={() => toggleGuestVip(g)} title="Entrada VIP (gratuita)"
                          style={{ flexShrink: 0, background: g.list_type === 'vip' ? C.gold + '22' : 'transparent', border: `1px solid ${g.list_type === 'vip' ? C.gold : C.brd}`, borderRadius: 8, padding: '4px 8px', color: g.list_type === 'vip' ? C.gold : C.mut, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {g.list_type === 'vip' ? '⭐ VIP' : 'VIP'}
                        </button>
                        {g.checked_in && <span style={{ color: C.grn, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✓ Entrou</span>}
                      </div>
                    ))
                  }
                </div>
              )
            }
          </>
        )}

        {/* ── ABA CONVIDAR CLIENTES ── */}
        {listaTab === 'convidar' && (() => {
          const baseLink = guestListToken ? `${window.location.origin}/lista/${guestListToken}` : ''
          const q = listaSearch.toLowerCase()
          const filtered = listaClients.filter(c =>
            c.full_name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)
          )

          function makePersonalLink(c: FlyerClient) {
            return `${baseLink}?nome=${encodeURIComponent(c.full_name)}${c.phone ? `&tel=${c.phone.replace(/\D/g, '')}` : ''}`
          }

          function openWhatsApp(c: FlyerClient) {
            if (!c.phone) { st2('Cliente sem telefone cadastrado', 'warn'); return }
            const ev = guestEv!
            const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
            const link = makePersonalLink(c)
            const msg = `Olá ${c.full_name.split(' ')[0]}! 🎉 Você está convidado(a) para *${ev.name}* — ${dateStr}${ev.start_time ? ` às ${ev.start_time.slice(0, 5)}` : ''}.\n\n✅ Confirme sua presença na lista da casa:\n${link}\n\nTe esperamos! 🔥`
            const phone = '55' + c.phone.replace(/\D/g, '')
            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
          }

          return (
            <>
              <div style={{ marginBottom: 12 }}>
                <input
                  placeholder="🔍 Buscar cliente por nome ou telefone..."
                  value={listaSearch}
                  onChange={e => setListaSearch(e.target.value)}
                  style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 14px', color: C.txt, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
                />
              </div>

              {!baseLink && (
                <div style={{ color: C.mut, textAlign: 'center', padding: 24 }}>
                  Ative a Lista da Casa no cadastro do evento para gerar o link de convite.
                </div>
              )}

              {baseLink && filtered.length === 0 && (
                <div style={{ color: C.mut, textAlign: 'center', padding: 24 }}>
                  {listaSearch ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
                </div>
              )}

              {baseLink && filtered.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, marginBottom: 10, letterSpacing: '0.06em' }}>
                    {filtered.length} CLIENTE{filtered.length !== 1 ? 'S' : ''} — clique para enviar convite via WhatsApp
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                    {filtered.map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: C.acc + '22', border: `1px solid ${C.acc}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0, color: C.acc, fontWeight: 800 }}>
                          {c.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: C.txt, fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}</div>
                          <div style={{ color: C.mut, fontSize: 11 }}>{c.phone ?? 'Sem telefone'}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                          <button
                            onClick={() => { navigator.clipboard.writeText(makePersonalLink(c)); st2('Link copiado!', 'success') }}
                            title="Copiar link personalizado"
                            style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, borderRadius: 7, padding: '5px 8px', color: C.acc, fontSize: 13, cursor: 'pointer' }}>
                            <i className="bi bi-link-45deg" />
                          </button>
                          <button
                            onClick={() => openWhatsApp(c)}
                            title="Enviar via WhatsApp"
                            style={{ background: '#25D36622', border: '1px solid #25D36644', borderRadius: 7, padding: '5px 8px', color: '#25D366', fontSize: 13, cursor: 'pointer' }}>
                            <i className="bi bi-whatsapp" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )
        })()}
      </Modal>

      {/* Montagem modal — todas as reservas do dia para um montador */}
      <Modal open={!!montagemEv} title={`📐 Montagem — ${montagemEv?.name ?? ''}`} onClose={() => setMontagemEv(null)}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Montador (equipe / freelancer)</label>
            <select value={montagemFr} onChange={e => setMontagemFr(e.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }}>
              <option value="">— Selecionar montador —</option>
              {allFreelancers.map(f => <option key={f.id} value={f.id}>{f.full_name}{f.phone ? ` · ${f.phone}` : ' · sem telefone'}</option>)}
            </select>
            {allFreelancers.length === 0 && <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>Nenhum freelancer cadastrado. Cadastre na aba Equipe.</div>}
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Tarefa de montagem (todas as reservas do dia)</label>
            <textarea value={montagemMsg} onChange={e => setMontagemMsg(e.target.value)} style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', minHeight: 220, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={sendMontagem} disabled={!montagemFr} style={{ flex: 1, background: '#25d36622', color: '#25d366', border: '1px solid #25d36644' }}>📲 Enviar pelo WhatsApp</Btn>
            <Btn onClick={() => setMontagemEv(null)} variant="ghost">Cancelar</Btn>
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
      <Modal open={!!frModal} title={`👷 Equipe — ${frModal?.name ?? ''}`} maxWidth={900} onClose={() => { setFrModal(null); setEvFreelancers([]); setFrModalArea(null) }}>
        {(() => {
          const roleOf = (ef: EventFreelancer) => (ef.role || ef.freelancers?.work_types?.[0] || 'outros')
          const groups: Record<string, EventFreelancer[]> = {}
          evFreelancers.forEach(ef => { const r = roleOf(ef); (groups[r] ||= []).push(ef) })
          const confirmed = evFreelancers.filter(ef => ef.confirmed).length
          const needs = frModal?.staffing_needs ?? {}
          return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: C.mut }}>Escale a equipe por área e defina o <strong style={{ color: C.sub }}>horário de entrada</strong> de cada um. Metas vêm de <strong style={{ color: C.sub }}>Produção › Equipe</strong>.</div>
                {evFreelancers.length > 0 && frModal && (
                  <button onClick={() => printEscala(frModal)} style={{ flexShrink: 0, background: '#ffffff08', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 12px', color: C.sub, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>🖨️ Escala / Ponto</button>
                )}
              </div>

              {/* Stats */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {[
                  { label: 'Escalados', val: evFreelancers.length, color: C.acc },
                  { label: 'Confirmados', val: confirmed, color: C.grn },
                  { label: 'Áreas', val: Object.keys(groups).length, color: C.gold },
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
                    <button onClick={() => setFrModalArea(role)} style={{ background: '#ffffff08', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '3px 8px', color: C.mut, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>+ Freelancer</button>
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
                      <button onClick={() => toggleEvFrConfirmed(ef)} title={ef.confirmed ? 'Confirmado' : 'Pendente'} style={{ background: ef.confirmed ? C.grn + '22' : '#ffffff08', border: `1px solid ${ef.confirmed ? C.grn + '44' : C.brd}`, borderRadius: 8, padding: '4px 8px', color: ef.confirmed ? C.grn : C.mut, fontSize: 12, cursor: 'pointer' }}>{ef.confirmed ? '✅' : '⏳'}</button>
                      <button onClick={() => removeEvFreelancer(ef.id)} title="Remover" style={{ background: 'none', border: `1px solid ${C.red}33`, borderRadius: 8, padding: '4px 8px', color: C.red, fontSize: 12, cursor: 'pointer' }}>🗑</button>
                    </div>
                  ))}
                </div>
              ))}

              {/* Escalar por área */}
              {!frModalArea ? (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 8 }}>➕ ESCALAR POR ÁREA</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {workAreas.map(a => {
                      const assigned = evFreelancers.filter(ef => roleOf(ef) === a.key).length
                      const need = needs[a.key] ?? 0
                      return (
                        <button key={a.key} onClick={() => setFrModalArea(a.key)} style={{ background: '#ffffff06', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 12px', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {a.icon} {a.label}{need ? <span style={{ color: assigned >= need ? '#10b981' : '#f59e0b', marginLeft: 4, fontWeight: 700 }}>{assigned}/{need}</span> : ''}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (() => {
                const available = allFreelancers.filter(f => !evFreelancers.some(ef => ef.freelancer_id === f.id && roleOf(ef) === frModalArea))
                const suggested = available.filter(f => (f.work_types ?? []).includes(frModalArea as never))
                const others = available.filter(f => !(f.work_types ?? []).includes(frModalArea as never))
                const ordered = [...suggested, ...others]
                return (
                  <div style={{ padding: '12px 14px', background: '#ffffff06', border: `1px solid ${C.acc}44`, borderRadius: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: C.acc, fontWeight: 700 }}>Escalar em {wlabel(frModalArea)}</span>
                      <button onClick={() => setFrModalArea(null)} style={{ background: 'none', border: 'none', color: C.mut, fontSize: 16, cursor: 'pointer' }}>✕</button>
                    </div>
                    {ordered.length === 0
                      ? <div style={{ fontSize: 12, color: C.mut, textAlign: 'center', padding: '8px 0' }}>{allFreelancers.length === 0 ? 'Nenhum freelancer cadastrado. Cadastre na aba Equipe.' : 'Todos já estão nesta área.'}</div>
                      : ordered.map(f => (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}22` }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.txt }}>{f.full_name} {(f.work_types ?? []).includes(frModalArea as never) && <span style={{ fontSize: 10, color: '#10b981' }}>• da função</span>}</div>
                            <div style={{ fontSize: 11, color: C.mut }}>{(f.work_types ?? []).map(wt => wlabel(wt)).join(' · ')}{f.daily_rate_cents ? ` · ${fmtCurrency(f.daily_rate_cents)}/dia` : ''}</div>
                          </div>
                          <button onClick={() => addEvFreelancer(f.id, frModalArea)} style={{ background: C.acc + '22', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '5px 12px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>➕ Add</button>
                        </div>
                      ))
                    }
                  </div>
                )
              })()}
            </div>
          )
        })()}
      </Modal>

      {/* Checklist do card — checagem das tarefas de produção */}
      <Modal open={!!checkEv} title={`📋 Checklist — ${checkEv?.name ?? ''}`} onClose={() => { setCheckEv(null); setCheckTasks([]) }}>
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
      <Modal open={!!ticketEv} title={`🎟️ Ingressos — ${ticketEv?.name ?? ''}`} onClose={() => { setTicketEv(null); setBatches([]) }}>
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
              <Btn onClick={() => setAddingBatch(true)} small>➕ Novo lote</Btn>
            </div>

            {addingBatch && (
              <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <input style={{ width: '100%', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }}
                      placeholder="Nome do lote (ex: 1º Lote)" value={batchForm.name} onChange={e => setBatchForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <select style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }}
                    value={batchForm.gender} onChange={e => setBatchForm(p => ({ ...p, gender: e.target.value }))}>
                    <option value="both">Misto</option>
                    <option value="male">Masculino</option>
                    <option value="female">Feminino</option>
                  </select>
                  <input type="number" step="0.01" min="0" style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }}
                    placeholder="Preço R$" value={batchForm.price_cents} onChange={e => setBatchForm(p => ({ ...p, price_cents: e.target.value }))} />
                  <input type="number" min="1" style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }}
                    placeholder="Qtd. ingressos" value={batchForm.quantity} onChange={e => setBatchForm(p => ({ ...p, quantity: e.target.value }))} />
                  <div style={{ gridColumn: '1 / -1' }}>
                    <input type="datetime-local" style={{ width: '100%', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const }}
                      placeholder="Prazo de venda (opcional)" value={batchForm.expires_at} onChange={e => setBatchForm(p => ({ ...p, expires_at: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn onClick={saveBatch} small>💾 Salvar</Btn>
                  <Btn onClick={() => setAddingBatch(false)} small variant="ghost">Cancelar</Btn>
                </div>
              </div>
            )}

            {batches.map(b => {
              const avail = Math.max(0, b.quantity - b.sold)
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brd}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{b.name}</div>
                    <div style={{ color: C.mut, fontSize: 11 }}>
                      {b.price_cents === 0 ? 'Grátis' : fmtCurrency(b.price_cents)} · {b.sold}/{b.quantity} vendidos · {avail} restantes
                    </div>
                  </div>
                  <Btn onClick={() => toggleBatch(b.id, b.active)} small variant={b.active ? 'secondary' : 'ghost'}>
                    {b.active ? '✅ Ativo' : '⏸ Inativo'}
                  </Btn>
                  <Btn onClick={() => deleteBatch(b.id)} small variant="danger">🗑</Btn>
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
                          <Btn onClick={() => confirmOrder(o.id, 'paid')} small style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44` }}>✅</Btn>
                          <Btn onClick={() => confirmOrder(o.id, 'cancelled')} small variant="danger">✕</Btn>
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
                <div style={{ display: 'flex', gap: 8 }}>
                  {onGoToReservas && <Btn onClick={() => { onGoToReservas(resViewEv.event_date, resViewEv.id); setResViewEv(null) }} small variant="secondary" style={cbtn('#94a3b8')}>✏️ Gerenciar</Btn>}
                  <Btn onClick={() => printResView(resViewEv)} small variant="secondary" style={cbtn('#3b82f6')}>🖨️ Imprimir (montagem)</Btn>
                  <Btn onClick={() => openMontagem(resViewEv)} small variant="secondary" style={cbtn('#f59e0b')}>📐 Enviar montagem</Btn>
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
                  ? <img src={flyerEv.flyer_url} alt="flyer" style={{ width: '100%', borderRadius: 10, marginBottom: 10, maxHeight: 280, objectFit: 'cover' }} />
                  : <div style={{ background: C.bg, border: `1px dashed ${C.brd}`, borderRadius: 10, padding: 20, textAlign: 'center', color: C.mut, fontSize: 13, marginBottom: 10 }}>Sem flyer cadastrado — será enviado só o texto.</div>}
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>Mensagem (use {'{{nome}}'} para o primeiro nome)</label>
                <textarea value={flyerMsg} onChange={e => setFlyerMsg(e.target.value)} style={{ width: '100%', minHeight: 150, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', marginTop: 4, boxSizing: 'border-box' }} />
                {flyerLink && <div style={{ fontSize: 11, color: C.mut, marginTop: 6, wordBreak: 'break-all' }}>🔗 Confirmação de presença: <span style={{ color: '#a78bfa' }}>{flyerLink}</span></div>}
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
      <Modal open={!!budgetEv} title={`💰 Budget — ${budgetEv?.name ?? ''}`} onClose={() => { setBudgetEv(null); setBudgetFreelancers([]); setBudgetPromoters([]); setBudgetResItems([]); setBudgetExpenses([]); setBudgetRes([]); setBudgetTasks([]) }} wide>
        {budgetEv && (() => {
          const ab = artistsBreakdown(budgetEv)
          const cache = ab.fee
          const consumacao = ab.cons
          const producao = budgetEv.production_cost_cents ?? 0
          const freelancerTotal = budgetFreelancers.reduce((s, ef) => s + ((ef as any).custom_fee_cents ?? ef.freelancers?.daily_rate_cents ?? 0), 0)
          const promoterTotal = budgetPromoters.reduce((s, l) => {
            const ent = Math.max(l.guest_count, l.min_entries)
            return s + l.fixed_fee_cents + ent * l.entry_fee_cents + ent * l.consumacao_cents
          }, 0)
          const resItemsTotal = budgetResItems.reduce((s, i) => s + (i.quantity || 1) * (i.unit_cost_cents || 0), 0)
          const expensesTotal = budgetExpenses.filter(e => e.kind !== 'revenue').reduce((s, e) => s + e.amount_cents, 0)
          const tasksEst = budgetTasks.reduce((s, t) => s + (t.estimated_cost_cents ?? 0), 0)
          const tasksReal = budgetTasks.reduce((s, t) => s + (t.actual_cost_cents ?? 0), 0)
          const tasksTotal = tasksReal > 0 ? tasksReal : tasksEst
          const total = cache + consumacao + producao + freelancerTotal + promoterTotal + resItemsTotal + expensesTotal + tasksTotal
          const reservasRevenue = budgetRes.reduce((s, r) => s + (r.amount_cents ?? 0), 0)
          const otherRevenue = budgetExpenses.filter(e => e.kind === 'revenue').reduce((s, e) => s + e.amount_cents, 0)
          const revenue = reservasRevenue + otherRevenue
          const margin = revenue - total
          const taskAreas: Record<string, { icon: string; tasks: EventTask[] }> = {}
          budgetTasks.forEach(t => { if (!taskAreas[t.area]) taskAreas[t.area] = { icon: t.area_icon, tasks: [] }; taskAreas[t.area].tasks.push(t) })

          const row = (icon: string, label: string, value: number, color: string, sub?: string) => (
            <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${C.brd}` }}>
              <div style={{ fontSize: 20, width: 34 }}>{icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.txt, fontSize: 14, fontWeight: 600 }}>{label}</div>
                {sub && <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>{sub}</div>}
              </div>
              <div style={{ color, fontWeight: 700, fontSize: 15 }}>{fmtCurrency(value)}</div>
            </div>
          )

          return (
            <div>
              {/* Resumo */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button onClick={() => printBudget(budgetEv)} style={{ background: '#ffffff08', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 12px', color: C.sub, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🖨️ Imprimir fechamento</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
                <div style={{ background: '#10b98110', border: '1px solid #10b98133', borderRadius: 10, padding: '10px 12px', textAlign: 'center', position: 'relative' }}>
                  <button onClick={() => { setRevAdding(true); setRevForm({ description: '', amount: '' }) }} title="Adicionar outra receita" style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 6, border: '1px solid #10b98144', background: '#10b98122', color: '#10b981', fontSize: 14, fontWeight: 900, cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                  <div style={{ fontSize: 10, color: '#10b981', fontWeight: 700, textTransform: 'uppercase' }}>Receita</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#10b981' }}>{fmtCurrency(revenue)}</div>
                  <div style={{ fontSize: 10, color: C.mut }}>{budgetRes.length} reservas{otherRevenue > 0 ? ` + extras` : ''}</div>
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

              {/* Receita: reservas + outras receitas */}
              {row('🪑', 'Receita de reservas', reservasRevenue, '#10b981', `${budgetRes.length} reservas do dia`)}
              {renderRevenues(budgetExpenses, budgetEv)}
              {/* Artistas */}
              {ab.list.length > 0
                ? ab.list.map((a, i) => (
                  <Fragment key={i}>{row('🎤', a.name || `Artista ${i + 1}`, (a.fee_cents ?? 0), C.gold, a.fee_type === 'percent' ? `${a.fee_percent}% da portaria${(a.fee_cents ?? 0) > 0 ? ` · mín. ${fmtCurrency(a.fee_cents ?? 0)}` : ''}` : (a.fee_type === 'tbd' ? 'A combinar' : undefined))}</Fragment>
                ))
                : row('🎤', 'Cachê do Artista', cache, C.gold)}

              {consumacao > 0 && row('🍺', 'Consumação (artistas)', consumacao, '#f59e0b')}
              {row('🔧', 'Gastos de Produção', producao, '#8b5cf6')}

              {/* Freelancers */}
              <div style={{ borderBottom: `1px solid ${C.brd}` }}>
                <div style={{ display: 'flex', alignItems: 'center', padding: '11px 0 6px' }}>
                  <div style={{ fontSize: 20, width: 34 }}>👷</div>
                  <div style={{ flex: 1, color: C.txt, fontSize: 14, fontWeight: 600 }}>Freelancers ({budgetFreelancers.length})</div>
                  <div style={{ color: C.acc, fontWeight: 700, fontSize: 15 }}>{fmtCurrency(freelancerTotal)}</div>
                </div>
                {budgetFreelancers.map(ef => (
                  <div key={ef.id} style={{ display: 'flex', alignItems: 'center', padding: '3px 0 3px 34px' }}>
                    <div style={{ flex: 1, color: C.mut, fontSize: 12 }}>
                      {ef.freelancers?.full_name}
                      {ef.freelancers?.work_types?.length ? ` · ${(ef.freelancers.work_types).map(w => wlabel(w)).join(', ')}` : ''}
                    </div>
                    <div style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}>{fmtCurrency(ef.freelancers?.daily_rate_cents ?? 0)}</div>
                  </div>
                ))}
              </div>

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
                  return (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '3px 0 3px 34px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: C.mut, fontSize: 12 }}>{(l.promoters as { full_name: string } | undefined)?.full_name ?? l.name}</div>
                        {sub && <div style={{ color: C.brd, fontSize: 11 }}>{sub} · {l.guest_count} convidados</div>}
                      </div>
                      <div style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}>{fmtCurrency(listTotal)}</div>
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
                    <div key={idx} style={{ display: 'flex', padding: '3px 0 3px 34px' }}>
                      <div style={{ flex: 1, color: C.mut, fontSize: 12 }}>
                        {i.quantity > 1 ? `${i.quantity}× ` : ''}{i.name}
                        {(i.reservations as { name: string } | undefined)?.name ? ` (${(i.reservations as { name: string }).name})` : ''}
                      </div>
                      <div style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}>{fmtCurrency((i.quantity || 1) * (i.unit_cost_cents || 0))}</div>
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
                    if (at === 0) return null
                    return (
                      <div key={area} style={{ display: 'flex', padding: '3px 0 3px 34px' }}>
                        <div style={{ flex: 1, color: C.mut, fontSize: 12 }}>{g.icon} {area}</div>
                        <div style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}>{fmtCurrency(at)}</div>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h1 style={{ color: C.txt, fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>🎉 Eventos</h1>
        <Btn onClick={openNew} icon="➕">Novo Evento</Btn>
      </div>

      {/* Próximos / Arquivo */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {([[false, `📅 Próximos (${upcomingEvents.length})`], [true, `📦 Arquivo (${pastEvents.length})`]] as const).map(([arch, label]) => (
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
        ? <Card><div style={{ color: C.mut, textAlign: 'center', padding: 40 }}>{selDate ? 'Nenhum evento nesta data' : showArchive ? 'Nenhum evento no arquivo' : 'Nenhum evento futuro cadastrado'}</div></Card>
        : showArchive
          /* ── ARQUIVO: cards compactos em lista ── */
          ? <Card style={{ padding: 0 }}>
              {filteredEvents.map((ev, idx) => (
                <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: idx < filteredEvents.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
                  {/* Thumb */}
                  {ev.flyer_url
                    ? <img src={ev.flyer_url} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0, border: `1px solid ${C.brd}` }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    : <div style={{ width: 40, height: 40, borderRadius: 6, background: C.card, border: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🎉</div>
                  }
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.name}</div>
                    <div style={{ color: C.mut, fontSize: 12, display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
                      <span>📅 {fd(ev.event_date)}</span>
                      {!!ev.checkinCount && <span style={{ color: C.grn }}>✓ {ev.checkinCount}</span>}
                      {!!ev.resCount && <span style={{ color: '#a78bfa' }}>🪑 {ev.resCount}</span>}
                      {!!((ev.resPeople ?? 0) + (ev.listGuests ?? 0)) && <span style={{ color: C.acc }}>👥 {(ev.resPeople ?? 0) + (ev.listGuests ?? 0)}</span>}
                    </div>
                  </div>
                  {/* Status + ações */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <Pill color={evStatusColor(ev.status ?? 'ativo')} small>{ev.status ?? 'ativo'}</Pill>
                    <Btn onClick={() => openEdit(ev)} small variant="ghost" title="Editar">✏️</Btn>
                    <Btn onClick={() => openBudget(ev)} small variant="secondary" style={cbtn('#10b981')} title="Budget">💰</Btn>
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
                    <img src={ev.flyer_url} alt={ev.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </div>
                )}
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <div style={{ color: C.txt, fontWeight: 700, fontSize: 15, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.name}</div>
                      <button onClick={() => openFlyer(ev)} title="Enviar flyer para contatos" style={{ flexShrink: 0, background: '#25d36622', border: '1px solid #25d36644', borderRadius: 7, padding: '3px 9px', color: '#25d366', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>📤 Flyer</button>
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
                {ev.genre && <div style={{ color: C.acc, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>🎵 {ev.genre}</div>}
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <Btn onClick={() => openEdit(ev)} small variant="secondary" style={cbtn('#94a3b8')}>✏️ Editar</Btn>
                  <Btn onClick={() => loadGuests(ev)} small variant="secondary" style={cbtn('#3b82f6')}>👥 Lista</Btn>
                  <Btn onClick={() => openResView(ev)} small variant="secondary" style={cbtn('#a78bfa')}>🪑 Reservas</Btn>
                  <Btn onClick={() => loadEvFreelancers(ev)} small variant="secondary" style={cbtn('#22d3ee')}>👷 Equipe</Btn>
                  <Btn onClick={() => openTickets(ev)} small variant="secondary" style={cbtn('#ec4899')}>🎟️ Ingressos</Btn>
                  <Btn onClick={() => openBudget(ev)} small variant="secondary" style={cbtn('#10b981')}>💰 Budget</Btn>
                  <Btn onClick={() => openProd(ev)} small variant="secondary" style={cbtn('#f59e0b')}>🏭 Produção</Btn>
                  <Btn onClick={() => cancelEv(ev)} small variant="secondary" style={cbtn(ev.status === 'cancelado' ? '#10b981' : '#ef4444')}>
                    {ev.status === 'cancelado' ? '✅ Reativar' : '❌ Cancelar'}
                  </Btn>
                </div>
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

      <FAB onClick={openNew} icon="➕" title="Novo evento" />
    </div>
  )
}
