import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal, FAB, Pill } from '../components/ui'
import { fd, fmtCurrency } from '../utils/format'
import { sT, _err, type ToastState } from '../utils/toast'
import type { House, Event, ArtistEntry, Freelancer, EventFreelancer, TicketBatch, TicketOrder } from '../types'

const WORK_LABELS: Record<string, string> = {
  limpeza: '🧹 Limpeza', cozinha: '👨‍🍳 Cozinha', servicos_gerais: '🔧 Serv. Gerais',
  garcom: '🍽️ Garçom', cumim: '🥄 Cumim', recepcao: '💁 Recepção', atendente: '🎟️ Atendente',
  seguranca: '🛡️ Segurança',
}

interface Props { house: House; onGoToReservas?: (date: string, eventId: string) => void }

interface EventWithCounts extends Event {
  checkinCount?: number
  resCount?: number
  resPeople?: number
  listGuests?: number
}

interface Guest {
  full_name: string
  phone?: string
  gender?: string
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
  amount_cents?: number; status: string
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
  promotions: '', repeat_rule: 'none', capacity: '', birthday_list_enabled: false,
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

  // Freelancers
  const [allFreelancers, setAllFreelancers] = useState<Freelancer[]>([])
  const [evFreelancers, setEvFreelancers] = useState<EventFreelancer[]>([])
  const [frModal, setFrModal] = useState<EventWithCounts | null>(null)

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
  const [prodTab, setProdTab] = useState<'tasks' | 'checklist' | 'freelancers' | 'budget' | 'layout'>('tasks')
  const [prodFr, setProdFr] = useState<EventFreelancer[]>([])
  const [teamArea, setTeamArea] = useState<string | null>(null)
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

  // Checklist (dentro do painel Produção)
  interface ChecklistItem { id: string; category: string; title: string; done: boolean; sort_order: number }
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [clForm, setClForm] = useState({ category: 'Equipe', title: '' })
  const CHECKLIST_CATS = ['Equipe','Som & Iluminação','Bebidas & Bar','Alimentação','Decoração','Artistas','Marketing','Documentos','Infraestrutura','Outros']

  // Reservations modal
  const [resEv, setResEv] = useState<EventWithCounts | null>(null)
  const [resList, setResList] = useState<ResItem[]>([])
  const [resAddOpen, setResAddOpen] = useState(false)
  const [resForm, setResForm] = useState(RDEF2)
  const [resEdit, setResEdit] = useState<string | null>(null)

  function st2(m: string, t?: string) { sT(setToast, m, t as 'success' | 'error' | 'warn') }

  async function openProd(ev: EventWithCounts) {
    setProdEv(ev); setProdTasks([]); setProdRes([]); setProdTab('tasks'); setProdFr([]); setChecklist([]); setTeamArea(null)
    const [tasksR, resR, frR, clR] = await Promise.all([
      supabase.from('event_tasks').select('*').eq('event_id', ev.id).order('area').order('sort_order'),
      supabase.from('reservations').select('*, reservation_items(name, quantity, unit_cost_cents)')
        .eq('house_id', house.id).eq('reservation_date', ev.event_date).neq('status', 'cancelled'),
      supabase.from('event_freelancers').select('*, freelancers(full_name, work_types, daily_rate_cents, phone)').eq('event_id', ev.id),
      supabase.from('event_checklist_items').select('*').eq('event_id', ev.id).order('category').order('sort_order'),
    ])
    setProdTasks((tasksR.data ?? []) as EventTask[])
    setProdRes((resR.data ?? []) as ProdReservation[])
    setProdFr((frR.data ?? []) as EventFreelancer[])
    setChecklist((clR.data ?? []) as ChecklistItem[])
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

  async function addClItem() {
    if (!clForm.title.trim() || !prodEv) return
    const maxOrder = checklist.filter(i => i.category === clForm.category).length
    const { data } = await supabase.from('event_checklist_items').insert({
      event_id: prodEv.id, house_id: house.id,
      category: clForm.category, title: clForm.title.trim(), sort_order: maxOrder,
    }).select().single()
    if (data) { setChecklist(p => [...p, data as ChecklistItem]); setClForm(p => ({ ...p, title: '' })) }
  }

  async function toggleClItem(id: string, done: boolean) {
    await supabase.from('event_checklist_items').update({ done }).eq('id', id)
    setChecklist(p => p.map(i => i.id === id ? { ...i, done } : i))
  }

  async function deleteClItem(id: string) {
    await supabase.from('event_checklist_items').delete().eq('id', id)
    setChecklist(p => p.filter(i => i.id !== id))
  }

  function printChecklist(ev: EventWithCounts) {
    const grouped: Record<string, ChecklistItem[]> = {}
    checklist.forEach(i => { if (!grouped[i.category]) grouped[i.category] = []; grouped[i.category].push(i) })
    const total = checklist.length
    const done = checklist.filter(i => i.done).length
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
      .footer { margin-top: 32px; font-size: 12px; color: #999; text-align: center; }
      @media print { body { padding: 16px; } }
    </style></head><body>
    <h1>📋 ${ev.name}</h1>
    <div class="sub">📅 ${new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} &nbsp;·&nbsp; ${done}/${total} itens concluídos</div>
    <div class="progress"><div class="progress-bar"></div></div>
    ${Object.entries(grouped).map(([cat, items]) => `
      <h2>${cat}</h2>
      ${items.map(i => `<div class="item"><div class="box ${i.done ? 'done' : ''}">${i.done ? '✓' : ''}</div><span class="label ${i.done ? 'done' : ''}">${i.title}</span></div>`).join('')}
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
      })
  }

  useEffect(() => { load() }, [house.id])

  useEffect(() => {
    supabase.from('freelancers').select('*').eq('house_id', house.id).eq('status', 'ativo').order('full_name')
      .then(r => setAllFreelancers((r.data ?? []) as Freelancer[]))
  }, [house.id])

  function loadEvFreelancers(ev: EventWithCounts) {
    setFrModal(ev)
    setEvFreelancers([])
    supabase.from('event_freelancers').select('*,freelancers(full_name,work_types,daily_rate_cents,phone)')
      .eq('event_id', ev.id)
      .then(r => setEvFreelancers((r.data ?? []) as EventFreelancer[]))
  }

  function openBudget(ev: EventWithCounts) {
    setBudgetEv(ev); setBudgetFreelancers([]); setBudgetPromoters([]); setBudgetResItems([])
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

  function loadGuests(ev: EventWithCounts) {
    setGuestEv(ev)
    setGuests([])
    setGuestFilter('all')
    supabase.from('promoter_list_guests').select('full_name,phone,gender,list_type,checked_in,promoter_id')
      .eq('event_id', ev.id).order('full_name')
      .then(r => setGuests((r.data ?? []) as Guest[]))
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

  function save() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { checkinCount, resCount, id, created_at, artist_fee_cents, artist_fee_type, artist_fee_percent, consumption_cents: _cc, ...formRest } = form as Record<string, unknown>
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

  function openRes(ev: EventWithCounts) {
    setResEv(ev)
    supabase.from('reservations').select('*').eq('event_id', ev.id).order('expected_arrival')
      .then(r => setResList((r.data ?? []) as ResItem[]))
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

  const renderProdTabs = () => (
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {(['tasks', 'checklist', 'freelancers', 'budget'] as const).map(tab => {
                  const clDone = checklist.filter(i => i.done).length
                  const labels = { tasks: '📋 Tarefas', checklist: `✅ Checklist${checklist.length ? ` (${clDone}/${checklist.length})` : ''}`, freelancers: `👥 Equipe (${prodFr.length})`, budget: '💰 Budget' }
                  return (
                    <button key={tab} onClick={() => setProdTab(tab)} style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${prodTab === tab ? '#f59e0b' : C.brd}`, background: prodTab === tab ? '#f59e0b22' : 'transparent', color: prodTab === tab ? '#f59e0b' : C.mut, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {labels[tab]}
                    </button>
                  )
                })}
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
                                {(r.reservation_items ?? []).map((item, i) => (
                                  <span key={i} style={{ display: 'inline-block', background: '#a78bfa22', color: '#a78bfa', border: '1px solid #a78bfa33', borderRadius: 6, padding: '1px 8px', fontSize: 11, marginRight: 4, marginBottom: 2 }}>
                                    {item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}
                                  </span>
                                ))}
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

              {/* ── TAB: CHECKLIST ── */}
              {prodTab === 'checklist' && (() => {
                const grouped: Record<string, ChecklistItem[]> = {}
                checklist.forEach(i => { if (!grouped[i.category]) grouped[i.category] = []; grouped[i.category].push(i) })
                const done = checklist.filter(i => i.done).length
                const pct = checklist.length ? Math.round(done / checklist.length * 100) : 0
                return (
                  <div>
                    {/* Add item */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                      <select value={clForm.category} onChange={e => setClForm(p => ({ ...p, category: e.target.value }))}
                        style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit', flexShrink: 0 }}>
                        {CHECKLIST_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input value={clForm.title} onChange={e => setClForm(p => ({ ...p, title: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && addClItem()}
                        placeholder="Adicionar item... (Enter)"
                        style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }} />
                      <button onClick={addClItem}
                        style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#1a1205', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>➕</button>
                    </div>

                    {/* Progress + print */}
                    {checklist.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                        <div style={{ flex: 1, height: 6, background: C.brd, borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#10b981' : '#f59e0b', borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 11, color: C.mut, fontWeight: 600 }}>{done}/{checklist.length}</span>
                        <button onClick={() => prodEv && printChecklist(prodEv)} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.brd}`, background: 'transparent', color: C.sub, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>🖨️ Imprimir</button>
                      </div>
                    )}

                    {/* Items grouped by category */}
                    {checklist.length === 0
                      ? <div style={{ color: C.mut, textAlign: 'center', padding: '40px 0', fontSize: 13 }}>Nenhum item ainda. Use o campo acima para montar a checklist do evento.</div>
                      : Object.entries(grouped).map(([cat, items]) => (
                        <div key={cat} style={{ marginBottom: 16 }}>
                          <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${C.brd}` }}>
                            {cat} <span style={{ color: C.brd, fontWeight: 400 }}>({items.filter(i => i.done).length}/{items.length})</span>
                          </div>
                          {items.map(item => (
                            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${C.brd}22` }}>
                              <button onClick={() => toggleClItem(item.id, !item.done)}
                                style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${item.done ? '#10b981' : C.brd}`, background: item.done ? '#10b981' : 'transparent', color: '#fff', fontSize: 13, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {item.done ? '✓' : ''}
                              </button>
                              <span style={{ flex: 1, color: item.done ? C.mut : C.txt, fontSize: 14, textDecoration: item.done ? 'line-through' : 'none' }}>{item.title}</span>
                              <button onClick={() => deleteClItem(item.id)}
                                style={{ background: 'none', border: 'none', color: C.mut, fontSize: 16, cursor: 'pointer', padding: '2px 6px', opacity: 0.5 }}>✕</button>
                            </div>
                          ))}
                        </div>
                      ))
                    }
                  </div>
                )
              })()}

              {/* ── TAB: EQUIPE (por área → freelancer) ── */}
              {prodTab === 'freelancers' && (() => {
                const roleOf = (fr: EventFreelancer) => (fr.role || (fr as any).freelancers?.work_types?.[0] || 'outros')
                const roleLabel = (r: string) => WORK_LABELS[r] ?? r
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
                          <div style={{ fontSize: 11, color: C.mut, marginTop: 2 }}>{(frData?.work_types ?? []).map((wt: string) => WORK_LABELS[wt] ?? wt).join(' · ')}</div>
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
                          {Object.entries(WORK_LABELS).map(([k, label]) => (
                            <button key={k} onClick={() => setTeamArea(k)} style={{ background: '#ffffff06', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 12px', color: C.sub, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
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
                                    {(f.work_types ?? []).map(wt => WORK_LABELS[wt] ?? wt).join(' · ')}
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

              {/* ── TAB: BUDGET ── */}
              {prodTab === 'budget' && (() => {
                const totalRevenue = prodRes.reduce((s, r) => s + (r.amount_cents ?? 0), 0)
                const tasksEstimated = prodTasks.reduce((s, t) => s + (t.estimated_cost_cents ?? 0), 0)
                const tasksActual = prodTasks.reduce((s, t) => s + (t.actual_cost_cents ?? 0), 0)
                const frTotal = prodFr.reduce((s, f) => s + ((f as any).custom_fee_cents ?? (f as any).freelancers?.daily_rate_cents ?? 0), 0)
                const totalCostEst = tasksEstimated + frTotal
                const totalCostReal = tasksActual + frTotal
                const marginEst = totalRevenue - totalCostEst
                const marginReal = totalRevenue - totalCostReal
                const areas: Record<string, { icon: string; tasks: EventTask[] }> = {}
                prodTasks.forEach(t => { if (!areas[t.area]) areas[t.area] = { icon: t.area_icon, tasks: [] }; areas[t.area].tasks.push(t) })

                return (
                  <div>
                    {/* Summary cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                      <div style={{ background: '#10b98110', border: '1px solid #10b98133', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: '#10b981', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Receita</div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: '#10b981' }}>R$ {(totalRevenue / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                        <div style={{ fontSize: 11, color: C.mut }}>{prodRes.length} reservas</div>
                      </div>
                      <div style={{ background: '#f59e0b10', border: '1px solid #f59e0b33', borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Despesas Estimadas</div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: '#f59e0b' }}>R$ {(totalCostEst / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                        <div style={{ fontSize: 11, color: C.mut }}>{prodTasks.length} tarefas + {prodFr.length} freelancers</div>
                      </div>
                      <div style={{ background: marginEst >= 0 ? '#10b98110' : '#f8717110', border: `1px solid ${marginEst >= 0 ? '#10b98133' : '#f8717133'}`, borderRadius: 10, padding: '12px 14px' }}>
                        <div style={{ fontSize: 10, color: marginEst >= 0 ? '#10b981' : '#f87171', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Margem Estimada</div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: marginEst >= 0 ? '#10b981' : '#f87171' }}>R$ {(marginEst / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                      </div>
                      {tasksActual > 0 && (
                        <div style={{ background: marginReal >= 0 ? '#3b82f610' : '#f8717110', border: `1px solid ${marginReal >= 0 ? '#3b82f633' : '#f8717133'}`, borderRadius: 10, padding: '12px 14px' }}>
                          <div style={{ fontSize: 10, color: marginReal >= 0 ? '#3b82f6' : '#f87171', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>Margem Real</div>
                          <div style={{ fontSize: 20, fontWeight: 900, color: marginReal >= 0 ? '#3b82f6' : '#f87171' }}>R$ {(marginReal / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                          <div style={{ fontSize: 11, color: C.mut }}>Custo real: R$ {(totalCostReal / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                        </div>
                      )}
                    </div>

                    {/* Receita breakdown */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>📥 Receita — Reservas</div>
                      {prodRes.length === 0
                        ? <div style={{ color: C.mut, fontSize: 12 }}>Nenhuma reserva para este evento.</div>
                        : prodRes.map(r => (
                          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.brd}22`, fontSize: 13 }}>
                            <span style={{ color: C.txt }}>{r.name}{r.location ? ` · ${r.location}` : ''}</span>
                            <span style={{ color: '#10b981', fontWeight: 600 }}>R$ {((r.amount_cents ?? 0) / 100).toFixed(2)}</span>
                          </div>
                        ))
                      }
                    </div>

                    {/* Despesas breakdown */}
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>📤 Despesas</div>
                      {/* Freelancers */}
                      {prodFr.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 11, color: C.mut, marginBottom: 4 }}>👷 Freelancers</div>
                          {prodFr.map(fr => {
                            const frData = (fr as any).freelancers
                            const fee = (fr as any).custom_fee_cents ?? frData?.daily_rate_cents ?? 0
                            return (
                              <div key={fr.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${C.brd}22`, fontSize: 13 }}>
                                <span style={{ color: C.txt }}>{frData?.full_name ?? '—'}</span>
                                <span style={{ color: '#f59e0b' }}>R$ {(fee / 100).toFixed(2)}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {/* Tasks by area */}
                      {Object.entries(areas).map(([area, { icon, tasks }]) => {
                        const areaEst = tasks.reduce((s, t) => s + (t.estimated_cost_cents ?? 0), 0)
                        const areaReal = tasks.reduce((s, t) => s + (t.actual_cost_cents ?? 0), 0)
                        if (areaEst === 0 && areaReal === 0) return null
                        return (
                          <div key={area} style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 11, color: C.mut, marginBottom: 4 }}>{icon} {area}</div>
                            {tasks.filter(t => t.estimated_cost_cents || t.actual_cost_cents).map(t => (
                              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${C.brd}22`, fontSize: 13 }}>
                                <span style={{ color: t.status === 'done' ? C.mut : C.txt }}>{t.title}</span>
                                <div style={{ textAlign: 'right' }}>
                                  {t.actual_cost_cents ? <span style={{ color: '#10b981', fontWeight: 700 }}>R$ {(t.actual_cost_cents / 100).toFixed(2)}</span> : <span style={{ color: '#f59e0b' }}>R$ {((t.estimated_cost_cents ?? 0) / 100).toFixed(2)}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
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
          {/* Body: always 65/35 split */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT: event form (65%) */}
        <div style={{ flex: '0 0 65%', overflowY: 'auto', padding: '20px 28px', borderRight: `1px solid ${C.brd}` }}>
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
                <input type="number" step="0.01" {...inp} value={String(form.price_male_cents ?? 0)} onChange={e => setF('price_male_cents', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Cover Fem (R$)</label>
                <input type="number" step="0.01" {...inp} value={String(form.price_female_cents ?? 0)} onChange={e => setF('price_female_cents', e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Lista Masc (R$)</label>
                <input type="number" step="0.01" {...inp} value={String(form.price_male_list_cents ?? 0)} onChange={e => setF('price_male_list_cents', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Lista Fem (R$)</label>
                <input type="number" step="0.01" {...inp} value={String(form.price_female_list_cents ?? 0)} onChange={e => setF('price_female_list_cents', e.target.value)} />
              </div>
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
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🔧 Produção (R$)</label>
              <input type="number" step="0.01" min="0" {...inp} value={String(form.production_cost_cents ?? 0)} onChange={e => setF('production_cost_cents', e.target.value)} placeholder="0,00" />
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
                <input type="number" step="0.01" min="0" {...inp} value={ar.fee_cents} onChange={e => setArtist(i, { fee_cents: parseFloat(e.target.value) || 0 })} placeholder="R$ 0,00" />
              )}
              {ar.fee_type === 'percent' && (
                <input type="number" step="1" min="0" max="100" {...inp} value={ar.fee_percent} onChange={e => setArtist(i, { fee_percent: parseFloat(e.target.value) || 0 })} placeholder="%" />
              )}
              {ar.fee_type === 'mixed' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <input type="number" step="0.01" min="0" {...inp} value={ar.fee_cents} onChange={e => setArtist(i, { fee_cents: parseFloat(e.target.value) || 0 })} placeholder="R$ fixo" />
                  <input type="number" step="1" min="0" max="100" {...inp} value={ar.fee_percent} onChange={e => setArtist(i, { fee_percent: parseFloat(e.target.value) || 0 })} placeholder="%" />
                </div>
              )}
              {ar.fee_type === 'tbd' && (
                <div style={{ ...inp.style, display: 'flex', alignItems: 'center', color: C.gold, fontSize: 11 }}>A combinar</div>
              )}
              {/* Consumação */}
              <input type="number" step="0.01" min="0" {...inp} value={ar.consumption_cents} onChange={e => setArtist(i, { consumption_cents: parseFloat(e.target.value) || 0 })} placeholder="R$" />
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

        {/* RIGHT: production panel (35%) — MESMO painel inline (renderProdTabs/renderProdBody) */}
        <div style={{ flex: '0 0 35%', overflowY: 'hidden', padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
          {!editing
            ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, color: C.mut }}>
                <div style={{ fontSize: 32 }}>🏭</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>Produção</div>
                <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 220 }}>Salve o evento para liberar o painel de Produção (tarefas, checklist, equipe e budget).</div>
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

      {/* Guest list modal */}
      <Modal open={!!guestEv} title={`👥 Lista — ${guestEv?.name ?? ''}`} onClose={() => { setGuestEv(null); setGuests([]) }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          {['all', 'present', 'pending'].map(f => (
            <Btn key={f} onClick={() => setGuestFilter(f)} variant={guestFilter === f ? 'primary' : 'ghost'} small>
              {f === 'all' ? `Todos (${guests.length})` : f === 'present' ? `✅ Presentes (${guests.filter(g => g.checked_in).length})` : `⏳ Pendentes (${guests.filter(g => !g.checked_in).length})`}
            </Btn>
          ))}
          <Btn onClick={doExport} small variant="secondary">📥 CSV</Btn>
        </div>
        {guests.length === 0
          ? <div style={{ color: C.mut, textAlign: 'center', padding: 24 }}>Nenhum convidado na lista</div>
          : guests.filter(g => guestFilter === 'all' ? true : guestFilter === 'present' ? g.checked_in : !g.checked_in).map((g, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}` }}>
              <span style={{ color: g.checked_in ? C.grn : C.txt, fontSize: 13, flex: 1, fontWeight: g.checked_in ? 700 : 400 }}>{g.full_name}</span>
              <span style={{ color: C.mut, fontSize: 12, width: 20, textAlign: 'center' }}>{g.gender === 'M' ? '♂' : g.gender === 'F' ? '♀' : ''}</span>
              {g.phone && <span style={{ color: C.mut, fontSize: 12 }}>{g.phone}</span>}
              <span style={{ color: g.checked_in ? C.grn : C.mut, fontSize: 13, width: 20, textAlign: 'center' }}>{g.checked_in ? '✓' : '—'}</span>
            </div>
          ))
        }
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
      <Modal open={!!frModal} title={`👷 Equipe — ${frModal?.name ?? ''}`} onClose={() => { setFrModal(null); setEvFreelancers([]) }}>
        <div style={{ fontSize: 12, color: C.mut, marginBottom: 14 }}>Visualização da equipe de trabalho escalada para o evento.</div>
        {evFreelancers.length === 0
          ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: 24 }}>Nenhum profissional escalado para este evento.</div>
          : (() => {
              const roleOf = (ef: EventFreelancer) => (ef.role || ef.freelancers?.work_types?.[0] || 'outros')
              const groups: Record<string, EventFreelancer[]> = {}
              evFreelancers.forEach(ef => { const r = roleOf(ef); (groups[r] ||= []).push(ef) })
              const confirmed = evFreelancers.filter(ef => ef.confirmed).length
              return (
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    {[
                      { label: 'Profissionais', val: evFreelancers.length, color: C.acc },
                      { label: 'Confirmados', val: confirmed, color: C.grn },
                      { label: 'Áreas', val: Object.keys(groups).length, color: C.gold },
                    ].map((b, i) => (
                      <div key={i} style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: b.color }}>{b.val}</div>
                        <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>{b.label}</div>
                      </div>
                    ))}
                  </div>
                  {Object.entries(groups).map(([role, members]) => (
                    <div key={role} style={{ marginBottom: 14 }}>
                      <div style={{ color: C.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${C.brd}` }}>
                        {WORK_LABELS[role] ?? role} <span style={{ color: C.brd, fontWeight: 400 }}>({members.length})</span>
                      </div>
                      {members.map(ef => (
                        <div key={ef.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}22` }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: C.txt, fontSize: 13, fontWeight: 600 }}>{ef.freelancers?.full_name ?? '—'}</div>
                            <div style={{ color: C.mut, fontSize: 11 }}>{(ef.freelancers?.work_types ?? []).map(wt => WORK_LABELS[wt] ?? wt).join(' · ')}</div>
                          </div>
                          <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 8, background: ef.confirmed ? C.grn + '22' : C.gold + '22', color: ef.confirmed ? C.grn : C.gold, fontWeight: 700 }}>
                            {ef.confirmed ? '✅ Confirmado' : '⏳ Pendente'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div style={{ fontSize: 11, color: C.mut, marginTop: 8, paddingTop: 10, borderTop: `1px solid ${C.brd}` }}>Para escalar a equipe, definir valores e custos, use <strong style={{ color: C.sub }}>Produção › Equipe</strong>.</div>
                </div>
              )
            })()
        }
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

      {/* Budget modal */}
      <Modal open={!!budgetEv} title={`💰 Budget — ${budgetEv?.name ?? ''}`} onClose={() => { setBudgetEv(null); setBudgetFreelancers([]); setBudgetPromoters([]); setBudgetResItems([]) }} wide>
        {budgetEv && (() => {
          const cache = budgetEv.artist_fee_cents ?? 0
          const consumacao = budgetEv.consumption_cents ?? 0
          const producao = budgetEv.production_cost_cents ?? 0
          const freelancerTotal = budgetFreelancers.reduce((s, ef) => s + (ef.freelancers?.daily_rate_cents ?? 0), 0)
          const promoterTotal = budgetPromoters.reduce((s, l) => {
            const ent = Math.max(l.guest_count, l.min_entries)
            return s + l.fixed_fee_cents + ent * l.entry_fee_cents + ent * l.consumacao_cents
          }, 0)
          const resItemsTotal = budgetResItems.reduce((s, i) => s + (i.quantity || 1) * (i.unit_cost_cents || 0), 0)
          const total = cache + consumacao + producao + freelancerTotal + promoterTotal + resItemsTotal

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
              {/* Artista */}
              {(budgetEv as any)?.artist_fee_type === 'percent'
                ? row('🎤', `Cachê Variável — ${(budgetEv as any).artist_fee_percent}% da portaria`, cache, C.gold, cache > 0 ? `Mínimo garantido: ${fmtCurrency(cache)}` : 'A calcular após o evento')
                : (budgetEv as any)?.artist_fee_type === 'tbd'
                  ? row('🎤', 'Cachê — A combinar', 0, C.gold, 'Valor não definido')
                  : row('🎤', 'Cachê do Artista', cache, C.gold)}

              {row('🍺', 'Consumação', consumacao, '#f59e0b')}
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
                      {ef.freelancers?.work_types?.length ? ` · ${(ef.freelancers.work_types).map(w => WORK_LABELS[w] ?? w).join(', ')}` : ''}
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

              {/* Total */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '16px 0 4px', background: `linear-gradient(135deg,${C.grn}08,transparent)`, borderRadius: 8, marginTop: 4 }}>
                <div style={{ fontSize: 22, width: 34 }}>💰</div>
                <div style={{ flex: 1, color: C.txt, fontSize: 16, fontWeight: 900 }}>TOTAL DO EVENTO</div>
                <div style={{ color: C.grn, fontWeight: 900, fontSize: 22 }}>{fmtCurrency(total)}</div>
              </div>
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

      {/* Event cards — full width */}
      {filteredEvents.length === 0
        ? <Card><div style={{ color: C.mut, textAlign: 'center', padding: 40 }}>{selDate ? 'Nenhum evento nesta data' : showArchive ? 'Nenhum evento no arquivo' : 'Nenhum evento futuro cadastrado'}</div></Card>
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
                  <div style={{ color: C.txt, fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{ev.name}</div>
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
              {/* Botões — 2 linhas organizadas */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                <Btn onClick={() => openEdit(ev)} small variant="ghost" style={{ justifyContent: 'center' }}>✏️ Editar</Btn>
                <Btn onClick={() => loadGuests(ev)} small variant="secondary" style={{ justifyContent: 'center' }}>👥 Lista</Btn>
                <Btn onClick={() => onGoToReservas ? onGoToReservas(ev.event_date, ev.id) : openRes(ev)} small variant="secondary" style={{ justifyContent: 'center' }}>🪑 Reservas</Btn>
                <Btn onClick={() => loadEvFreelancers(ev)} small variant="secondary" style={{ justifyContent: 'center' }}>👷 Equipe</Btn>
                <Btn onClick={() => openTickets(ev)} small style={{ background: C.acc + '22', color: C.acc, border: `1px solid ${C.acc}44`, justifyContent: 'center' }}>🎟️ Ingressos</Btn>
                <Btn onClick={() => openBudget(ev)} small style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44`, justifyContent: 'center' }}>💰 Budget</Btn>
                <Btn onClick={() => openProd(ev)} small style={{ background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44', justifyContent: 'center' }}>🏭 Produção</Btn>
                <Btn onClick={() => cancelEv(ev)} small variant={ev.status === 'cancelado' ? 'secondary' : 'danger'} style={{ justifyContent: 'center' }}>
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
