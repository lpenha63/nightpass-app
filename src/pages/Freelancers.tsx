import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { viradaDa, diaOperacionalStr } from '../utils/diaOperacional'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal, Pill } from '../components/ui'
import { fmtCurrency, cn } from '../utils/format'
import { preencher, paraHtmlImpressao, type DocTemplate, type DocAssinado } from '../utils/documentos'
import { sT, type ToastState } from '../utils/toast'
import { sendWADirect } from '../utils/whatsapp'
import { useIsMobile } from '../hooks/useIsMobile'
import type { House, Freelancer } from '../types'
import { DEFAULT_AREAS, AREA_ICON_OPTIONS, AREA_COLOR_OPTIONS, slugifyArea, areaMeta, type WorkArea } from '../constants/areas'

interface Props { house: House; onRatingsChanged?: () => void }

interface PendingEvent { id: string; name: string; event_date: string; flyer_url?: string; total: number; rated: number }
interface Criterion { id?: string; key: string; label: string }
const DEFAULT_CRITERIA: Criterion[] = [
  { key: 'agilidade', label: '⚡ Agilidade' },
  { key: 'atencao', label: '👁 Atenção' },
  { key: 'organizacao', label: '📦 Organização' },
  { key: 'atendimento', label: '😊 Atendimento' },
]
interface RatingEntry { freelancer_id: string; full_name: string; role: string; rating: number; comment: string; existing_id?: string; criteria?: Record<string, number> }

const WEEK_DAYS = [
  { key: 'seg', label: 'Seg' }, { key: 'ter', label: 'Ter' }, { key: 'qua', label: 'Qua' },
  { key: 'qui', label: 'Qui' }, { key: 'sex', label: 'Sex' }, { key: 'sab', label: 'Sáb' }, { key: 'dom', label: 'Dom' },
]

const DEF = {
  full_name: '', address: '', phone: '', pix_key: '',
  daily_rate_cents: '', hourly_rate_cents: '', work_types: [] as string[], notes: '', status: 'ativo', staff_type: 'freelancer',
  cpf: '',
  shift_hours: '' as '' | '8' | '12',
  work_entry: '', work_break: '', work_exit: '',
  work_days: [] as string[],
}

const AREA_FORM_DEF = { id: '', label: '', icon: '📋', color: '#60a5fa' }

export function FreelancersPage({ house, onRatingsChanged }: Props) {
  const isMobile = useIsMobile()
  const [freelancers, setFreelancers] = useState<Freelancer[]>([])
  const [areas, setAreas] = useState<WorkArea[]>(DEFAULT_AREAS)
  const [ratings, setRatings] = useState<Record<string, { avg: number; count: number }>>({})
  const [tab, setTab] = useState<'equipe' | 'avaliacoes'>('equipe')

  // Quesitos de avaliação personalizáveis por casa
  const [criteria, setCriteria] = useState<Criterion[]>(DEFAULT_CRITERIA)
  const [critModal, setCritModal] = useState(false)
  const [critForm, setCritForm] = useState<Criterion & { id: string }>({ id: '', key: '', label: '' })

  async function loadCriteria() {
    const { data } = await supabase.from('rating_criteria').select('id,key,label').eq('house_id', house.id).eq('active', true).order('sort_order').order('label')
    if (!data || data.length === 0) {
      // Semeia os defaults na primeira vez
      const rows = DEFAULT_CRITERIA.map((c, i) => ({ house_id: house.id, key: c.key, label: c.label, sort_order: i, active: true }))
      await supabase.from('rating_criteria').insert(rows)
      const { data: d2 } = await supabase.from('rating_criteria').select('id,key,label').eq('house_id', house.id).eq('active', true).order('sort_order').order('label')
      setCriteria((d2 && d2.length ? d2 : DEFAULT_CRITERIA) as Criterion[])
    } else {
      setCriteria(data as Criterion[])
    }
  }

  async function saveCriterion() {
    if (!critForm.label.trim()) { st2('Nome do quesito obrigatório', 'warn'); return }
    if (critForm.id) {
      const { error } = await supabase.from('rating_criteria').update({ label: critForm.label.trim() }).eq('id', critForm.id)
      if (error) { st2('Erro: ' + error.message, 'error'); return }
    } else {
      let key = critForm.label.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      if (!key) key = 'q'
      if (criteria.some(c => c.key === key)) key = key + '_' + Math.random().toString(36).slice(2, 5)
      const { error } = await supabase.from('rating_criteria').insert({ house_id: house.id, key, label: critForm.label.trim(), sort_order: criteria.length, active: true })
      if (error) { st2('Erro: ' + error.message, 'error'); return }
    }
    setCritForm({ id: '', key: '', label: '' })
    loadCriteria()
  }

  async function delCriterion(c: Criterion) {
    if (criteria.length <= 1) { st2('Mantenha ao menos 1 quesito', 'warn'); return }
    if (!confirm(`Remover o quesito "${c.label}"?`)) return
    if (c.id) await supabase.from('rating_criteria').delete().eq('id', c.id)
    loadCriteria()
  }

  // Avaliações pendentes
  const [pending, setPending] = useState<PendingEvent[]>([])
  const [ratingEv, setRatingEv] = useState<PendingEvent | null>(null)
  const [ratingEntries, setRatingEntries] = useState<RatingEntry[]>([])
  const [ratingSaving, setRatingSaving] = useState(false)

  async function loadPending() {
    const today = new Date().toISOString().slice(0, 10)
    const { data: evs } = await supabase.from('events').select('id,name,event_date,flyer_url')
      .eq('house_id', house.id).lt('event_date', today).order('event_date', { ascending: false })
    const ids = (evs ?? []).map(e => e.id)
    if (ids.length === 0) { setPending([]); return }
    const { data: efs } = await supabase.from('event_freelancers').select('event_id,freelancer_id').in('event_id', ids)
    const { data: rts } = await supabase.from('team_ratings').select('event_id,freelancer_id').in('event_id', ids)
    const ratedSet = new Set((rts ?? []).map(r => `${r.event_id}:${r.freelancer_id}`))
    const byEvent: Record<string, { total: number; rated: number }> = {}
    for (const ef of efs ?? []) {
      if (!byEvent[ef.event_id]) byEvent[ef.event_id] = { total: 0, rated: 0 }
      byEvent[ef.event_id].total++
      if (ratedSet.has(`${ef.event_id}:${ef.freelancer_id}`)) byEvent[ef.event_id].rated++
    }
    const result: PendingEvent[] = []
    for (const e of evs ?? []) {
      const c = byEvent[e.id]
      if (c && c.rated < c.total) result.push({ ...e, total: c.total, rated: c.rated })
    }
    setPending(result)
  }

  async function openRating(ev: PendingEvent) {
    setRatingEv(ev)
    const { data: efs } = await supabase.from('event_freelancers')
      .select('freelancer_id, role, freelancers(full_name)').eq('event_id', ev.id)
    const { data: existing } = await supabase.from('team_ratings')
      .select('id, freelancer_id, rating, comment').eq('event_id', ev.id)
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
    const toSave = ratingEntries.filter(e => {
      const criteriaFilled = criteria.some(c => (e.criteria?.[c.key] ?? 0) > 0)
      return e.rating > 0 || criteriaFilled
    })
    for (const e of toSave) {
      // Média dos quesitos se preenchidos, senão usa rating geral
      const criteriaFilled = criteria.some(c => (e.criteria?.[c.key] ?? 0) > 0)
      const finalRating = criteriaFilled
        ? Math.round(criteria.reduce((s, c) => s + (e.criteria?.[c.key] ?? 0), 0) / criteria.length)
        : e.rating
      const criteriaJson = criteriaFilled ? e.criteria : null
      if (e.existing_id) {
        await supabase.from('team_ratings').update({ rating: finalRating, comment: e.comment, criteria: criteriaJson }).eq('id', e.existing_id)
      } else {
        await supabase.from('team_ratings').insert({ house_id: house.id, event_id: ratingEv.id, freelancer_id: e.freelancer_id, rating: finalRating, comment: e.comment || null, criteria: criteriaJson })
      }
    }
    setRatingSaving(false)
    st2(`✅ ${toSave.length} avaliação(ões) salvas!`)
    setRatingEv(null)
    loadPending(); loadRatings(); onRatingsChanged?.()
  }

  async function loadRatings() {
    const { data } = await supabase.from('team_ratings').select('freelancer_id,rating').eq('house_id', house.id)
    const map: Record<string, { sum: number; count: number }> = {}
    for (const r of data ?? []) {
      if (r.rating <= 0) continue // ignora encerrados sem avaliação
      if (!map[r.freelancer_id]) map[r.freelancer_id] = { sum: 0, count: 0 }
      map[r.freelancer_id].sum += r.rating
      map[r.freelancer_id].count += 1
    }
    const result: Record<string, { avg: number; count: number }> = {}
    for (const [id, v] of Object.entries(map)) result[id] = { avg: v.sum / v.count, count: v.count }
    setRatings(result)
  }
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<typeof DEF>({ ...DEF })
  const [editing, setEditing] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [ldg, setLdg] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [staffFilter, setStaffFilter] = useState<'all' | 'freelancer' | 'funcionario'>('all')

  // Admin de áreas
  const [areasModal, setAreasModal] = useState(false)
  const [areaForm, setAreaForm] = useState({ ...AREA_FORM_DEF })

  function st2(m: string, t?: string) { sT(setToast, m, t as 'success' | 'error' | 'warn') }

  async function loadAreas() {
    const { data } = await supabase.from('work_areas').select('*').eq('house_id', house.id).order('sort_order').order('label')
    if (!data || data.length === 0) {
      const rows = DEFAULT_AREAS.map((a, i) => ({ house_id: house.id, key: a.key, label: a.label, icon: a.icon, color: a.color, sort_order: i, active: true }))
      await supabase.from('work_areas').insert(rows)
      const { data: d2 } = await supabase.from('work_areas').select('*').eq('house_id', house.id).order('sort_order').order('label')
      setAreas((d2 ?? DEFAULT_AREAS) as WorkArea[])
    } else {
      setAreas(data as WorkArea[])
    }
  }

  function load() {
    if (!house) return
    supabase.from('freelancers').select('*').eq('house_id', house.id).order('full_name')
      .then(r => {
        setLdg(false)
        if (r.error) st2('Erro: ' + r.error.message, 'error')
        else setFreelancers(r.data as Freelancer[])
      })
  }

  useEffect(() => { load(); loadAreas(); loadRatings(); loadPending(); loadCriteria() }, [house.id])

  function openNew() { setEditing(null); setForm({ ...DEF }); setModal(true) }

  function openEdit(fr: Freelancer) {
    setEditing(fr.id)
    const meta = (fr as any).work_meta ?? {}
    setForm({
      full_name: fr.full_name,
      address: fr.address ?? '',
      phone: fr.phone ?? '',
      pix_key: fr.pix_key ?? '',
      daily_rate_cents: fr.daily_rate_cents ? String(fr.daily_rate_cents / 100) : '',
      hourly_rate_cents: fr.hourly_rate_cents ? String(fr.hourly_rate_cents / 100) : '',
      work_types: (fr.work_types ?? []) as string[],
      notes: fr.notes ?? '',
      status: fr.status,
      staff_type: fr.staff_type ?? 'freelancer',
      cpf: (fr as { cpf?: string }).cpf ?? '',
      shift_hours: meta.shift_hours ?? '',
      work_entry: meta.work_entry ?? '',
      work_break: meta.work_break ?? '',
      work_exit: meta.work_exit ?? '',
      work_days: meta.work_days ?? [],
    })
    setModal(true)
  }

  function toggleWorkType(key: string) {
    setForm(p => ({
      ...p,
      work_types: p.work_types.includes(key) ? p.work_types.filter(w => w !== key) : [...p.work_types, key],
    }))
  }

  function save() {
    if (!form.full_name.trim()) { st2('Nome obrigatório', 'warn'); return }
    if (form.work_types.length === 0) { st2('Selecione pelo menos uma área', 'warn'); return }
    const data = {
      house_id: house.id,
      full_name: form.full_name.trim(),
      address: form.address || null,
      phone: form.phone || null,
      pix_key: form.pix_key || null,
      daily_rate_cents: form.daily_rate_cents ? Math.round(parseFloat(form.daily_rate_cents) * 100) : null,
      hourly_rate_cents: form.hourly_rate_cents ? Math.round(parseFloat(form.hourly_rate_cents) * 100) : null,
      work_types: form.work_types,
      staff_type: form.staff_type,
      notes: form.notes || null,
      status: form.status,
      updated_at: new Date().toISOString(),
      cpf: form.cpf.trim() || null,
      work_meta: {
        shift_hours: form.shift_hours || null,
        work_entry: form.work_entry || null,
        work_break: form.work_break || null,
        work_exit: form.work_exit || null,
        work_days: form.work_days.length > 0 ? form.work_days : null,
      },
    }
    const q = editing
      ? supabase.from('freelancers').update(data).eq('id', editing)
      : supabase.from('freelancers').insert(data)
    q.then(r => {
      if (r.error) st2('Erro: ' + r.error.message, 'error')
      else { st2(editing ? 'Atualizado!' : 'Cadastrado!'); setModal(false); load() }
    })
  }

  function toggleStatus(fr: Freelancer) {
    const ns = fr.status === 'ativo' ? 'inativo' : 'ativo'
    supabase.from('freelancers').update({ status: ns }).eq('id', fr.id)
      .then(r => { if (!r.error) load(); else st2(r.error.message, 'error') })
  }

  function del(id: string) {
    if (!confirm('Remover este cadastro?')) return
    supabase.from('freelancers').delete().eq('id', id)
      .then(r => { if (r.error) st2(r.error.message, 'error'); else { st2('Removido!'); load() } })
  }

  // Link pessoal da "Minha Agenda" (tarefas + eventos do colaborador, sem senha)
  // Dia de trabalho de hoje segundo a virada da casa (6h em balada, 0h no diurno)
  const hojeOper = diaOperacionalStr(viradaDa(house))
  function agendaLink(fr: Freelancer) { return `${window.location.origin}/agenda.html?t=${fr.access_token}` }
  // ── Consulta de horários: histórico de ponto do colaborador ──
  interface ShiftRow {
    id: string; event: string; date: string; role?: string
    checkin?: string; checkout?: string; fee: number
    checkin_source?: string; checkout_source?: string
  }
  const [shiftFr, setShiftFr] = useState<Freelancer | null>(null)
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [shiftsLoading, setShiftsLoading] = useState(false)

  async function openShifts(fr: Freelancer) {
    setShiftFr(fr); setShifts([]); setShiftsLoading(true)
    const { data } = await supabase.from('event_freelancers')
      .select('id,role,checkin_at,checkout_at,custom_fee_cents,checkin_source,checkout_source,events(name,event_date)')
      .eq('freelancer_id', fr.id).order('id', { ascending: false }).limit(80)
    const rows: ShiftRow[] = ((data ?? []) as unknown as Array<{
      id: string; role?: string; checkin_at?: string; checkout_at?: string; custom_fee_cents?: number
      checkin_source?: string; checkout_source?: string; events?: { name?: string; event_date?: string }
    }>).map(r => ({
      id: r.id, event: r.events?.name ?? '—', date: r.events?.event_date ?? '',
      role: r.role, checkin: r.checkin_at, checkout: r.checkout_at,
      fee: r.custom_fee_cents ?? fr.daily_rate_cents ?? 0,
      checkin_source: r.checkin_source, checkout_source: r.checkout_source,
    })).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    setShifts(rows); setShiftsLoading(false)
  }

  const shiftHours = (s: ShiftRow) => (s.checkin && s.checkout)
    ? (new Date(s.checkout).getTime() - new Date(s.checkin).getTime()) / 3600000 : null

  // ── Relatório de ponto / folha de um evento ──────────────────────────────
  // Base para pagar a equipe do dia: confere entrada e saída, permite corrigir os
  // horários (o ponto pelo app falha: esqueceram de bater, bateram fora do local)
  // e fecha o valor por diária ou por hora.
  interface PontoRow {
    id: string; freelancerId: string; nome: string; role?: string
    pix?: string; phone?: string
    checkin: string | null; checkout: string | null
    entrada: string; saida: string        // HH:mm editáveis na tela
    diaria: number; hora: number | null
    contratadas: number | null            // jornada contratada (work_meta.shift_hours)
    desconto: number                      // centavos
    descontoTxt: string                   // o que está digitado no campo (em reais)
    pago: number | null                   // valor fechado (paid_cents); null = usa o cálculo
    pagoTxt: string                       // o que está digitado no campo de valor
    motivo: string
    confirmed: boolean
    fonteIn?: string; fonteOut?: string
  }
  const [pontoOpen, setPontoOpen] = useState(false)
  const [addPonto, setAddPonto] = useState('')
  const [pontoEvs, setPontoEvs] = useState<{ id: string; name: string; event_date: string }[]>([])
  const [pontoEvId, setPontoEvId] = useState('')
  const [pontoDate, setPontoDate] = useState('')
  const [pontoRows, setPontoRows] = useState<PontoRow[]>([])
  const [pontoLdg, setPontoLdg] = useState(false)
  const [pontoModo, setPontoModo] = useState<'diaria' | 'hora'>('diaria')
  const [pontoSaving, setPontoSaving] = useState<string | null>(null)
  // Piso e teto das horas pagas. Padrão (mín. ligado / proporcional desligado) reproduz
  // exatamente o comportamento antigo: sempre a diária cheia, sem hora extra.
  const [pontoMin, setPontoMin] = useState(true)
  const [pontoProp, setPontoProp] = useState(false)
  const [pontoJornada, setPontoJornada] = useState('8')   // usada por quem não tem jornada no cadastro

  const hhmm = (iso: string | null) => iso
    ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''

  async function openPonto() {
    setPontoOpen(true); setPontoRows([]); setPontoModo('diaria')
    const { data } = await supabase.from('events')
      .select('id,name,event_date').eq('house_id', house.id)
      .order('event_date', { ascending: false }).limit(60)
    const evs = (data ?? []) as { id: string; name: string; event_date: string }[]
    setPontoEvs(evs)
    // Abre já no evento mais recente que não é futuro — é o que se costuma fechar
    const hoje = new Date().toISOString().slice(0, 10)
    const alvo = evs.find(e => e.event_date <= hoje) ?? evs[0]
    if (alvo) { setPontoEvId(alvo.id); loadPonto(alvo.id) }
  }

  async function loadPonto(evId: string) {
    if (!evId) return
    setPontoLdg(true)
    const { data, error } = await supabase.from('event_freelancers')
      .select('id,role,confirmed,checkin_at,checkout_at,custom_fee_cents,discount_cents,discount_reason,paid_cents,checkin_source,checkout_source,freelancer_id,freelancers(full_name,pix_key,phone,daily_rate_cents,hourly_rate_cents,work_meta,staff_type)')
      .eq('event_id', evId)
    setPontoLdg(false)
    if (error) { st2('Erro ao carregar o ponto: ' + error.message, 'error'); return }
    const rows: PontoRow[] = ((data ?? []) as unknown as Array<{
      id: string; role?: string; confirmed?: boolean; checkin_at?: string; checkout_at?: string
      custom_fee_cents?: number; discount_cents?: number; discount_reason?: string; paid_cents?: number | null
      checkin_source?: string; checkout_source?: string; freelancer_id: string
      freelancers?: {
        full_name?: string; pix_key?: string; phone?: string
        daily_rate_cents?: number; hourly_rate_cents?: number; staff_type?: string
        work_meta?: { shift_hours?: string | null } | null
      }
    }>).map(r => ({
      id: r.id, freelancerId: r.freelancer_id,
      nome: r.freelancers?.full_name ?? '—', role: r.role,
      pix: r.freelancers?.pix_key, phone: r.freelancers?.phone,
      checkin: r.checkin_at ?? null, checkout: r.checkout_at ?? null,
      entrada: hhmm(r.checkin_at ?? null), saida: hhmm(r.checkout_at ?? null),
      // Funcionario e assalariado: a diaria do cadastro nao vale para ele. So custa
      // quando fez jornada de freelance, e ai o valor foi lancado a mao.
      diaria: r.custom_fee_cents
        ?? ((r.freelancers?.staff_type ?? 'freelancer') === 'funcionario' ? 0 : r.freelancers?.daily_rate_cents)
        ?? 0,
      hora: r.freelancers?.hourly_rate_cents ?? null,
      contratadas: Number(r.freelancers?.work_meta?.shift_hours) || null,
      desconto: r.discount_cents ?? 0,
      descontoTxt: r.discount_cents ? (r.discount_cents / 100).toFixed(2).replace('.', ',') : '',
      pago: r.paid_cents ?? null,
      pagoTxt: r.paid_cents != null ? (r.paid_cents / 100).toFixed(2).replace('.', ',') : '',
      motivo: r.discount_reason ?? '',
      confirmed: !!r.confirmed,
      fonteIn: r.checkin_source, fonteOut: r.checkout_source,
    })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    setPontoRows(rows)
  }

  /** 'HH:mm' + data do evento → ISO. Antes das 6h conta como madrugada do dia seguinte
   *  (mesma regra de dia de operação usada no resto do app). */
  function horaParaISO(evDate: string, hm: string): string | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim())
    if (!m) return null
    const h = Number(m[1]), min = Number(m[2])
    if (h > 23 || min > 59) return null
    const d = new Date(evDate + 'T00:00:00')
    // Hora antes da virada pertence ao dia seguinte no calendário (madrugada da balada).
    // Numa casa diurna a virada é 0 e nada é transposto.
    if (h < viradaDa(house)) d.setDate(d.getDate() + 1)
    d.setHours(h, min, 0, 0)
    return d.toISOString()
  }

  const horasDe = (r: PontoRow) => {
    if (!r.checkin || !r.checkout) return null
    const h = (new Date(r.checkout).getTime() - new Date(r.checkin).getTime()) / 3600000
    return h > 0 ? h : null
  }

  /**
   * Horas pagas = horas trabalhadas com piso e teto na jornada contratada.
   *  - "período mínimo" (piso): dispensado antes das 8h contratadas → paga as 8h.
   *  - "proporcional"   (teto): ficou 9h numa jornada de 8h → paga as 9h; desligado, corta em 8h.
   * Com mínimo ligado e proporcional desligado o resultado é sempre a jornada contratada,
   * que é o comportamento de diária cheia que o app já tinha.
   */
  function calcPonto(r: PontoRow): { cents: number; nota: string; pagas: number | null } {
    const h = horasDe(r)
    const contr = r.contratadas ?? (Number(pontoJornada) || null)

    // Sem ponto ou sem jornada de referência: cai no valor simples de cada modo
    if (h == null || !contr) {
      if (pontoModo === 'diaria') return { cents: r.diaria, nota: '', pagas: h }
      return { cents: h != null && r.hora != null ? Math.round(h * r.hora) : 0, nota: '', pagas: h }
    }

    let pagas = h
    if (pontoMin) pagas = Math.max(pagas, contr)
    if (!pontoProp) pagas = Math.min(pagas, contr)

    // Na diária o valor/hora é implícito: diária ÷ jornada contratada
    const vHora = pontoModo === 'hora' ? r.hora : (contr > 0 ? r.diaria / contr : 0)
    if (vHora == null) return { cents: 0, nota: '', pagas }

    let nota = ''
    if (pagas > h) nota = `mín. ${contr}h`
    else if (pagas < h) nota = `corte em ${contr}h`
    else if (h > contr) nota = `+${(h - contr).toFixed(1).replace('.', ',')}h extra`

    return { cents: Math.round(pagas * vHora), nota, pagas }
  }

  const valorDe = (r: PontoRow) => calcPonto(r).cents

  /** Fecha (ou reabre) o valor de uma linha. Vazio volta ao cálculo automático. */
  async function salvarPago(id: string, txt: string) {
    const limpo = txt.trim()
    const cents = limpo === '' ? null : Math.round((parseFloat(limpo.replace(/\./g, '').replace(',', '.')) || 0) * 100)
    setPontoRows(rs => rs.map(r => r.id === id ? { ...r, pago: cents, pagoTxt: limpo } : r))
    const { error } = await supabase.from('event_freelancers').update({ paid_cents: cents }).eq('id', id)
    if (error) st2('Não foi possível salvar o valor: ' + error.message, 'error')
  }

  /**
   * Controle de inclusão. Precisa existir TAMBÉM quando a escala está vazia — que é
   * justamente quando mais se precisa dele; antes só aparecia se já houvesse alguém.
   */
  function blocoIncluir() {
    if (!pontoEvId) return null
    const jaNaEscala = new Set(pontoRows.map(r => r.freelancerId))
    const livres = freelancers
      .filter(f => f.status === 'ativo' && !jaNaEscala.has(f.id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <span style={{ color: C.mut, fontSize: 12, fontWeight: 600 }}>
          {pontoRows.length === 0 ? 'Escalar agora:' : 'Faltou alguém na escala?'}
        </span>
        <select value={addPonto} onChange={e => setAddPonto(e.target.value)}
          style={{ flex: '1 1 220px', maxWidth: 340, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '7px 10px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }}>
          <option value="">— escolher pessoa —</option>
          {livres.map(f => <option key={f.id} value={f.id}>{f.full_name}</option>)}
        </select>
        <button onClick={() => addPonto && incluirNaEscala(addPonto)} disabled={!addPonto}
          title="Incluir na escala deste evento"
          style={{ background: addPonto ? C.acc + '22' : 'transparent', border: `1px solid ${addPonto ? C.acc + '55' : C.brd}`, borderRadius: 8, padding: '7px 14px', color: addPonto ? C.acc : C.mut, fontSize: 12.5, fontWeight: 700, cursor: addPonto ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
          + Incluir
        </button>
        {livres.length === 0 && <span style={{ color: C.mut, fontSize: 11 }}>Toda a equipe ativa já está escalada.</span>}
      </div>
    )
  }

  /** Inclui alguém na escala pela própria folha — troca de última hora não deveria
   *  obrigar a voltar em Eventos para depois refazer o fechamento. */
  async function incluirNaEscala(freelancerId: string) {
    if (!pontoEvId) { st2('Escolha o evento primeiro', 'warn'); return }
    const f = freelancers.find(x => x.id === freelancerId)
    const { error } = await supabase.from('event_freelancers').insert({
      event_id: pontoEvId, freelancer_id: freelancerId, confirmed: true,
      role: (f as { work_types?: string[] } | undefined)?.work_types?.[0] || 'outros',
    })
    if (error) { st2('Erro ao incluir: ' + error.message, 'error'); return }
    st2(`✅ ${(f?.full_name ?? 'Pessoa').split(' ')[0]} incluído na escala`, 'success')
    setAddPonto('')
    loadPonto(pontoEvId)
  }
  /**
   * Quanto sai de fato. Se houver valor fechado à mão (paid_cents), ele MANDA — é o
   * número que o gestor decidiu, e é o mesmo que o Budget vai ler.
   * Sem ele, cai no cálculo: bruto menos desconto, nunca negativo.
   */
  const liquidoDe = (r: PontoRow) => r.pago != null ? r.pago : Math.max(0, calcPonto(r).cents - r.desconto)

  async function salvarDesconto(r: PontoRow, campo: 'valor' | 'motivo', valor: string) {
    if (campo === 'motivo') {
      setPontoRows(prev => prev.map(x => x.id === r.id ? { ...x, motivo: valor } : x))
      const { error } = await supabase.from('event_freelancers')
        .update({ discount_reason: valor.trim() || null }).eq('id', r.id)
      if (error) st2('Erro ao salvar o motivo: ' + error.message, 'error')
      return
    }
    const cents = Math.max(0, Math.round((parseFloat(valor.replace(/\./g, '').replace(',', '.')) || 0) * 100))
    setPontoSaving(r.id)
    const { error } = await supabase.from('event_freelancers').update({ discount_cents: cents }).eq('id', r.id)
    setPontoSaving(null)
    if (error) { st2('Erro ao salvar o desconto: ' + error.message, 'error'); return }
    setPontoRows(prev => prev.map(x => x.id === r.id
      ? { ...x, desconto: cents, descontoTxt: cents ? (cents / 100).toFixed(2).replace('.', ',') : '' } : x))
  }

  /** Grava a correção de horário. checkout anterior ao checkin vira virada de noite. */
  async function salvarPonto(r: PontoRow, campo: 'entrada' | 'saida', valor: string) {
    const ev = pontoEvs.find(e => e.id === pontoEvId)
    if (!ev) return
    setPontoRows(prev => prev.map(x => x.id === r.id ? { ...x, [campo]: valor } : x))
    if (valor.trim() === '') {
      const patch = campo === 'entrada' ? { checkin_at: null } : { checkout_at: null }
      setPontoSaving(r.id)
      const { error } = await supabase.from('event_freelancers').update(patch).eq('id', r.id)
      setPontoSaving(null)
      if (error) { st2('Erro ao limpar: ' + error.message, 'error'); return }
      setPontoRows(prev => prev.map(x => x.id === r.id
        ? { ...x, ...(campo === 'entrada' ? { checkin: null } : { checkout: null }) } : x))
      return
    }
    const iso = horaParaISO(ev.event_date, valor)
    if (!iso) return  // ainda digitando

    let checkinISO = campo === 'entrada' ? iso : r.checkin
    let checkoutISO = campo === 'saida' ? iso : r.checkout
    // Turno que vira a noite: saída no mesmo dia ficaria "antes" da entrada
    if (checkinISO && checkoutISO && new Date(checkoutISO) <= new Date(checkinISO)) {
      const d = new Date(checkoutISO); d.setDate(d.getDate() + 1)
      checkoutISO = d.toISOString()
      if (campo === 'entrada') { const e = new Date(checkinISO); e.setDate(e.getDate() - 1); checkinISO = e.toISOString() }
    }

    setPontoSaving(r.id)
    const { error } = await supabase.from('event_freelancers')
      .update({ checkin_at: checkinISO, checkout_at: checkoutISO })
      .eq('id', r.id)
    setPontoSaving(null)
    if (error) { st2('Erro ao salvar horário: ' + error.message, 'error'); return }
    setPontoRows(prev => prev.map(x => x.id === r.id
      ? { ...x, checkin: checkinISO, checkout: checkoutISO, entrada: hhmm(checkinISO), saida: hhmm(checkoutISO) } : x))
  }

  function imprimirPonto() {
    const ev = pontoEvs.find(e => e.id === pontoEvId)
    if (!ev) return
    const fmt = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const presentes = pontoRows.filter(r => r.checkin)
    const bruto = presentes.reduce((s, r) => s + valorDe(r), 0)
    const descontos = presentes.reduce((s, r) => s + Math.min(r.desconto, valorDe(r)), 0)
    const total = presentes.reduce((s, r) => s + liquidoDe(r), 0)
    const totalH = presentes.reduce((s, r) => s + (horasDe(r) ?? 0), 0)
    const dataStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    const linhas = presentes.map(r => {
      const h = horasDe(r)
      const c = calcPonto(r)
      return `<tr>
        <td>${r.nome}</td>
        <td>${r.role ?? '—'}</td>
        <td class="c">${r.entrada || '—'}</td>
        <td class="c">${r.saida || '—'}</td>
        <td class="c">${h != null ? h.toFixed(2).replace('.', ',') + 'h' : '—'}</td>
        <td class="c">${c.pagas != null ? c.pagas.toFixed(2).replace('.', ',') + 'h' : '—'}${c.nota ? `<div class="nota">${c.nota}</div>` : ''}</td>
        <td class="pix">${r.pix ?? '—'}</td>
        <td class="r">${fmt(c.cents)}</td>
        <td class="r desc">${r.desconto > 0 ? '−' + fmt(r.desconto) : '—'}${r.desconto > 0 && r.motivo ? `<div class="nota">${r.motivo}</div>` : ''}</td>
        <td class="r liq">${fmt(Math.max(0, c.cents - r.desconto))}</td>
      </tr>`
    }).join('')
    const regras = [
      pontoModo === 'hora' ? 'CÁLCULO POR HORA' : 'CÁLCULO POR DIÁRIA',
      pontoMin ? 'período mínimo garantido' : 'sem período mínimo',
      pontoProp ? 'horas extras proporcionais' : 'sem horas extras',
    ].join(' · ')

    // Rateio por área para lançar no balanço (bar, segurança, produção...)
    const areaAcc = new Map<string, { label: string; pessoas: number; horas: number; liquido: number }>()
    for (const r of presentes) {
      const key = r.role || 'outros'
      const cur = areaAcc.get(key) ?? { label: areaMeta(areas, key).label, pessoas: 0, horas: 0, liquido: 0 }
      cur.pessoas += 1
      cur.horas += horasDe(r) ?? 0
      cur.liquido += liquidoDe(r)
      areaAcc.set(key, cur)
    }
    const porArea = [...areaAcc.values()].sort((a, b) => b.liquido - a.liquido)
    const ausentes = pontoRows.filter(r => !r.checkin)
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Folha de pagamento — ${ev.name}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 28px; max-width: 980px; margin: 0 auto; color: #111; }
      h1 { font-size: 21px; margin: 0 0 4px; }
      .sub2 { color: #666; font-size: 13px; margin-bottom: 6px; text-transform: capitalize; }
      .modo { display: inline-block; font-size: 12px; font-weight: 700; border: 1px solid #333; border-radius: 4px; padding: 2px 8px; margin-bottom: 18px; }
      table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: #444; border-bottom: 2px solid #333; padding: 6px 8px; }
      td { padding: 7px 8px; border-bottom: 1px solid #e5e5e5; }
      td.c, th.c { text-align: center; } td.r, th.r { text-align: right; white-space: nowrap; font-weight: 700; }
      td.pix { font-size: 11px; color: #555; word-break: break-all; max-width: 200px; }
      td.desc { color: #b91c1c; } td.liq { font-size: 13.5px; }
      .nota { font-size: 9.5px; color: #888; font-weight: 400; }
      .somas { margin-top: 8px; font-size: 13px; }
      .somas div { display: flex; justify-content: space-between; padding: 3px 8px; }
      h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #444; margin: 26px 0 6px; border-bottom: 2px solid #333; padding-bottom: 4px; }
      table.areas { font-size: 12.5px; }
      table.areas tr:last-child td { border-bottom: none; }
      .grand { display: flex; justify-content: space-between; font-size: 17px; font-weight: 900; padding: 12px 8px; margin-top: 10px; border-top: 3px solid #111; }
      .aus { margin-top: 20px; font-size: 12px; color: #777; }
      .footer { margin-top: 26px; font-size: 11px; color: #999; text-align: center; }
      @media print { body { padding: 12px; } }
    </style></head><body>
    <h1>👷 Folha de pagamento — ${ev.name}</h1>
    <div class="sub2">📅 ${dataStr}</div>
    <div class="modo">${regras}</div>
    <table>
      <thead><tr>
        <th>Nome</th><th>Função</th><th class="c">Entrada</th><th class="c">Saída</th>
        <th class="c">Trabalhadas</th><th class="c">Pagas</th><th>Chave PIX</th>
        <th class="r">Bruto</th><th class="r">Desconto</th><th class="r">Líquido</th>
      </tr></thead>
      <tbody>${linhas || '<tr><td colspan="10" style="text-align:center;color:#888;padding:20px">Ninguém com entrada registrada.</td></tr>'}</tbody>
    </table>
    ${descontos > 0 ? `<div class="somas">
      <div><span>Bruto</span><span>${fmt(bruto)}</span></div>
      <div><span>Descontos</span><span style="color:#b91c1c">−${fmt(descontos)}</span></div>
    </div>` : ''}
    <div class="grand"><span>TOTAL A PAGAR · ${presentes.length} pessoa(s) · ${totalH.toFixed(1).replace('.', ',')}h</span><span>${fmt(total)}</span></div>
    ${porArea.length > 0 ? `<h2>Custo por área — lançamento no balanço</h2>
    <table class="areas">
      <thead><tr><th>Área</th><th class="c">Pessoas</th><th class="c">Horas</th><th class="r">Líquido</th><th class="c">% do total</th></tr></thead>
      <tbody>${porArea.map(a => `<tr>
        <td>${a.label}</td>
        <td class="c">${a.pessoas}</td>
        <td class="c">${a.horas.toFixed(1).replace('.', ',')}h</td>
        <td class="r">${fmt(a.liquido)}</td>
        <td class="c">${total > 0 ? Math.round((a.liquido / total) * 100) : 0}%</td>
      </tr>`).join('')}</tbody>
    </table>` : ''}
    ${ausentes.length > 0 ? `<div class="aus"><b>Não compareceram / sem ponto (${ausentes.length}):</b> ${ausentes.map(a => a.nome).join(' · ')}</div>` : ''}
    <div class="footer">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — NightPass</div>
    <script>window.onload = () => window.print()</script>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  // Liga/desliga o acesso do membro à agenda de TODOS os eventos da casa
  // (desligado = vê só os eventos em que está escalado / tem tarefa)
  async function toggleSeeAll(fr: Freelancer) {
    const next = !fr.can_see_all_events
    const { error } = await supabase.from('freelancers').update({ can_see_all_events: next }).eq('id', fr.id)
    if (error) { st2('Erro: ' + error.message, 'error'); return }
    setFreelancers(prev => prev.map(x => x.id === fr.id ? { ...x, can_see_all_events: next } : x))
    st2(next ? '✅ Vê todos os eventos da casa' : '🔒 Vê só os eventos dele', 'success')
  }

  // Liga/desliga a permissão do membro de enviar tarefas à equipe (pelo portal dele)
  async function toggleDelegate(fr: Freelancer) {
    const next = !fr.can_delegate_tasks
    const { error } = await supabase.from('freelancers').update({ can_delegate_tasks: next }).eq('id', fr.id)
    if (error) { st2('Erro: ' + error.message, 'error'); return }
    setFreelancers(prev => prev.map(x => x.id === fr.id ? { ...x, can_delegate_tasks: next } : x))
    st2(next ? '✅ Pode enviar tarefas à equipe' : 'Envio de tarefas desativado', 'success')
  }
  const [sendingAgenda, setSendingAgenda] = useState<string | null>(null)
  // ── Documentos (termo de imagem e o que vier) ──
  const [modelo, setModelo] = useState<DocTemplate | null>(null)
  const [docs, setDocs] = useState<DocAssinado[]>([])
  const [docPessoa, setDocPessoa] = useState<Freelancer | null>(null)
  const [docTexto, setDocTexto] = useState('')
  const [docTrava, setDocTrava] = useState(true)
  const [docBusy, setDocBusy] = useState(false)

  const carregarDocs = useCallback(() => {
    // Modelo da casa quando existir; senão o do sistema (house_id nulo)
    supabase.from('document_templates').select('*').eq('kind', 'imagem_equipe').eq('active', true)
      .then(r => {
        const linhas = (r.data ?? []) as DocTemplate[]
        setModelo(linhas.find(m => m.house_id === house.id) ?? linhas.find(m => m.house_id === null) ?? null)
      })
    supabase.from('signed_documents')
      .select('id,freelancer_id,kind,title,status,signed_at,signed_method,revoked_at,created_at')
      .eq('house_id', house.id).eq('kind', 'imagem_equipe').is('revoked_at', null)
      .then(r => setDocs((r.data ?? []) as DocAssinado[]))
  }, [house.id])
  useEffect(() => { carregarDocs() }, [carregarDocs])

  const docDe = (id: string) => docs.find(d => d.freelancer_id === id) ?? null

  function abrirDoc(fr: Freelancer) {
    if (!modelo) { st2('Modelo de termo não encontrado.', 'error'); return }
    setDocPessoa(fr)
    setDocTrava(true)
    setDocTexto(preencher(modelo.body, house as Parameters<typeof preencher>[1], {
      full_name: fr.full_name,
      address: (fr as { address?: string }).address,
      staff_type: (fr as { staff_type?: string }).staff_type,
      cpf: (fr as { cpf?: string }).cpf,
    }))
  }

  // Grava o texto JÁ PREENCHIDO. Guardar só o id do modelo faria uma edição futura
  // mudar retroativamente aquilo que a pessoa aceitou.
  async function gravarDoc(enviar: boolean) {
    if (!docPessoa || !modelo) return
    setDocBusy(true)
    const { error } = await supabase.from('signed_documents').insert({
      house_id: house.id, freelancer_id: docPessoa.id, kind: modelo.kind, title: modelo.title,
      body_snapshot: docTexto, template_id: modelo.id, template_version: modelo.version,
      status: enviar ? 'pendente' : 'assinado',
      blocks_access: enviar ? docTrava : false,
      sent_at: enviar ? new Date().toISOString() : null,
      signed_at: enviar ? null : new Date().toISOString(),
      signed_method: enviar ? null : 'papel',
      signer_name: enviar ? null : docPessoa.full_name,
      signer_doc: (docPessoa as { cpf?: string }).cpf ?? null,
    })
    setDocBusy(false)
    if (error) { st2('Erro: ' + error.message, 'error'); return }
    st2(enviar
      ? `📄 Enviado para o app de ${docPessoa.full_name.split(' ')[0]}`
      : `✅ Registrado como assinado em papel`, 'success')
    setDocPessoa(null)
    carregarDocs()
  }

  function imprimirDoc() {
    if (!docPessoa || !modelo) return
    const rodape = `Gerado em ${new Date().toLocaleDateString('pt-BR')} — ${house.name} · NightPass`
    const w = window.open('', '_blank')
    if (w) { w.document.write(paraHtmlImpressao(modelo.title, docTexto, rodape)); w.document.close() }
  }
  async function sendAgenda(fr: Freelancer) {
    if (!fr.access_token) { st2('Recarregue a página para gerar o link', 'warn'); return }
    const link = agendaLink(fr)
    if (!fr.phone) {
      navigator.clipboard.writeText(link).then(() => st2('📋 Link copiado (colaborador sem telefone)', 'success'))
      return
    }
    const msg = `Olá ${fr.full_name.split(' ')[0]}! 📋 Aqui está sua *agenda de tarefas* no NightPass.\n\nAbra o link e marque as tarefas conforme for concluindo:\n${link}\n\n💡 Dica: toque em "compartilhar → adicionar à tela de início" para virar um app no seu celular.`
    setSendingAgenda(fr.id)
    // Envia pela API do WhatsApp (mesma integração do resto do app); cai no wa.me só se a API estiver off
    const r = await sendWADirect(house.id, fr.phone, msg, { type: 'agenda_colaborador' })
    setSendingAgenda(null)
    st2(r.viaApi ? '✅ Agenda enviada pela API' : '📲 Abrindo WhatsApp…', 'success')
  }

  // ── Admin de áreas ──
  async function saveArea() {
    if (!areaForm.label.trim()) { st2('Nome da área obrigatório', 'warn'); return }
    if (areaForm.id) {
      const { error } = await supabase.from('work_areas').update({ label: areaForm.label.trim(), icon: areaForm.icon, color: areaForm.color }).eq('id', areaForm.id)
      if (error) { st2('Erro: ' + error.message, 'error'); return }
    } else {
      let key = slugifyArea(areaForm.label)
      if (areas.some(a => a.key === key)) key = key + '_' + Math.random().toString(36).slice(2, 5)
      const { error } = await supabase.from('work_areas').insert({ house_id: house.id, key, label: areaForm.label.trim(), icon: areaForm.icon, color: areaForm.color, sort_order: areas.length, active: true })
      if (error) { st2('Erro: ' + error.message, 'error'); return }
    }
    setAreaForm({ ...AREA_FORM_DEF })
    loadAreas()
  }

  async function delArea(a: WorkArea) {
    const inUse = freelancers.filter(f => (f.work_types ?? []).includes(a.key as never)).length
    if (!confirm(inUse > 0 ? `${inUse} cadastro(s) usam "${a.label}". Remover a área mesmo assim? (os cadastros mantêm o histórico)` : `Remover a área "${a.label}"?`)) return
    if (a.id) await supabase.from('work_areas').delete().eq('id', a.id)
    loadAreas()
  }

  const filtered = freelancers.filter(fr => {
    const matchSearch = !search || fr.full_name.toLowerCase().includes(search.toLowerCase()) || (fr.phone ?? '').includes(search)
    const matchType = filterType === 'all' || (fr.work_types ?? []).includes(filterType as never)
    const matchStaff = staffFilter === 'all' || (fr.staff_type ?? 'freelancer') === staffFilter
    return matchSearch && matchType && matchStaff
  }).sort((a, b) => {
    // Funcionários sempre antes dos freelancers; dentro de cada grupo mantém ordem alfabética
    const rank = (s?: string) => (s ?? 'freelancer') === 'funcionario' ? 0 : 1
    const dr = rank(a.staff_type) - rank(b.staff_type)
    return dr !== 0 ? dr : a.full_name.localeCompare(b.full_name, 'pt-BR')
  })

  const inp = { style: { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const } }

  if (ldg) return <div style={{ padding: 60, textAlign: 'center', color: C.mut }}>Carregando...</div>

  return (
    <div style={{ paddingBottom: 40 }}>
      <Toast toast={toast} />

      {/* Form modal */}
      {/* Termo de imagem — gerar, enviar pelo app ou imprimir */}
      <Modal open={!!docPessoa} title={`📄 Termo de imagem — ${docPessoa?.full_name ?? ''}`} maxWidth={780}
        onClose={() => setDocPessoa(null)} noDirtyCheck>
        {(() => {
          const d = docPessoa ? docDe(docPessoa.id) : null
          const faltas: string[] = []
          if (!(house as { cnpj?: string }).cnpj) faltas.push('CNPJ da casa')
          if (!(house as { city?: string }).city) faltas.push('cidade da casa')
          if (!(docPessoa as { cpf?: string } | null)?.cpf) faltas.push('CPF da pessoa')
          return (
            <div style={{ display: 'grid', gap: 12 }}>
              {d && (
                <div style={{ background: (d.status === 'assinado' ? C.grn : d.status === 'recusado' ? C.red : C.gold) + '18', border: `1px solid ${(d.status === 'assinado' ? C.grn : d.status === 'recusado' ? C.red : C.gold)}44`, borderRadius: 10, padding: '10px 12px', fontSize: 13, color: C.txt }}>
                  {d.status === 'assinado' ? `✅ Já aceito em ${d.signed_at ? new Date(d.signed_at).toLocaleString('pt-BR') : ''}${d.signed_method === 'app' ? ' pelo app' : ' em papel'}.`
                    : d.status === 'recusado' ? '❌ A pessoa registrou que NÃO concorda com este termo.'
                    : '⏳ Já enviado — aguardando a resposta no app.'}
                  <div style={{ color: C.mut, fontSize: 11, marginTop: 3 }}>Gerar de novo cria um segundo registro; o anterior continua arquivado.</div>
                </div>
              )}

              {faltas.length > 0 && (
                <div style={{ background: C.gold + '18', border: `1px solid ${C.gold}44`, borderRadius: 10, padding: '10px 12px', fontSize: 13, color: C.txt }}>
                  ⚠️ Falta preencher: <b>{faltas.join(', ')}</b>. O documento sai com linha em branco nesses pontos.
                </div>
              )}

              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Texto do termo <span style={{ fontWeight: 400 }}>— pode ajustar antes de enviar</span>
                </label>
                <textarea value={docTexto} onChange={e => setDocTexto(e.target.value)}
                  className="r-scroll-y"
                  style={{ width: '100%', height: 260, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12, color: C.txt, fontSize: 12.5, lineHeight: 1.6, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={docTrava} onChange={e => setDocTrava(e.target.checked)}
                  style={{ width: 18, height: 18, marginTop: 2, accentColor: C.acc, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>
                  Travar o app até responder
                  <span style={{ display: 'block', color: C.gold, fontSize: 11, marginTop: 2 }}>
                    Cuidado: condicionar o acesso ao trabalho enfraquece o argumento de que o
                    consentimento foi livre — que é justamente o ponto atacado num termo de imagem.
                  </span>
                </span>
              </label>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn onClick={() => gravarDoc(true)} disabled={docBusy} style={{ flex: '1 1 180px' }}>
                  {docBusy ? 'Enviando…' : '📲 Enviar para o app'}
                </Btn>
                <Btn onClick={imprimirDoc} variant="secondary" style={{ flex: '1 1 130px' }}>🖨️ Imprimir</Btn>
                <Btn onClick={() => gravarDoc(false)} disabled={docBusy} variant="ghost" style={{ flex: '1 1 170px' }}>
                  ✍️ Assinou em papel
                </Btn>
              </div>
              <div style={{ color: C.mut, fontSize: 11 }}>
                O texto é arquivado exatamente como está acima. Editar o modelo depois não altera
                o que já foi enviado ou aceito.
              </div>
            </div>
          )
        })()}
      </Modal>

      <Modal open={modal} title={editing ? 'Editar Cadastro' : 'Novo Cadastro'} onClose={() => { setModal(false); setEditing(null) }}>
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Tipo: freelancer / funcionário */}
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>Tipo</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['freelancer', '👷 Freelancer', C.acc], ['funcionario', '🧑‍💼 Funcionário', '#10b981']] as const).map(([v, label, col]) => {
                const on = form.staff_type === v
                return (
                  <button key={v} type="button" onClick={() => setForm(p => ({ ...p, staff_type: v }))}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `2px solid ${on ? col : C.brd}`, background: on ? col + '22' : 'transparent', color: on ? col : C.mut, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nome completo *</label>
            <input {...inp} value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} placeholder="João da Silva" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Celular</label>
              <input {...inp} value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="(11) 99999-9999" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Valor por dia (R$)</label>
              <input type="number" step="0.01" min="0" {...inp} value={form.daily_rate_cents} onChange={e => setForm(p => ({ ...p, daily_rate_cents: e.target.value }))} placeholder="150,00" />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Valor por hora (R$) <span style={{ color: C.mut, fontWeight: 400 }}>— opcional, usado na folha por hora</span>
            </label>
            <input type="number" step="0.01" min="0" {...inp} value={form.hourly_rate_cents}
              onChange={e => setForm(p => ({ ...p, hourly_rate_cents: e.target.value }))} placeholder="25,00" />
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Endereço</label>
            <input {...inp} value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Rua, número, bairro, cidade" />
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Chave PIX</label>
            <input {...inp} value={form.pix_key} onChange={e => setForm(p => ({ ...p, pix_key: e.target.value }))} placeholder="CPF, email, telefone ou chave aleatória" />
          </div>

          {/* Áreas */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>Áreas / funções *</label>
              <button type="button" onClick={() => { setModal(false); setAreasModal(true) }} style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>⚙️ Administrar</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {areas.map(a => {
                const selected = form.work_types.includes(a.key)
                return (
                  <button key={a.key} type="button" onClick={() => toggleWorkType(a.key)}
                    style={{ background: selected ? a.color + '22' : C.bg, color: selected ? a.color : C.mut, border: `1px solid ${selected ? a.color : C.brd}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: selected ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {a.icon} {a.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              CPF <span style={{ fontWeight: 400 }}>— usado no termo de imagem e em contratos</span>
            </label>
            <input {...inp} value={form.cpf} onChange={e => setForm(p => ({ ...p, cpf: e.target.value }))} placeholder="000.000.000-00" inputMode="numeric" />
          </div>

          {/* Período de trabalho */}
          {form.staff_type === 'freelancer' ? (
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>⏱ Turno</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([['', 'Variável'], ['8', '8 horas'], ['12', '12 horas']] as const).map(([v, label]) => {
                  const on = form.shift_hours === v
                  return (
                    <button key={v} type="button" onClick={() => setForm(p => ({ ...p, shift_hours: v }))}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${on ? C.acc : C.brd}`, background: on ? C.acc + '22' : 'transparent', color: on ? C.acc : C.mut, fontSize: 13, fontWeight: on ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 8 }}>⏱ Horário de trabalho</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                {([['work_entry', 'Entrada'], ['work_break', 'Pausa'], ['work_exit', 'Saída']] as const).map(([f, label]) => (
                  <div key={f}>
                    <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 3 }}>{label}</label>
                    <input type="time" {...inp} value={(form as any)[f]} onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 6 }}>Dias da semana</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {WEEK_DAYS.map(d => {
                  const on = form.work_days.includes(d.key)
                  return (
                    <button key={d.key} type="button"
                      onClick={() => setForm(p => ({ ...p, work_days: on ? p.work_days.filter(x => x !== d.key) : [...p.work_days, d.key] }))}
                      style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${on ? C.acc : C.brd}`, background: on ? C.acc + '22' : 'transparent', color: on ? C.acc : C.mut, fontSize: 12, fontWeight: on ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {d.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Observações</label>
            <textarea {...inp} style={{ ...inp.style, height: 60, resize: 'vertical' }} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Experiência, disponibilidade..." />
          </div>

          {editing && (
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Status</label>
              <select {...inp} value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={save} style={{ flex: 1 }}>💾 Salvar</Btn>
            <Btn onClick={() => { setModal(false); setEditing(null) }} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      </Modal>

      {/* Admin de áreas */}
      {/* Consulta de horários (ponto) do colaborador */}
      <Modal open={!!shiftFr} title={`🕐 Horários — ${shiftFr?.full_name ?? ''}`} onClose={() => { setShiftFr(null); setShifts([]) }} wide>
        {shiftsLoading ? (
          <div style={{ color: C.mut, textAlign: 'center', padding: 30 }}>Carregando…</div>
        ) : shifts.length === 0 ? (
          <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
            Este colaborador ainda não foi escalado em nenhum evento.
          </div>
        ) : (() => {
          const comPonto = shifts.filter(s => s.checkin)
          const totalH = shifts.reduce((s, x) => s + (shiftHours(x) ?? 0), 0)
          const totalPg = comPonto.reduce((s, x) => s + x.fee, 0)
          const faltas = shifts.filter(s => !s.checkin).length
          const cards = [
            { l: 'Escalas', v: String(shifts.length), c: C.acc },
            { l: 'Presenças', v: String(comPonto.length), c: C.grn },
            { l: 'Faltas', v: String(faltas), c: faltas > 0 ? C.red : C.mut },
            { l: 'Horas', v: totalH > 0 ? `${totalH.toFixed(0)}h` : '—', c: '#22d3ee' },
          ]
          return (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {cards.map((k, i) => (
                  <div key={i} style={{ flex: '1 1 80px', background: C.bg, border: `1px solid ${k.c}33`, borderRadius: 10, padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ color: k.c, fontSize: 17, fontWeight: 900 }}>{k.v}</div>
                    <div style={{ color: C.mut, fontSize: 10, fontWeight: 600, marginTop: 2 }}>{k.l}</div>
                  </div>
                ))}
              </div>
              <div className="r-scroll-x"><div style={{ minWidth: 520 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px 62px 52px 84px', gap: 4, padding: '4px 6px', fontSize: 10, color: C.mut, fontWeight: 700, letterSpacing: '0.04em' }}>
                  <div>EVENTO</div>
                  <div style={{ textAlign: 'center' }}>ENTRADA</div>
                  <div style={{ textAlign: 'center' }}>SAÍDA</div>
                  <div style={{ textAlign: 'center' }}>HORAS</div>
                  <div style={{ textAlign: 'right' }}>VALOR</div>
                </div>
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                  {shifts.map(s => {
                    const hhmm = (v?: string) => v ? new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
                    const h = shiftHours(s)
                    // Sem check-in num evento que ainda NAO aconteceu nao e falta: e escala
                    // futura. Antes qualquer ausencia de ponto virava "faltou" em vermelho,
                    // acusando gente que sequer tinha o dia de trabalho chegado.
                    const jaAconteceu = !!s.date && s.date < hojeOper
                    const faltou = jaAconteceu && !s.checkin
                    const aguardando = !jaAconteceu && !s.checkin
                    return (
                      <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 62px 62px 52px 84px', gap: 4, padding: '9px 6px', borderBottom: `1px solid ${C.brd}22`, alignItems: 'center', fontSize: 13, opacity: faltou ? 0.55 : 1 }}
                        title={aguardando ? 'Evento ainda não aconteceu' : undefined}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: C.txt, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.event}</div>
                          <div style={{ color: C.mut, fontSize: 10 }}>
                            {s.date ? new Date(s.date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                            {s.role ? ` · ${s.role}` : ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'center', color: faltou ? C.red : aguardando ? C.mut : C.grn, fontWeight: 700 }}>
                          {hhmm(s.checkin) ?? (aguardando ? '—' : 'faltou')}
                          {s.checkin_source === 'app' && <div style={{ fontSize: 8, color: C.mut, fontWeight: 400 }}>app</div>}
                        </div>
                        <div style={{ textAlign: 'center', color: C.gold, fontWeight: 700 }}>{hhmm(s.checkout) ?? '—'}</div>
                        <div style={{ textAlign: 'center', color: '#22d3ee', fontWeight: 700 }}>{h != null ? `${h.toFixed(1)}h` : '—'}</div>
                        <div style={{ textAlign: 'right', color: faltou || aguardando ? C.mut : C.txt, fontWeight: 700 }}>{faltou ? '—' : fmtCurrency(s.fee)}</div>
                      </div>
                    )
                  })}
                </div>
              </div></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.brd}` }}>
                <span style={{ color: C.mut, fontSize: 13 }}>Total das presenças</span>
                <span style={{ color: C.grn, fontSize: 16, fontWeight: 900 }}>{fmtCurrency(totalPg)}</span>
              </div>
              {shiftFr?.pix_key && <div style={{ color: C.sub, fontSize: 12, marginTop: 8 }}>💸 PIX: <strong>{shiftFr.pix_key}</strong></div>}
            </div>
          )
        })()}
      </Modal>

      <Modal open={areasModal} title="⚙️ Administrar Áreas" onClose={() => { setAreasModal(false); setAreaForm({ ...AREA_FORM_DEF }) }}>
        <div style={{ display: 'grid', gap: 14 }}>
          {/* Form add/edit */}
          <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: C.sub, fontWeight: 700, marginBottom: 8 }}>{areaForm.id ? 'Editar área' : 'Nova área'}</div>
            <input {...inp} value={areaForm.label} onChange={e => setAreaForm(p => ({ ...p, label: e.target.value }))} placeholder="Nome da área (ex: Bar, Caixa, DJ)" />
            <div style={{ fontSize: 11, color: C.mut, margin: '10px 0 4px' }}>Ícone</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {AREA_ICON_OPTIONS.map(ic => (
                <button key={ic} type="button" onClick={() => setAreaForm(p => ({ ...p, icon: ic }))} style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${areaForm.icon === ic ? areaForm.color : C.brd}`, background: areaForm.icon === ic ? areaForm.color + '22' : 'transparent', fontSize: 16, cursor: 'pointer' }}>{ic}</button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.mut, margin: '10px 0 4px' }}>Cor</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {AREA_COLOR_OPTIONS.map(col => (
                <button key={col} type="button" onClick={() => setAreaForm(p => ({ ...p, color: col }))} style={{ width: 26, height: 26, borderRadius: '50%', border: `2px solid ${areaForm.color === col ? C.txt : 'transparent'}`, background: col, cursor: 'pointer' }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Btn onClick={saveArea} small style={{ flex: 1 }}>{areaForm.id ? 'Salvar área' : '➕ Adicionar área'}</Btn>
              {areaForm.id && <Btn onClick={() => setAreaForm({ ...AREA_FORM_DEF })} small variant="ghost">Cancelar</Btn>}
            </div>
          </div>
          {/* Lista */}
          <div>
            {areas.map(a => (
              <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brd}22` }}>
                <span style={{ width: 30, height: 30, borderRadius: 7, background: a.color + '22', border: `1px solid ${a.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>{a.icon}</span>
                <span style={{ flex: 1, color: C.txt, fontSize: 13, fontWeight: 600 }}>{a.label}</span>
                <button onClick={() => setAreaForm({ id: a.id ?? '', label: a.label, icon: a.icon, color: a.color })} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '4px 8px', color: C.mut, fontSize: 12, cursor: 'pointer' }}>✏️</button>
                <button onClick={() => delArea(a)} style={{ background: 'none', border: `1px solid ${C.red}33`, borderRadius: 6, padding: '4px 8px', color: C.red, fontSize: 12, cursor: 'pointer' }}>🗑</button>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* ── Relatório de ponto / folha de pagamento do evento ── */}
      <Modal open={pontoOpen} title="📊 Ponto e folha da equipe" onClose={() => { setPontoOpen(false); setPontoRows([]); setAddPonto('') }} wide noDirtyCheck>
        <div>
          {/* Busca por data + evento + modo de cálculo */}
          {(() => {
            const evsF = pontoDate ? pontoEvs.filter(e => e.event_date === pontoDate) : pontoEvs
            const datas = [...new Set(pontoEvs.map(e => e.event_date))]
            return (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: C.mut, fontWeight: 800, display: 'block', marginBottom: 4 }}>DATA</label>
                  <input type="date" value={pontoDate} list="ponto-datas"
                    onChange={e => {
                      const d = e.target.value
                      setPontoDate(d)
                      // Já abre o evento daquela data — evita escolher no dropdown depois
                      const alvo = d ? pontoEvs.find(x => x.event_date === d) : null
                      if (alvo) { setPontoEvId(alvo.id); loadPonto(alvo.id) }
                    }}
                    style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 9, padding: '9px 11px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                  <datalist id="ponto-datas">{datas.map(d => <option key={d} value={d} />)}</datalist>
                </div>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <label style={{ fontSize: 10, color: C.mut, fontWeight: 800, display: 'block', marginBottom: 4 }}>
                    EVENTO {pontoDate && `(${evsF.length} nesta data)`}
                  </label>
                  <select value={pontoEvId} onChange={e => { setPontoEvId(e.target.value); loadPonto(e.target.value) }}
                    style={{ width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 9, padding: '9px 11px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}>
                    {evsF.length === 0 && <option value="">Nenhum evento nesta data</option>}
                    {evsF.map(e => (
                      <option key={e.id} value={e.id}>
                        {new Date(e.event_date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })} — {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                {pontoDate && <Btn small variant="ghost" onClick={() => setPontoDate('')}>✕ Todas</Btn>}
                <Btn onClick={imprimirPonto} variant="secondary" disabled={pontoRows.length === 0}
                  style={{ background: '#3b82f618', color: '#3b82f6', border: '1px solid #3b82f644' }}>🖨️ Imprimir</Btn>
              </div>
            )
          })()}

          {/* Regras de pagamento */}
          <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {([['diaria', 'Diária'], ['hora', 'Por hora']] as const).map(([v, lb]) => (
                  <button key={v} onClick={() => setPontoModo(v)}
                    style={{ padding: '6px 13px', borderRadius: 8, border: `1px solid ${pontoModo === v ? C.acc : C.brd}`, background: pontoModo === v ? C.acc + '22' : 'transparent', color: pontoModo === v ? C.acc : C.mut, fontSize: 12, fontWeight: pontoModo === v ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {lb}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ color: C.mut, fontSize: 11 }}>jornada</span>
                <input value={pontoJornada} inputMode="numeric"
                  onChange={e => setPontoJornada(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  title="Jornada padrão para quem não tem jornada no cadastro"
                  style={{ width: 42, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '5px 6px', color: C.txt, fontSize: 12, fontFamily: 'inherit', textAlign: 'center', boxSizing: 'border-box' }} />
                <span style={{ color: C.mut, fontSize: 11 }}>h</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 9 }}>
              {([
                [pontoMin, setPontoMin, '⏱ Período mínimo', 'Saiu antes do contratado? Paga a jornada cheia mesmo assim.'],
                [pontoProp, setPontoProp, '➕ Horas extras', 'Passou da jornada? Paga o excedente proporcional. Desligado, corta na jornada.'],
              ] as const).map(([on, set, lb, hint], i) => (
                <button key={i} onClick={() => set(!on)} title={hint}
                  style={{ flex: '1 1 200px', textAlign: 'left', padding: '8px 11px', borderRadius: 9, border: `1px solid ${on ? C.grn + '66' : C.brd}`, background: on ? C.grn + '14' : 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 30, height: 17, borderRadius: 99, background: on ? C.grn : C.brd, position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
                      <span style={{ position: 'absolute', top: 2, left: on ? 15 : 2, width: 13, height: 13, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                    </span>
                    <span style={{ color: on ? C.grn : C.mut, fontSize: 12, fontWeight: 700 }}>{lb}</span>
                  </div>
                  <div style={{ color: C.mut, fontSize: 10, marginTop: 3, lineHeight: 1.4 }}>{hint}</div>
                </button>
              ))}
            </div>
          </div>

          {pontoLdg ? (
            <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: 30 }}>Carregando…</div>
          ) : pontoRows.length === 0 ? (
            <div style={{ padding: '24px 20px' }}>
              <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', lineHeight: 1.6, marginBottom: 16 }}>
                Nenhum colaborador escalado neste evento.<br />
                Escale pelo botão <b style={{ color: C.txt }}>👷 Equipe</b> do card do evento — ou inclua aqui mesmo.
              </div>
              {blocoIncluir()}
            </div>
          ) : (() => {
            const presentes = pontoRows.filter(r => r.checkin)
            const totalBruto = presentes.reduce((s, r) => s + valorDe(r), 0)
            const totalDesc = presentes.reduce((s, r) => s + Math.min(r.desconto, valorDe(r)), 0)
            const totalV = presentes.reduce((s, r) => s + liquidoDe(r), 0)
            const totalH = presentes.reduce((s, r) => s + (horasDe(r) ?? 0), 0)
            const accArea = new Map<string, { label: string; pessoas: number; horas: number; liquido: number }>()
            for (const r of presentes) {
              const k = r.role || 'outros'
              const cur = accArea.get(k) ?? { label: areaMeta(areas, k).label, pessoas: 0, horas: 0, liquido: 0 }
              cur.pessoas += 1; cur.horas += horasDe(r) ?? 0; cur.liquido += liquidoDe(r)
              accArea.set(k, cur)
            }
            const porAreaTela = [...accArea.values()].sort((a, b) => b.liquido - a.liquido)
            const semHora = pontoModo === 'hora' && presentes.some(r => r.hora == null)
            const tIn = { width: 62, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '5px 6px', color: C.txt, fontSize: 12.5, fontFamily: 'inherit', textAlign: 'center' as const, boxSizing: 'border-box' as const }
            return (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, marginBottom: 12 }}>
                  {[
                    { l: 'ESCALADOS', v: String(pontoRows.length), c: C.txt },
                    { l: 'COM PONTO', v: String(presentes.length), c: C.grn },
                    { l: 'HORAS', v: totalH.toFixed(1).replace('.', ',') + 'h', c: C.acc },
                    { l: 'A PAGAR', v: fmtCurrency(totalV), c: C.gold, p: true },
                  ].map(k => (
                    <div key={k.l} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '9px 4px', textAlign: 'center' }}>
                      <div style={{ color: k.c, fontWeight: 900, fontSize: k.p ? 13 : 18 }}>{k.v}</div>
                      <div style={{ color: C.mut, fontSize: 9, fontWeight: 700, marginTop: 2 }}>{k.l}</div>
                    </div>
                  ))}
                </div>

                {blocoIncluir()}

                {semHora && (
                  <div style={{ background: C.gold + '15', border: `1px solid ${C.gold}44`, borderRadius: 9, padding: '9px 12px', marginBottom: 10, color: C.gold, fontSize: 11.5, lineHeight: 1.5 }}>
                    ⚠️ Alguém sem <b>valor por hora</b> cadastrado entra como R$ 0,00. Preencha no cadastro da pessoa ou use o cálculo por diária.
                  </div>
                )}

                {pontoRows.map(r => {
                  const h = horasDe(r)
                  const semPonto = !r.checkin
                  const c = calcPonto(r)
                  const jor = r.contratadas ?? (Number(pontoJornada) || null)
                  return (
                    <div key={r.id} style={{ background: C.bg, border: `1px solid ${semPonto ? C.brd : C.grn + '33'}`, borderRadius: 10, padding: '9px 12px', marginBottom: 6, opacity: semPonto ? 0.65 : 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                          <div style={{ color: C.txt, fontSize: 13, fontWeight: 700 }}>
                            {r.nome}
                            {jor && <span style={{ marginLeft: 6, color: C.mut, fontSize: 10, fontWeight: 600 }}>⏱ {jor}h</span>}
                          </div>
                          <div style={{ color: C.mut, fontSize: 10.5 }}>{r.role ?? 'sem função'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ color: C.mut, fontSize: 10 }}>ent</span>
                          <input value={r.entrada} placeholder="--:--" style={tIn}
                            onChange={e => setPontoRows(prev => prev.map(x => x.id === r.id ? { ...x, entrada: e.target.value } : x))}
                            onBlur={e => salvarPonto(r, 'entrada', e.target.value)} />
                          <span style={{ color: C.mut, fontSize: 10 }}>saí</span>
                          <input value={r.saida} placeholder="--:--" style={tIn}
                            onChange={e => setPontoRows(prev => prev.map(x => x.id === r.id ? { ...x, saida: e.target.value } : x))}
                            onBlur={e => salvarPonto(r, 'saida', e.target.value)} />
                        </div>
                        <div style={{ minWidth: 74, textAlign: 'right' as const }}>
                          <div style={{ color: h != null ? C.acc : C.mut, fontSize: 12, fontWeight: 700 }}>
                            {h != null ? `${h.toFixed(2).replace('.', ',')}h` : '—'}
                          </div>
                          {c.nota && <div style={{ color: C.gold, fontSize: 9.5, fontWeight: 600 }}>{c.nota}</div>}
                        </div>
                        <div style={{ minWidth: 96, textAlign: 'right' as const }}>
                          {semPonto
                            ? <span style={{ color: C.mut, fontSize: 11, fontWeight: 600 }}>não veio</span>
                            : <>
                                {/* Editavel: o gestor fecha o valor e e ESTE numero que o
                                    Budget passa a ler. Vazio volta ao calculo automatico. */}
                                <input
                                  value={r.pagoTxt}
                                  placeholder={(liquidoDe(r) / 100).toFixed(2).replace('.', ',')}
                                  inputMode="decimal"
                                  title={r.pago != null ? 'Valor fechado à mão — apague para voltar ao cálculo' : 'Calculado. Digite para fechar outro valor.'}
                                  onChange={e => setPontoRows(prev => prev.map(x => x.id === r.id
                                    ? { ...x, pagoTxt: e.target.value.replace(/[^\d.,]/g, '') } : x))}
                                  onBlur={e => salvarPago(r.id, e.target.value)}
                                  style={{
                                    width: 88, textAlign: 'right', background: r.pago != null ? C.gold + '18' : 'transparent',
                                    border: `1px solid ${r.pago != null ? C.gold + '66' : C.brd}`, borderRadius: 7,
                                    padding: '3px 7px', color: C.gold, fontSize: 13, fontWeight: 800, fontFamily: 'inherit',
                                  }} />
                                {r.pago != null
                                  ? <div style={{ color: C.mut, fontSize: 9.5 }}>fechado à mão</div>
                                  : r.desconto > 0 && (
                                    <div style={{ color: C.mut, fontSize: 9.5, textDecoration: 'line-through' }}>{fmtCurrency(c.cents)}</div>
                                  )}
                              </>}
                        </div>
                        {pontoSaving === r.id && <span style={{ color: C.mut, fontSize: 10 }}>…</span>}
                      </div>

                      {/* Desconto do dia: vale, adiantamento, quebra. Guardado no vínculo do evento. */}
                      {!semPonto && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                          <span style={{ color: C.mut, fontSize: 10, fontWeight: 700 }}>DESC. R$</span>
                          <input value={r.descontoTxt} placeholder="0,00" inputMode="decimal"
                            onChange={e => setPontoRows(prev => prev.map(x => x.id === r.id
                              ? { ...x, descontoTxt: e.target.value.replace(/[^\d.,]/g, '') } : x))}
                            onBlur={e => salvarDesconto(r, 'valor', e.target.value)}
                            style={{ width: 68, background: C.card, border: `1px solid ${r.desconto > 0 ? C.red + '66' : C.brd}`, borderRadius: 7, padding: '4px 7px', color: r.desconto > 0 ? C.red : C.txt, fontSize: 12, fontFamily: 'inherit', textAlign: 'right', boxSizing: 'border-box' }} />
                          {r.desconto > 0 && (
                            <input value={r.motivo} placeholder="motivo (vale, quebra, atraso…)"
                              onChange={e => setPontoRows(prev => prev.map(x => x.id === r.id ? { ...x, motivo: e.target.value } : x))}
                              onBlur={e => salvarDesconto(r, 'motivo', e.target.value)}
                              style={{ flex: '1 1 140px', minWidth: 0, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '4px 8px', color: C.txt, fontSize: 11.5, fontFamily: 'inherit', boxSizing: 'border-box' }} />
                          )}
                          {r.desconto > c.cents && (
                            <span style={{ color: C.red, fontSize: 10, fontWeight: 700 }}>⚠️ maior que o valor — líquido zerado</span>
                          )}
                        </div>
                      )}

                      {/* Chave PIX: é o dado que se usa na hora de pagar, então fica copiável */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, paddingTop: 5, borderTop: `1px solid ${C.brd}66` }}>
                        <span style={{ color: C.mut, fontSize: 10, fontWeight: 700 }}>PIX</span>
                        {r.pix ? (
                          <>
                            <span style={{ color: C.txt, fontSize: 11, fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.pix}</span>
                            <button onClick={() => { navigator.clipboard.writeText(r.pix!); st2('Chave PIX copiada', 'success') }}
                              title="Copiar chave PIX"
                              style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, color: C.mut, fontSize: 10, padding: '2px 7px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>copiar</button>
                          </>
                        ) : (
                          <span style={{ color: C.red, fontSize: 10.5, fontWeight: 600 }}>não cadastrada</span>
                        )}
                      </div>

                      {/* Ponto batido fora do local costuma ser o motivo da correção manual */}
                      {(r.fonteIn === 'manual' || r.fonteOut === 'manual') && (
                        <div style={{ color: C.mut, fontSize: 10, marginTop: 3 }}>✏️ horário ajustado manualmente</div>
                      )}
                    </div>
                  )
                })}

                {totalDesc > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, color: C.mut, fontSize: 12 }}>
                    <span>Bruto</span><span>{fmtCurrency(totalBruto)}</span>
                  </div>
                )}
                {totalDesc > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, color: C.red, fontSize: 12, fontWeight: 600 }}>
                    <span>Descontos</span><span>−{fmtCurrency(totalDesc)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: `2px solid ${C.brd}` }}>
                  <span style={{ color: C.txt, fontSize: 13, fontWeight: 700 }}>
                    Total a pagar · {presentes.length} pessoa(s) · {totalH.toFixed(1).replace('.', ',')}h
                  </span>
                  <span style={{ color: C.gold, fontSize: 18, fontWeight: 900 }}>{fmtCurrency(totalV)}</span>
                </div>

                {/* Rateio por área — mesmo bloco que sai na impressão, para lançar no balanço */}
                {porAreaTela.length > 1 && (
                  <div style={{ marginTop: 14, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ color: C.mut, fontSize: 10, fontWeight: 800, letterSpacing: .5, marginBottom: 7 }}>CUSTO POR ÁREA</div>
                    {porAreaTela.map(a => (
                      <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                        <span style={{ color: C.txt, fontSize: 12, flex: 1, minWidth: 0 }}>{a.label}</span>
                        <span style={{ color: C.mut, fontSize: 10.5 }}>{a.pessoas}p · {a.horas.toFixed(1).replace('.', ',')}h</span>
                        <span style={{ color: C.mut, fontSize: 10.5, minWidth: 32, textAlign: 'right' as const }}>
                          {totalV > 0 ? Math.round((a.liquido / totalV) * 100) : 0}%
                        </span>
                        <span style={{ color: C.gold, fontSize: 12, fontWeight: 700, minWidth: 76, textAlign: 'right' as const }}>{fmtCurrency(a.liquido)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ color: C.mut, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                  Horários em HH:mm. Saída anterior à entrada é tratada como virada de noite (ex: 22:00 → 04:00).
                  As correções salvam sozinhas ao sair do campo.
                </div>
              </div>
            )
          })()}
        </div>
      </Modal>

      {/* Header */}
      <div className="r-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ color: C.txt, fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>👷 Equipe</h1>
          <div style={{ color: C.mut, fontSize: 13, marginTop: 4 }}>{freelancers.filter(f => f.status === 'ativo').length} ativos · {areas.length} áreas</div>
        </div>
        <div className="fr-head-actions" style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={openPonto} variant="secondary" style={{ background: '#f59e0b18', color: '#f59e0b', border: '1px solid #f59e0b44' }}
            title="Conferir o ponto da equipe e fechar a folha de pagamento do evento">📊 Relatórios</Btn>
          <Btn onClick={() => setAreasModal(true)} variant="secondary">⚙️ Administrar áreas</Btn>
          <Btn onClick={openNew} icon="➕">Novo cadastro</Btn>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {([['equipe', '👷 Equipe'], ['avaliacoes', '⭐ Avaliações']] as const).map(([id, label]) => {
          const on = tab === id
          const isRat = id === 'avaliacoes'
          const col = isRat ? '#f59e0b' : C.acc
          return (
            <button key={id} onClick={() => setTab(id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 10, border: `1px solid ${on ? col : C.brd}`, background: on ? col + '22' : 'transparent', color: on ? col : C.mut, fontSize: 14, fontWeight: on ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
              {label}
              {isRat && pending.length > 0 && (
                <span style={{ background: '#f59e0b', color: '#fff', borderRadius: 9, padding: '1px 7px', fontSize: 11, fontWeight: 800, minWidth: 18, textAlign: 'center' }}>{pending.length}</span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'equipe' && <>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '8px 14px', color: C.txt, fontSize: 13, flex: '1 1 200px', fontFamily: 'inherit' }}
          placeholder="🔍 Buscar por nome ou telefone..."
          value={search} onChange={e => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {([['all', 'Todos'], ['freelancer', '👷 Freelancers'], ['funcionario', '🧑‍💼 Funcionários']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setStaffFilter(v)}
              style={{ background: staffFilter === v ? C.acc + '22' : 'transparent', color: staffFilter === v ? C.acc : C.mut, border: `1px solid ${staffFilter === v ? C.acc : C.brd}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: staffFilter === v ? 700 : 400 }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {isMobile ? (
        <div style={{ marginBottom: 18 }}>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', background: C.card, border: `1px solid ${filterType !== 'all' ? C.acc : C.brd}`, borderRadius: 10, padding: '10px 12px', color: filterType !== 'all' ? C.acc : C.txt, fontSize: 14, fontWeight: filterType !== 'all' ? 700 : 400, fontFamily: 'inherit' }}>
            <option value="all">🗂️ Todas as áreas</option>
            {areas.map(a => <option key={a.key} value={a.key}>{a.icon} {a.label}</option>)}
          </select>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
          <button onClick={() => setFilterType('all')}
            style={{ background: filterType === 'all' ? C.acc + '22' : 'transparent', color: filterType === 'all' ? C.acc : C.mut, border: `1px solid ${filterType === 'all' ? C.acc : C.brd}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: filterType === 'all' ? 700 : 400 }}>
            Todas as áreas
          </button>
          {areas.map(a => (
            <button key={a.key} onClick={() => setFilterType(a.key === filterType ? 'all' : a.key)}
              style={{ background: filterType === a.key ? a.color + '22' : 'transparent', color: filterType === a.key ? a.color : C.mut, border: `1px solid ${filterType === a.key ? a.color : C.brd}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: filterType === a.key ? 700 : 400 }}>
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Lista */}
      <Card>
        {filtered.length === 0
          ? <div style={{ color: C.mut, textAlign: 'center', padding: 32 }}>Nenhum cadastro encontrado</div>
          : filtered.map((fr, i) => {
            const isFunc = (fr.staff_type ?? 'freelancer') === 'funcionario'
            // Funcionário = cinza (equipe fixa); Freelancer = azul — diferencia os dois de relance
            const tint = isFunc ? '#94a3b8' : C.acc
            return (
              <div key={fr.id} className="fr-card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 10px', borderRadius: 12, marginBottom: 6, background: isFunc ? '#94a3b80f' : 'transparent', borderLeft: `3px solid ${tint}${isFunc ? '66' : '00'}`, borderBottom: i < filtered.length - 1 ? `1px solid ${C.brd}` : 'none', opacity: fr.status === 'inativo' ? 0.55 : 1 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: tint + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                  {isFunc ? '🧑‍💼' : '👷'}
                </div>
                <div className="fr-info" style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {fr.full_name}
                    <span style={{ background: tint + '22', color: tint, borderRadius: 5, padding: '1px 6px', fontSize: 9, fontWeight: 700 }}>{isFunc ? 'FUNCIONÁRIO' : 'FREELANCER'}</span>
                    {ratings[fr.id] && (
                      <span title={`${ratings[fr.id].count} avaliação(ões)`} style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#f59e0b18', border: '1px solid #f59e0b33', borderRadius: 6, padding: '1px 7px', fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
                        ★ {ratings[fr.id].avg.toFixed(1)}
                        <span style={{ color: C.mut, fontWeight: 400, fontSize: 10 }}>({ratings[fr.id].count})</span>
                      </span>
                    )}
                  </div>
                  <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
                    {fr.phone ? `📱 ${fr.phone}` : ''}{fr.phone && fr.pix_key ? ' · ' : ''}{fr.pix_key ? `💳 PIX: ${fr.pix_key}` : ''}
                    {(() => {
                      const meta = (fr as any).work_meta
                      if (!meta) return null
                      const isFunc = (fr.staff_type ?? 'freelancer') === 'funcionario'
                      if (!isFunc && meta.shift_hours) return <span style={{ marginLeft: fr.phone || fr.pix_key ? 8 : 0, background: C.acc + '18', color: C.acc, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>⏱ {meta.shift_hours}h</span>
                      if (isFunc && (meta.work_entry || meta.work_days?.length)) return <span style={{ marginLeft: 4, color: C.mut, fontSize: 11 }}>{meta.work_entry ? `⏱ ${meta.work_entry}–${meta.work_exit ?? '?'}` : ''}{meta.work_days?.length ? ` · ${meta.work_days.join(', ')}` : ''}</span>
                      return null
                    })()}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {(fr.work_types ?? []).map(wt => {
                      const meta = areaMeta(areas, wt)
                      return (
                        <span key={wt} style={{ background: meta.color + '18', color: meta.color, border: `1px solid ${meta.color}44`, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>
                          {meta.icon} {meta.label}
                        </span>
                      )
                    })}
                  </div>
                </div>
                <div className="fr-rate" style={{ textAlign: 'right', flexShrink: 0 }}>
                  {fr.daily_rate_cents ? (
                    <div style={{ color: C.gold, fontWeight: 700, fontSize: 14 }}>{fmtCurrency(fr.daily_rate_cents)}<span style={{ color: C.mut, fontSize: 10, fontWeight: 400 }}>/dia</span></div>
                  ) : null}
                  <Pill color={fr.status === 'ativo' ? C.grn : C.mut} small>{fr.status}</Pill>
                </div>
                <div className="fr-actions" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {fr.status === 'ativo' && fr.access_token ? (
                    <a href={agendaLink(fr)} target="_blank" rel="noreferrer"
                      title="Ver a agenda de tarefas deste colaborador"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#a78bfa22', color: '#a78bfa', border: '1px solid #a78bfa44', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                      📋 Agenda
                    </a>
                  ) : (
                    <button onClick={() => st2(fr.access_token
                        ? `${fr.full_name.split(' ')[0]} está inativo — a agenda só abre para quem está ativo. Mude o status na ficha.`
                        : 'Recarregue a página para gerar o link da agenda.', 'warn')}
                      title="Colaborador inativo — a agenda não abre"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', color: C.mut, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      📋 Agenda
                    </button>
                  )}
                  {(() => {
                    const d = docDe(fr.id)
                    const cor = d?.status === 'assinado' ? C.grn : d?.status === 'recusado' ? C.red : d ? C.gold : C.mut
                    const rot = d?.status === 'assinado' ? '📄 Termo ✓' : d?.status === 'recusado' ? '📄 Recusou' : d ? '📄 Aguardando' : '📄 Termo'
                    const dica = d?.status === 'assinado'
                      ? `Termo aceito em ${d.signed_at ? new Date(d.signed_at).toLocaleDateString('pt-BR') : ''}${d.signed_method === 'app' ? ' pelo app' : ' em papel'}`
                      : d?.status === 'recusado' ? 'A pessoa não concordou com o termo'
                      : d ? 'Enviado, aguardando resposta no app' : 'Gerar o termo de uso de imagem'
                    return (
                      <button onClick={() => abrirDoc(fr)} title={dica}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: cor + '22', color: cor, border: `1px solid ${cor}44`, borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        {rot}
                      </button>
                    )
                  })()}
                  <button onClick={() => sendAgenda(fr)} disabled={sendingAgenda === fr.id}
                    title="Enviar o link do portal (agenda de tarefas) para o colaborador"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#3b82f622', color: '#3b82f6', border: '1px solid #3b82f644', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: sendingAgenda === fr.id ? 0.6 : 1 }}>
                    {sendingAgenda === fr.id ? '⏳' : '🔗 Portal'}
                  </button>
                  {fr.phone && (
                    <a href={`https://wa.me/55${cn(fr.phone)}`} target="_blank" rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', background: '#25D36622', color: '#25D366', border: '1px solid #25D36644', borderRadius: 8, padding: '6px 10px', fontSize: 12, textDecoration: 'none', fontWeight: 700 }}>
                      💬
                    </a>
                  )}
                  <button onClick={() => toggleSeeAll(fr)}
                    title={fr.can_see_all_events ? 'Vê a agenda de TODOS os eventos da casa — toque para limitar' : 'Vê só os eventos em que está escalado — toque para liberar todos'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: fr.can_see_all_events ? '#a78bfa18' : 'transparent', color: fr.can_see_all_events ? '#a78bfa' : C.mut, border: `1px solid ${fr.can_see_all_events ? '#a78bfa55' : C.brd}`, borderRadius: 8, padding: '6px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', width: 24, height: 13, borderRadius: 7, background: fr.can_see_all_events ? '#a78bfa' : C.brd, position: 'relative', flexShrink: 0 }}>
                      <span style={{ position: 'absolute', top: 2, left: fr.can_see_all_events ? 13 : 2, width: 9, height: 9, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                    </span>
                    📅 Eventos
                  </button>
                  <button onClick={() => toggleDelegate(fr)}
                    title={fr.can_delegate_tasks ? 'Pode enviar tarefas à equipe — toque para desativar' : 'Não pode enviar tarefas — toque para permitir'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: fr.can_delegate_tasks ? '#10b98118' : 'transparent', color: fr.can_delegate_tasks ? '#10b981' : C.mut, border: `1px solid ${fr.can_delegate_tasks ? '#10b98155' : C.brd}`, borderRadius: 8, padding: '6px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', width: 24, height: 13, borderRadius: 7, background: fr.can_delegate_tasks ? '#10b981' : C.brd, position: 'relative', flexShrink: 0 }}>
                      <span style={{ position: 'absolute', top: 2, left: fr.can_delegate_tasks ? 13 : 2, width: 9, height: 9, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                    </span>
                    📤 Tarefas
                  </button>
                  <Btn onClick={() => openShifts(fr)} small variant="secondary"
                    style={{ background: '#22d3ee18', color: '#22d3ee', border: '1px solid #22d3ee44' }}
                    title="Consultar horários de entrada e saída">🕐 Horários</Btn>
                  <Btn onClick={() => openEdit(fr)} small variant="ghost">✏️</Btn>
                  <Btn onClick={() => toggleStatus(fr)} small variant="ghost">{fr.status === 'ativo' ? '⏸' : '▶'}</Btn>
                  <Btn onClick={() => del(fr.id)} small variant="danger">🗑</Btn>
                </div>
              </div>
            )
          })
        }
      </Card>
      </>}

      {/* ── ABA AVALIAÇÕES ── */}
      {tab === 'avaliacoes' && (<>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Btn onClick={() => { setCritForm({ id: '', key: '', label: '' }); setCritModal(true) }} variant="secondary" small>⚙️ Personalizar quesitos</Btn>
        </div>
        {pending.length === 0 ? (
          <Card>
            <div style={{ textAlign: 'center', color: C.mut, padding: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
              <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>Nenhuma avaliação pendente</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Todos os eventos passados já foram avaliados.</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {pending.map(ev => {
              const dateStr = new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
              return (
                <Card key={ev.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {ev.flyer_url
                      ? <img loading="lazy" decoding="async" src={ev.flyer_url} alt={ev.name} style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                      : <div style={{ width: 52, height: 52, borderRadius: 10, background: '#f59e0b22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>📅</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>{ev.name}</div>
                      <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>📅 {dateStr}</div>
                      <div style={{ color: '#f59e0b', fontSize: 12, fontWeight: 600, marginTop: 4 }}>
                        ⭐ {ev.rated}/{ev.total} avaliados · {ev.total - ev.rated} pendente(s)
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Btn onClick={() => openRating(ev)} style={{ background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44' }}>⭐ Avaliar</Btn>
                      <Btn onClick={async () => {
                        if (!confirm('Encerrar avaliações deste evento sem avaliar?')) return
                        // Insere uma avaliação "encerrada" para todos os membros não avaliados
                        const { data: efs } = await supabase.from('event_freelancers').select('freelancer_id').eq('event_id', ev.id)
                        const { data: rts } = await supabase.from('team_ratings').select('freelancer_id').eq('event_id', ev.id)
                        const ratedSet = new Set((rts ?? []).map(r => r.freelancer_id))
                        const toSkip = (efs ?? []).filter(ef => !ratedSet.has(ef.freelancer_id))
                        await Promise.all(toSkip.map(ef => supabase.from('team_ratings').insert({ house_id: house.id, event_id: ev.id, freelancer_id: ef.freelancer_id, rating: 0, comment: 'encerrado sem avaliação' })))
                        loadPending(); st2('Avaliação encerrada')
                      }} variant="ghost" small>✕ Encerrar</Btn>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </>)}

      {/* Modal: Personalizar quesitos de avaliação */}
      <Modal open={critModal} title="⚙️ Quesitos de Avaliação" onClose={() => setCritModal(false)}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 13, color: C.mut }}>Personalize os quesitos usados para avaliar os freelancers (ex: ⚡ Agilidade, 😊 Atendimento). Use um emoji no início para facilitar a leitura.</div>
          {/* Form add/editar */}
          <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12 }}>
            <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>{critForm.id ? 'Editar quesito' : 'Novo quesito'}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={critForm.label} onChange={e => setCritForm(p => ({ ...p, label: e.target.value }))}
                placeholder="Ex: ⚡ Agilidade"
                style={{ flex: 1, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit' }} />
              <Btn onClick={saveCriterion} small>{critForm.id ? 'Salvar' : '➕ Adicionar'}</Btn>
              {critForm.id && <Btn onClick={() => setCritForm({ id: '', key: '', label: '' })} small variant="ghost">Cancelar</Btn>}
            </div>
          </div>
          {/* Lista */}
          <div>
            {criteria.map(c => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brd}22` }}>
                <span style={{ flex: 1, color: C.txt, fontSize: 13, fontWeight: 600 }}>{c.label}</span>
                <button onClick={() => setCritForm({ id: c.id ?? '', key: c.key, label: c.label })} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 6, padding: '4px 8px', color: C.mut, fontSize: 12, cursor: 'pointer' }}>✏️</button>
                <button onClick={() => delCriterion(c)} style={{ background: 'none', border: `1px solid ${C.red}33`, borderRadius: 6, padding: '4px 8px', color: C.red, fontSize: 12, cursor: 'pointer' }}>🗑</button>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Modal de avaliação */}
      <Modal open={!!ratingEv} title={`⭐ Avaliar equipe — ${ratingEv?.name ?? ''}`} onClose={() => setRatingEv(null)} wide>
        {ratingEv && (
          <div style={{ display: 'grid', gap: 12 }}>
            {ratingEntries.length === 0 ? (
              <div style={{ textAlign: 'center', color: C.mut, padding: '24px 0' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👷</div>
                <div>Nenhum membro escalado para este evento.</div>
              </div>
            ) : (
              ratingEntries.map((e, i) => {
                const entryCrit = e.criteria ?? {}
                const criteriaAvg = criteria.length > 0 && criteria.some(c => (entryCrit[c.key] ?? 0) > 0)
                  ? criteria.reduce((s, c) => s + (entryCrit[c.key] ?? 0), 0) / criteria.length
                  : e.rating
                return (
                  <div key={e.freelancer_id} style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <span style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>{e.full_name}</span>
                        {e.role && <span style={{ color: C.mut, fontSize: 11, marginLeft: 8 }}>{e.role}</span>}
                      </div>
                      {criteriaAvg > 0 && (
                        <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16 }}>{'★'.repeat(Math.round(criteriaAvg))} {criteriaAvg.toFixed(1)}</span>
                      )}
                    </div>
                    {/* Quesitos */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                      {criteria.map(cr => (
                        <div key={cr.key}>
                          <div style={{ fontSize: 11, color: C.mut, fontWeight: 600, marginBottom: 3 }}>{cr.label}</div>
                          <div style={{ display: 'flex', gap: 2 }}>
                            {[1,2,3,4,5].map(star => (
                              <button key={star}
                                onClick={() => setRatingEntries(prev => prev.map((r, idx) => idx === i ? { ...r, criteria: { ...(r.criteria ?? {}), [cr.key]: (r.criteria?.[cr.key] ?? 0) === star ? 0 : star } } : r))}
                                style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: star <= (entryCrit[cr.key] ?? 0) ? '#f59e0b' : C.brd, padding: 0, lineHeight: 1 }}>★</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <input
                      value={e.comment}
                      onChange={ev2 => setRatingEntries(prev => prev.map((r, idx) => idx === i ? { ...r, comment: ev2.target.value } : r))}
                      placeholder="Comentário opcional..."
                      style={{ width: '100%', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 7, padding: '6px 10px', color: C.txt, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                  </div>
                )
              })
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
    </div>
  )
}
