import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal, Pill } from '../components/ui'
import { fmtCurrency } from '../utils/format'
import { sT, type ToastState } from '../utils/toast'
import { QuickWA, type QuickWATarget } from '../components/QuickWA'
import { sendWADirect } from '../utils/whatsapp'
import type { House } from '../types'

interface Props { house: House; user: { id: string } }

interface Promoter {
  id: string; full_name: string; phone?: string; email?: string
  commission_pct?: number; notes?: string; house_id: string
  fixed_fee_cents: number; min_entries: number; entry_fee_cents: number; consumacao_cents: number
}

interface PromoterList {
  id: string; name: string; token: string; event_id: string
  fixed_fee_cents: number; min_entries: number; entry_fee_cents: number; consumacao_cents: number
  entry_fee_male_cents?: number; entry_fee_female_cents?: number
  cutoff_exempt?: boolean
  cutoff_time?: string | null; early_male_cents?: number; early_female_cents?: number
  guest_count?: number; checked_count?: number
  events?: { name: string; event_date: string }
}

interface Guest {
  full_name: string; phone?: string; gender?: string; checked_in?: boolean; event_id?: string
}

interface UpcomingEvent { id: string; name: string; event_date: string }

const DEF = { full_name: '', phone: '', email: '', commission_pct: 10, notes: '', fixed_fee_cents: '', min_entries: '', entry_fee_cents: '', consumacao_cents: '' }
const TERMS_DEF = { fixed_fee_cents: '', min_entries: '', entry_fee_male_cents: '', entry_fee_female_cents: '', consumacao_cents: '', cutoff_exempt: false, cutoff_time: '', early_male_cents: '', early_female_cents: '' }

/** Lista fica aberta até 1 dia depois do evento; a partir daí é histórico.
 *  Data local (toISOString devolveria UTC e viraria o dia à noite, no meio da operação). */
function listaAberta(eventDate?: string) {
  if (!eventDate) return true            // sem evento vinculado: não arquiva sozinha
  const d = new Date()
  const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const limite = new Date(eventDate + 'T12:00')
  limite.setDate(limite.getDate() + 1)
  const lim = `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, '0')}-${String(limite.getDate()).padStart(2, '0')}`
  return hoje <= lim
}

function fdateShort(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function PromotersPage({ house }: Props) {
  const [promos, setPromos] = useState<Promoter[]>([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<Record<string, unknown>>(DEF)
  const [editing, setEditing] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [quickWA, setQuickWA] = useState<QuickWATarget | null>(null)
  const [stats, setStats] = useState<Record<string, number>>({})
  const [listCounts, setListCounts] = useState<Record<string, number>>({})
  const [noTable, setNoTable] = useState(false)
  const [ldg, setLdg] = useState(true)

  // ── Listas modal ──
  const [selPr, setSelPr] = useState<Promoter | null>(null)
  const [prLists, setPrLists] = useState<PromoterList[]>([])
  const [loadingLists, setLoadingLists] = useState(false)
  // Listas encerram 1 dia depois do evento: o que passou disso vai para o arquivo,
  // senão o modal acumula dezenas de listas velhas e esconde as que estão em uso.
  const [listaAba, setListaAba] = useState<'abertas' | 'arquivo'>('abertas')
  const [listaBusca, setListaBusca] = useState('')

  // ── Editar termos comerciais ──
  const [editTermsId, setEditTermsId] = useState<string | null>(null)
  const [termsForm, setTermsForm] = useState<{ fixed_fee_cents: string; min_entries: string; entry_fee_male_cents: string; entry_fee_female_cents: string; consumacao_cents: string; cutoff_exempt: boolean; cutoff_time: string; early_male_cents: string; early_female_cents: string }>(TERMS_DEF)

  // ── Ver convidados de uma lista ──
  const [viewGuests, setViewGuests] = useState<PromoterList | null>(null)
  const [guestList, setGuestList] = useState<Guest[]>([])

  // ── Vincular a evento / portal ──
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([])
  const [newListEvent, setNewListEvent] = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [newListMale, setNewListMale] = useState('')
  const [newListFemale, setNewListFemale] = useState('')
  const [newListVip, setNewListVip] = useState(false)
  const [newListNoTime, setNewListNoTime] = useState(false) // VIP sem horário: ignora a virada do evento
  // Virada de horário própria da lista (ex.: VIP até 20:30, depois R$ 20)
  const [newListCut, setNewListCut] = useState('')
  const [newListEarlyM, setNewListEarlyM] = useState('')
  const [newListEarlyF, setNewListEarlyF] = useState('')
  const [sendingPortal, setSendingPortal] = useState<string | null>(null)
  const [portalOn, setPortalOn] = useState<Record<string, boolean>>({})

  function st2(m: string, t?: string) { sT(setToast, m, t as 'success' | 'error' | 'warn') }

  function load() {
    if (!house) return
    supabase.from('promoters').select('*').eq('house_id', house.id).order('full_name')
      .then(r => {
        if (r.error) {
          if (r.error.code === '42P01' || r.error.message.includes('does not exist')) setNoTable(true)
          else st2('Erro: ' + r.error.message, 'error')
          return
        }
        setLdg(false)
        setPromos((r.data ?? []) as Promoter[])
        supabase.from('checkins').select('promoter_id').eq('house_id', house.id).not('promoter_id', 'is', null)
          .then(cr => {
            const counts: Record<string, number> = {}
            ;(cr.data ?? []).forEach(c => { if (c.promoter_id) counts[c.promoter_id] = (counts[c.promoter_id] ?? 0) + 1 })
            setStats(counts)
          })
        // Listas ativas por promoter: vinculadas a eventos de hoje em diante e não cancelados
        const today = new Date().toISOString().slice(0, 10)
        supabase.from('promoter_lists').select('promoter_id,events(event_date,status)').eq('house_id', house.id)
          .then(lr => {
            const lc: Record<string, number> = {}
            ;(lr.data ?? []).forEach((l) => {
              const ev = (l as { promoter_id?: string; events?: { event_date?: string; status?: string } | null }).events
              const pid = (l as { promoter_id?: string }).promoter_id
              if (pid && ev && (ev.event_date ?? '') >= today && ev.status !== 'cancelado') lc[pid] = (lc[pid] ?? 0) + 1
            })
            setListCounts(lc)
          })
        // Estado do portal por promoter (promoter_tokens.active) — sem token = portal nunca enviado
        supabase.from('promoter_tokens').select('promoter_id,active').eq('house_id', house.id)
          .then(tr => {
            const pm: Record<string, boolean> = {}
            ;(tr.data ?? []).forEach(t => { if (t.promoter_id) pm[t.promoter_id as string] = !!t.active })
            setPortalOn(pm)
          })
      })
  }

  // Liga/desliga o acesso ao portal do promoter (o portal já valida promoter_tokens.active)
  async function togglePortal(pr: Promoter) {
    const cur = portalOn[pr.id]
    if (cur === undefined) { st2('Envie o portal primeiro para gerar o acesso.', 'warn'); return }
    const next = !cur
    const { error } = await supabase.from('promoter_tokens').update({ active: next }).eq('promoter_id', pr.id).eq('house_id', house.id)
    if (error) { st2('Erro: ' + error.message, 'error'); return }
    setPortalOn(p => ({ ...p, [pr.id]: next }))
    st2(next ? '✅ Portal ativado' : '🔒 Portal desativado', 'success')
  }

  useEffect(() => { load() }, [house.id])

  async function loadUpcomingEvents() {
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase.from('events')
      .select('id, name, event_date')
      .eq('house_id', house.id).neq('status', 'cancelado').gte('event_date', today)
      .order('event_date', { ascending: true })
    setUpcomingEvents((data ?? []) as UpcomingEvent[])
  }

  async function ensurePromoterToken(pr: Promoter): Promise<string | null> {
    // Reusa o token existente (mesmo se estiver desativado — reenviar o portal reativa,
    // em vez de criar um token duplicado e deixar o antigo órfão)
    const { data: existing } = await supabase.from('promoter_tokens')
      .select('token,active').eq('promoter_id', pr.id).eq('house_id', house.id).limit(1).maybeSingle()
    if (existing?.token) {
      if (!existing.active) await supabase.from('promoter_tokens').update({ active: true }).eq('promoter_id', pr.id).eq('house_id', house.id)
      setPortalOn(p => ({ ...p, [pr.id]: true }))
      return existing.token
    }
    const token = crypto.randomUUID()
    const { error } = await supabase.from('promoter_tokens').insert({ promoter_id: pr.id, house_id: house.id, token, active: true })
    if (error) { st2('Erro ao gerar portal: ' + error.message, 'error'); return null }
    setPortalOn(p => ({ ...p, [pr.id]: true }))
    return token
  }

  async function sendPortal(pr: Promoter) {
    if (!pr.phone) { st2('Promoter sem telefone cadastrado', 'warn'); return }
    setSendingPortal(pr.id)
    const token = await ensurePromoterToken(pr)
    if (!token) { setSendingPortal(null); return }
    const link = `${window.location.origin}/p/${token}`
    const msg = `Olá ${pr.full_name.split(' ')[0]}! 🎭\n\nVocê é promoter de *${house.name || 'nossa casa'}*.\n\nAcesse seu portal para criar e gerenciar suas listas dos eventos:\n${link}\n\n_Este link é pessoal — guarde com você._`
    const r = await sendWADirect(house.id, pr.phone, msg, { type: 'promoter_portal' })
    setSendingPortal(null)
    st2(r.viaApi ? '✅ Portal enviado pela API' : '📲 Abrindo WhatsApp...', 'success')
  }

  async function createListForEvent() {
    if (!selPr || !newListEvent) return
    if (prLists.some(l => l.event_id === newListEvent)) { st2('Este promoter já tem lista neste evento', 'warn'); return }
    setCreatingList(true)
    const token = crypto.randomUUID()
    // Valor por gênero: VIP = entrada gratuita (0); valor informado sobrepõe o padrão do promoter
    const cents = (v: string) => Math.round((parseFloat(v.replace(',', '.')) || 0) * 100)
    const maleCents = newListVip ? 0 : (newListMale.trim() ? cents(newListMale) : (selPr.entry_fee_cents ?? 0))
    const femaleCents = newListVip ? 0 : (newListFemale.trim() ? cents(newListFemale) : (selPr.entry_fee_cents ?? 0))
    const { error } = await supabase.from('promoter_lists').insert({
      promoter_id: selPr.id, house_id: house.id, event_id: newListEvent,
      name: `Lista de ${selPr.full_name}${newListVip ? ' · VIP' : ''}`, token,
      fixed_fee_cents: selPr.fixed_fee_cents ?? 0, min_entries: selPr.min_entries ?? 0,
      entry_fee_cents: maleCents, // mantém valor geral = masculino (compatibilidade)
      entry_fee_male_cents: maleCents, entry_fee_female_cents: femaleCents,
      cutoff_exempt: newListVip && newListNoTime, // VIP sem horário → sempre grátis
      // Virada própria da lista: até o horário cobra early_*, depois cobra entry_fee_*
      cutoff_time: (newListVip && newListNoTime) ? null : (newListCut.trim() || null),
      early_male_cents: newListCut.trim() ? cents(newListEarlyM) : 0,
      early_female_cents: newListCut.trim() ? cents(newListEarlyF) : 0,
      consumacao_cents: selPr.consumacao_cents ?? 0,
    })
    if (error) { setCreatingList(false); st2('Erro: ' + error.message, 'error'); return }

    // Libera este promoter no evento — senão o link público da lista nasce fechado
    // ("Esta lista está fechada"), pois a página pública exige promoter_enabled OU convite.
    const { data: ev } = await supabase.from('events')
      .select('promoter_enabled,promoter_invites').eq('id', newListEvent).single()
    if (ev && !ev.promoter_enabled) {
      const invites: string[] = Array.isArray(ev.promoter_invites) ? ev.promoter_invites : []
      if (!invites.includes(selPr.id)) {
        await supabase.from('events').update({ promoter_invites: [...invites, selPr.id] }).eq('id', newListEvent)
      }
    }

    setCreatingList(false)
    setNewListEvent(''); setNewListMale(''); setNewListFemale(''); setNewListVip(false); setNewListNoTime(false)
    setNewListCut(''); setNewListEarlyM(''); setNewListEarlyF('')
    st2('✅ Lista criada — link liberado para cadastro!', 'success')
    await loadPromoterLists(selPr)
  }

  async function loadPromoterLists(pr: Promoter) {
    setSelPr(pr)
    setPrLists([])
    setLoadingLists(true)
    loadUpcomingEvents()
    const { data } = await supabase
      .from('promoter_lists')
      .select('id, name, token, event_id, fixed_fee_cents, min_entries, entry_fee_cents, entry_fee_male_cents, entry_fee_female_cents, cutoff_exempt, cutoff_time, early_male_cents, early_female_cents, consumacao_cents, events(name, event_date)')
      .eq('promoter_id', pr.id)
      .eq('house_id', house.id)
      .order('created_at', { ascending: false })

    if (!data) { setLoadingLists(false); return }

    const withCounts = await Promise.all(
      (data as unknown as PromoterList[]).map(async l => {
        const [{ count: gCount }, { count: cCount }] = await Promise.all([
          supabase.from('promoter_list_guests').select('id', { count: 'exact', head: true }).eq('list_id', l.id),
          supabase.from('promoter_list_guests').select('id', { count: 'exact', head: true }).eq('list_id', l.id).eq('checked_in', true),
        ])
        return { ...l, guest_count: gCount ?? 0, checked_count: cCount ?? 0 }
      })
    )
    setPrLists(withCounts)
    setLoadingLists(false)
  }

  function openEditTerms(l: PromoterList) {
    setEditTermsId(l.id)
    const male = l.entry_fee_male_cents ?? l.entry_fee_cents ?? 0
    const female = l.entry_fee_female_cents ?? l.entry_fee_cents ?? 0
    setTermsForm({
      fixed_fee_cents: l.fixed_fee_cents > 0 ? (l.fixed_fee_cents / 100).toFixed(2) : '',
      min_entries: l.min_entries > 0 ? String(l.min_entries) : '',
      entry_fee_male_cents: male > 0 ? (male / 100).toFixed(2) : '',
      entry_fee_female_cents: female > 0 ? (female / 100).toFixed(2) : '',
      consumacao_cents: l.consumacao_cents > 0 ? (l.consumacao_cents / 100).toFixed(2) : '',
      cutoff_exempt: l.cutoff_exempt ?? false,
      cutoff_time: l.cutoff_time ?? '',
      early_male_cents: (l.early_male_cents ?? 0) > 0 ? ((l.early_male_cents ?? 0) / 100).toFixed(2) : '',
      early_female_cents: (l.early_female_cents ?? 0) > 0 ? ((l.early_female_cents ?? 0) / 100).toFixed(2) : '',
    })
  }

  async function saveTerms(listId: string) {
    const maleCents = Math.round((parseFloat(termsForm.entry_fee_male_cents) || 0) * 100)
    const femaleCents = Math.round((parseFloat(termsForm.entry_fee_female_cents) || 0) * 100)
    const data = {
      fixed_fee_cents: Math.round((parseFloat(termsForm.fixed_fee_cents) || 0) * 100),
      min_entries: parseInt(termsForm.min_entries) || 0,
      entry_fee_cents: maleCents, // valor geral = masculino (compatibilidade)
      entry_fee_male_cents: maleCents, entry_fee_female_cents: femaleCents,
      consumacao_cents: Math.round((parseFloat(termsForm.consumacao_cents) || 0) * 100),
      cutoff_exempt: !!termsForm.cutoff_exempt,
      // Virada própria: sem horário (ou VIP isento) → limpa
      cutoff_time: termsForm.cutoff_exempt ? null : (termsForm.cutoff_time.trim() || null),
      early_male_cents: termsForm.cutoff_time.trim() ? Math.round((parseFloat(termsForm.early_male_cents) || 0) * 100) : 0,
      early_female_cents: termsForm.cutoff_time.trim() ? Math.round((parseFloat(termsForm.early_female_cents) || 0) * 100) : 0,
    }
    const { error } = await supabase.from('promoter_lists').update(data).eq('id', listId)
    if (error) { st2('Erro: ' + error.message, 'error'); return }
    st2('Termos salvos!', 'success')
    setEditTermsId(null)
    if (selPr) await loadPromoterLists(selPr)
  }

  async function loadGuests(l: PromoterList) {
    setViewGuests(l)
    const { data } = await supabase
      .from('promoter_list_guests')
      .select('full_name, phone, gender, checked_in')
      .eq('list_id', l.id)
      .order('full_name')
    setGuestList((data ?? []) as Guest[])
  }

  function openNew() { setEditing(null); setForm(DEF); setModal(true) }
  function openEdit(pr: Promoter) {
    setEditing(pr.id)
    setForm({
      ...pr,
      fixed_fee_cents: pr.fixed_fee_cents > 0 ? (pr.fixed_fee_cents / 100).toFixed(2) : '',
      min_entries: pr.min_entries > 0 ? String(pr.min_entries) : '',
      entry_fee_cents: pr.entry_fee_cents > 0 ? (pr.entry_fee_cents / 100).toFixed(2) : '',
      consumacao_cents: pr.consumacao_cents > 0 ? (pr.consumacao_cents / 100).toFixed(2) : '',
    })
    setModal(true)
  }
  function setF(k: string, v: unknown) { setForm(p => ({ ...p, [k]: v })) }

  function save() {
    if (!String(form.full_name ?? '').trim()) { st2('Nome obrigatório', 'warn'); return }
    const d = {
      ...form,
      house_id: house.id,
      updated_at: new Date().toISOString(),
      fixed_fee_cents: Math.round((parseFloat(String(form.fixed_fee_cents)) || 0) * 100),
      min_entries: parseInt(String(form.min_entries)) || 0,
      entry_fee_cents: Math.round((parseFloat(String(form.entry_fee_cents)) || 0) * 100),
      consumacao_cents: Math.round((parseFloat(String(form.consumacao_cents)) || 0) * 100),
    }
    const q = editing ? supabase.from('promoters').update(d).eq('id', editing) : supabase.from('promoters').insert(d)
    q.then(r => {
      if (r.error) st2('Erro: ' + r.error.message, 'error')
      else { st2(editing ? 'Atualizado!' : 'Promoter criado!'); setModal(false); load() }
    })
  }

  function del(id: string) {
    if (!confirm('Remover este promoter?')) return
    supabase.from('promoters').delete().eq('id', id)
      .then(r => { if (r.error) st2('Erro: ' + r.error.message, 'error'); else { st2('Removido!'); load() } })
  }

  const inp = { style: { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const } }
  const SL: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', minHeight: 40 }

  if (noTable) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
      <div style={{ color: C.txt, fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Tabela de Promoters não encontrada</div>
      <div style={{ color: C.mut, fontSize: 13 }}>Crie a tabela <code>promoters</code> no Supabase para ativar este módulo.</div>
    </div>
  )

  if (ldg) return <div style={{ padding: 60, textAlign: 'center', color: C.mut }}>Carregando...</div>

  return (
    <div style={{ paddingBottom: 40 }}>
      <Toast toast={toast} />
      <QuickWA houseId={house.id} target={quickWA} onClose={() => setQuickWA(null)} onSent={via => sT(setToast, via ? '✅ Mensagem enviada pela API' : '📲 Abrindo WhatsApp...', 'success')} />

      {/* ── Modal Promoter form ── */}
      <Modal open={modal} title={editing ? 'Editar Promoter' : 'Novo Promoter'} onClose={() => { setModal(false); setEditing(null) }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nome *</label>
            <input {...inp} value={String(form.full_name ?? '')} onChange={e => setF('full_name', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Telefone WhatsApp</label>
            <input {...inp} value={String(form.phone ?? '')} onChange={e => setF('phone', e.target.value)} placeholder="(11) 99999-9999" />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>E-mail</label>
            <input type="email" {...inp} value={String(form.email ?? '')} onChange={e => setF('email', e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Comissão %</label>
            <input type="number" min="0" max="100" {...inp} value={String(form.commission_pct ?? 10)} onChange={e => setF('commission_pct', e.target.value)} />
          </div>
          {/* Termos comerciais */}
          <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 14 }}>
            <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 12 }}>TERMOS COMERCIAIS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>💰 VALOR FIXO (R$)</label>
                <input type="number" step="0.01" min="0" {...inp} value={String(form.fixed_fee_cents ?? '')} onChange={e => setF('fixed_fee_cents', e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🎫 QTD MÍN. ENTRADAS</label>
                <input type="number" min="0" {...inp} value={String(form.min_entries ?? '')} onChange={e => setF('min_entries', e.target.value)} placeholder="0" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🚪 VALOR POR ENTRADA (R$)</label>
                <input type="number" step="0.01" min="0" {...inp} value={String(form.entry_fee_cents ?? '')} onChange={e => setF('entry_fee_cents', e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🍺 CONSUMAÇÃO (R$/pessoa)</label>
                <input type="number" step="0.01" min="0" {...inp} value={String(form.consumacao_cents ?? '')} onChange={e => setF('consumacao_cents', e.target.value)} placeholder="0,00" />
              </div>
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Observações</label>
            <textarea {...inp} style={{ ...inp.style, height: 70, resize: 'vertical' }} value={String(form.notes ?? '')} onChange={e => setF('notes', e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={save} style={{ flex: 1 }}>💾 Salvar</Btn>
            <Btn onClick={() => { setModal(false); setEditing(null) }} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      </Modal>

      {/* ── Modal Listas do Promoter ── */}
      <Modal open={!!selPr && !viewGuests} title={`📋 Listas — ${selPr?.full_name ?? ''}`} onClose={() => { setSelPr(null); setPrLists([]); setEditTermsId(null); setNewListEvent(''); setNewListMale(''); setNewListFemale(''); setNewListVip(false) }} wide>
        {/* Vincular a evento + enviar portal */}
        {selPr && (
          <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 10 }}>🔗 VINCULAR A UM EVENTO</div>
            {(() => {
              const available = upcomingEvents.filter(ev => !prLists.some(l => l.event_id === ev.id))
              return (
                <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={newListEvent} onChange={e => setNewListEvent(e.target.value)} style={{ ...SL, flex: '1 1 220px' }}>
                    <option value="">{available.length ? 'Selecione um evento…' : 'Nenhum evento futuro disponível'}</option>
                    {available.map(ev => <option key={ev.id} value={ev.id}>{ev.name} · {fdateShort(ev.event_date)}</option>)}
                  </select>
                  <input type="number" step="0.01" min="0" inputMode="decimal"
                    value={newListVip ? '' : newListMale}
                    onChange={e => setNewListMale(e.target.value)}
                    disabled={newListVip}
                    placeholder={selPr.entry_fee_cents ? `♂ padrão R$ ${(selPr.entry_fee_cents / 100).toFixed(2)}` : '♂ Masc R$'}
                    title="Valor de entrada masculino (vazio = usa o padrão do promoter)"
                    style={{ ...SL, flex: '0 1 130px', opacity: newListVip ? 0.5 : 1, borderColor: '#60a5fa55' }} />
                  <input type="number" step="0.01" min="0" inputMode="decimal"
                    value={newListVip ? '' : newListFemale}
                    onChange={e => setNewListFemale(e.target.value)}
                    disabled={newListVip}
                    placeholder={selPr.entry_fee_cents ? `♀ padrão R$ ${(selPr.entry_fee_cents / 100).toFixed(2)}` : '♀ Fem R$'}
                    title="Valor de entrada feminino (vazio = usa o padrão do promoter)"
                    style={{ ...SL, flex: '0 1 130px', opacity: newListVip ? 0.5 : 1, borderColor: '#f472b655' }} />
                  <button type="button" onClick={() => setNewListVip(v => { if (v) setNewListNoTime(false); return !v })}
                    title="VIP / Cortesia — entrada gratuita"
                    style={{ flexShrink: 0, padding: '0 14px', height: 40, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 800, border: `2px solid ${newListVip ? C.gold : C.brd}`, background: newListVip ? C.gold + '22' : 'transparent', color: newListVip ? C.gold : C.mut }}>
                    ⭐ VIP
                  </button>
                  {newListVip && (
                    <button type="button" onClick={() => setNewListNoTime(v => !v)}
                      title="Sempre grátis — ignora a virada de preço do evento"
                      style={{ flexShrink: 0, padding: '0 12px', height: 40, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 800, border: `2px solid ${newListNoTime ? C.grn : C.brd}`, background: newListNoTime ? C.grn + '22' : 'transparent', color: newListNoTime ? C.grn : C.mut }}>
                      {newListNoTime ? '✅ Sem horário' : '⏰ Sem horário'}
                    </button>
                  )}
                  <Btn onClick={createListForEvent} disabled={!newListEvent || creatingList}>{creatingList ? 'Criando...' : '➕ Criar lista'}</Btn>
                </div>
                {/* Virada de horário da lista: até HH:MM cobra um valor, depois cobra outro */}
                {!(newListVip && newListNoTime) && (
                  <div style={{ marginTop: 10, background: 'var(--c-panel)', border: `1px solid ${C.brd}`, borderRadius: 10, padding: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 2 }}>⏰ Horário da lista (opcional)</div>
                    <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>
                      Ex.: <b>VIP até 20:30</b> (deixe 0) e depois cobra os valores ♂/♀ acima. Em branco = sem virada.
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input type="time" value={newListCut} onChange={e => setNewListCut(e.target.value)}
                        title="Horário da virada" style={{ ...SL, flex: '0 1 130px' }} />
                      <input type="number" step="0.01" min="0" inputMode="decimal" value={newListEarlyM}
                        onChange={e => setNewListEarlyM(e.target.value)} disabled={!newListCut}
                        placeholder="♂ até o horário (0 = grátis)"
                        style={{ ...SL, flex: '1 1 150px', opacity: newListCut ? 1 : 0.5, borderColor: '#60a5fa55' }} />
                      <input type="number" step="0.01" min="0" inputMode="decimal" value={newListEarlyF}
                        onChange={e => setNewListEarlyF(e.target.value)} disabled={!newListCut}
                        placeholder="♀ até o horário (0 = grátis)"
                        style={{ ...SL, flex: '1 1 150px', opacity: newListCut ? 1 : 0.5, borderColor: '#f472b655' }} />
                    </div>
                  </div>
                )}
                <div style={{ color: C.mut, fontSize: 11, marginTop: 6 }}>
                  💡 Defina valores <strong style={{ color: '#60a5fa' }}>♂ masculino</strong> e <strong style={{ color: '#f472b6' }}>♀ feminino</strong> para esta lista, ou marque <strong style={{ color: C.gold }}>⭐ VIP</strong> para entrada gratuita. Vazio usa o valor padrão do promoter.
                </div>
                </>
              )
            })()}
            {selPr.phone && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.brd}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, color: C.mut, fontSize: 12 }}>Envie ao promoter o portal para ele criar/gerenciar as listas e compartilhar com os convidados.</span>
                <Btn onClick={() => sendPortal(selPr)} disabled={sendingPortal === selPr.id} style={{ background: '#25D36622', color: '#25D366', border: '1px solid #25D36644' }}>
                  {sendingPortal === selPr.id ? 'Enviando...' : '📲 Enviar portal ao promoter'}
                </Btn>
              </div>
            )}
          </div>
        )}
        {(() => {
          const abertas = prLists.filter(l => listaAberta((l.events as { event_date?: string } | undefined)?.event_date))
          const arquivo = prLists.filter(l => !listaAberta((l.events as { event_date?: string } | undefined)?.event_date))
          if (loadingLists || prLists.length === 0) return null
          return (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {([['abertas', `🟢 Abertas (${abertas.length})`], ['arquivo', `📦 Arquivo (${arquivo.length})`]] as const).map(([v, lb]) => (
                <button key={v} onClick={() => setListaAba(v)}
                  style={{ padding: '6px 14px', borderRadius: 9, border: `1px solid ${listaAba === v ? C.acc : C.brd}`, background: listaAba === v ? C.acc + '22' : 'transparent', color: listaAba === v ? C.acc : C.mut, fontSize: 12.5, fontWeight: listaAba === v ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {lb}
                </button>
              ))}
              {listaAba === 'arquivo' && (
                <input value={listaBusca} onChange={e => setListaBusca(e.target.value)}
                  placeholder="🔎 Buscar por evento…"
                  style={{ flex: '1 1 160px', minWidth: 0, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 9, padding: '7px 11px', color: C.txt, fontSize: 12.5, fontFamily: 'inherit', boxSizing: 'border-box' }} />
              )}
            </div>
          )
        })()}

        {loadingLists
          ? <div style={{ color: C.mut, textAlign: 'center', padding: 24 }}>Carregando...</div>
          : prLists.length === 0
            ? <div style={{ color: C.mut, textAlign: 'center', padding: 24 }}>Nenhuma lista criada por este promoter</div>
            : (() => {
              const q = listaBusca.trim().toLowerCase()
              const visiveis = prLists
                .filter(l => listaAberta((l.events as { event_date?: string } | undefined)?.event_date) === (listaAba === 'abertas'))
                .filter(l => !q || `${(l.events as { name?: string } | undefined)?.name ?? ''} ${l.name}`.toLowerCase().includes(q))
              if (visiveis.length === 0) return (
                <div style={{ color: C.mut, textAlign: 'center', padding: 24, fontSize: 13, lineHeight: 1.6 }}>
                  {listaAba === 'abertas'
                    ? <>Nenhuma lista aberta.<br />As listas de eventos já passados estão em <b style={{ color: C.txt }}>📦 Arquivo</b>.</>
                    : q ? 'Nenhuma lista encontrada com esse termo.' : 'Nenhuma lista arquivada ainda.'}
                </div>
              )
              return visiveis.map(l => {
              const ev = l.events as { name: string; event_date: string } | undefined
              const isEditing = editTermsId === l.id
              const totalBudget = l.fixed_fee_cents + (l.min_entries * l.entry_fee_cents) + (l.min_entries * l.consumacao_cents)

              return (
                <div key={l.id} style={{ border: `1px solid ${C.brd}`, borderRadius: 14, padding: 16, marginBottom: 12 }}>
                  {/* Header da lista */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>{ev?.name ?? 'Evento'}</div>
                      <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
                        {ev?.event_date ? `📅 ${fdateShort(ev.event_date)}` : ''}
                        <span style={{ marginLeft: 10 }}>👥 {l.guest_count} convidados · ✅ {l.checked_count} presentes</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn onClick={() => loadGuests(l)} small variant="secondary">👥 Ver lista</Btn>
                      <Btn onClick={() => isEditing ? setEditTermsId(null) : openEditTerms(l)} small variant="ghost">
                        {isEditing ? 'Cancelar' : '✏️ Termos'}
                      </Btn>
                    </div>
                  </div>

                  {/* Termos comerciais — visualização */}
                  {!isEditing && (() => {
                    const maleCents = l.entry_fee_male_cents ?? l.entry_fee_cents ?? 0
                    const femaleCents = l.entry_fee_female_cents ?? l.entry_fee_cents ?? 0
                    const isVip = maleCents === 0 && femaleCents === 0
                    return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                      {[
                        { icon: '💰', label: 'Valor Fixo', val: l.fixed_fee_cents },
                        { icon: '🎫', label: 'Mín. Entradas', val: null, raw: l.min_entries > 0 ? `${l.min_entries} pessoas` : '—' },
                        { icon: '🍺', label: 'Consumação', val: l.consumacao_cents },
                      ].map(item => (
                        <div key={item.label} style={{ background: C.bg, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                          <div style={{ fontSize: 18, marginBottom: 4 }}>{item.icon}</div>
                          <div style={{ color: C.mut, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', marginBottom: 2 }}>{item.label.toUpperCase()}</div>
                          <div style={{ color: item.val != null && item.val > 0 ? C.gold : C.mut, fontWeight: 700, fontSize: 13 }}>
                            {item.raw ?? (item.val! > 0 ? fmtCurrency(item.val!) : '—')}
                          </div>
                        </div>
                      ))}
                      {/* Card de entrada ♂/♀ */}
                      <div style={{ background: C.bg, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 18, marginBottom: 4 }}>{isVip ? '⭐' : '🚪'}</div>
                        <div style={{ color: C.mut, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', marginBottom: 2 }}>ENTRADA</div>
                        {l.cutoff_time
                          ? <div style={{ lineHeight: 1.25 }}>
                              <div style={{ color: C.grn, fontWeight: 800, fontSize: 11 }}>até {l.cutoff_time}</div>
                              <div style={{ color: '#60a5fa', fontSize: 11, fontWeight: 700 }}>♂ {(l.early_male_cents ?? 0) > 0 ? fmtCurrency(l.early_male_cents ?? 0) : 'Grátis'}</div>
                              <div style={{ color: '#f472b6', fontSize: 11, fontWeight: 700 }}>♀ {(l.early_female_cents ?? 0) > 0 ? fmtCurrency(l.early_female_cents ?? 0) : 'Grátis'}</div>
                              <div style={{ color: C.mut, fontSize: 9, marginTop: 2 }}>depois ♂ {fmtCurrency(maleCents)} · ♀ {fmtCurrency(femaleCents)}</div>
                            </div>
                          : isVip
                          ? <div style={{ color: C.gold, fontWeight: 800, fontSize: 13 }}>VIP · Grátis{l.cutoff_exempt ? <span style={{ display: 'block', color: C.grn, fontSize: 10, fontWeight: 700 }}>sem horário</span> : null}</div>
                          : <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.2 }}>
                              <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 12 }}>♂ {maleCents > 0 ? fmtCurrency(maleCents) : 'Grátis'}</span>
                              <span style={{ color: '#f472b6', fontWeight: 700, fontSize: 12 }}>♀ {femaleCents > 0 ? fmtCurrency(femaleCents) : 'Grátis'}</span>
                            </div>}
                      </div>
                    </div>
                    )
                  })()}

                  {/* Total estimado */}
                  {!isEditing && totalBudget > 0 && (
                    <div style={{ marginTop: 10, background: C.gold + '12', border: `1px solid ${C.gold}33`, borderRadius: 10, padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: C.gold, fontSize: 12, fontWeight: 600 }}>💼 Custo estimado (base mín. entradas)</span>
                      <span style={{ color: C.gold, fontWeight: 800, fontSize: 14 }}>{fmtCurrency(totalBudget)}</span>
                    </div>
                  )}

                  {/* Formulário edição de termos */}
                  {isEditing && (
                    <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 12, padding: 14 }}>
                      <div style={{ color: C.sub, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 12 }}>TERMOS COMERCIAIS</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                        <div>
                          <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>💰 VALOR FIXO (R$)</label>
                          <input type="number" step="0.01" min="0" value={termsForm.fixed_fee_cents}
                            onChange={e => setTermsForm(p => ({ ...p, fixed_fee_cents: e.target.value }))}
                            placeholder="0,00" style={SL} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🎫 QTD MÍNIMA DE ENTRADAS</label>
                          <input type="number" min="0" value={termsForm.min_entries}
                            onChange={e => setTermsForm(p => ({ ...p, min_entries: e.target.value }))}
                            placeholder="0" style={SL} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: '#60a5fa', fontWeight: 600, display: 'block', marginBottom: 4 }}>♂ ENTRADA MASCULINO (R$)</label>
                          <input type="number" step="0.01" min="0" value={termsForm.entry_fee_male_cents}
                            onChange={e => setTermsForm(p => ({ ...p, entry_fee_male_cents: e.target.value }))}
                            placeholder="0,00" style={{ ...SL, borderColor: '#60a5fa55' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: '#f472b6', fontWeight: 600, display: 'block', marginBottom: 4 }}>♀ ENTRADA FEMININO (R$)</label>
                          <input type="number" step="0.01" min="0" value={termsForm.entry_fee_female_cents}
                            onChange={e => setTermsForm(p => ({ ...p, entry_fee_female_cents: e.target.value }))}
                            placeholder="0,00" style={{ ...SL, borderColor: '#f472b655' }} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🍺 CONSUMAÇÃO (R$/pessoa)</label>
                          <input type="number" step="0.01" min="0" value={termsForm.consumacao_cents}
                            onChange={e => setTermsForm(p => ({ ...p, consumacao_cents: e.target.value }))}
                            placeholder="0,00" style={SL} />
                        </div>
                      </div>
                      {/* Virada de horário desta lista */}
                      {!termsForm.cutoff_exempt && (
                        <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 10, marginBottom: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.txt, marginBottom: 2 }}>⏰ Horário desta lista</div>
                          <div style={{ fontSize: 11, color: C.mut, marginBottom: 8 }}>
                            Até o horário cobra os valores abaixo (0 = grátis/VIP); depois cobra a <b>entrada ♂/♀</b> acima.
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 8 }}>
                            <div>
                              <label style={{ fontSize: 10, color: C.mut, fontWeight: 700 }}>VIRADA</label>
                              <input type="time" value={termsForm.cutoff_time}
                                onChange={e => setTermsForm(p => ({ ...p, cutoff_time: e.target.value }))} style={SL} />
                            </div>
                            <div>
                              <label style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700 }}>♂ ATÉ O HORÁRIO</label>
                              <input type="number" step="0.01" min="0" value={termsForm.early_male_cents} disabled={!termsForm.cutoff_time}
                                onChange={e => setTermsForm(p => ({ ...p, early_male_cents: e.target.value }))}
                                placeholder="0 = grátis" style={{ ...SL, opacity: termsForm.cutoff_time ? 1 : 0.5, borderColor: '#60a5fa55' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: 10, color: '#f472b6', fontWeight: 700 }}>♀ ATÉ O HORÁRIO</label>
                              <input type="number" step="0.01" min="0" value={termsForm.early_female_cents} disabled={!termsForm.cutoff_time}
                                onChange={e => setTermsForm(p => ({ ...p, early_female_cents: e.target.value }))}
                                placeholder="0 = grátis" style={{ ...SL, opacity: termsForm.cutoff_time ? 1 : 0.5, borderColor: '#f472b655' }} />
                            </div>
                          </div>
                        </div>
                      )}
                      {/* VIP sem horário: ignora a virada de preço do evento */}
                      <button type="button" onClick={() => setTermsForm(p => ({ ...p, cutoff_exempt: !p.cutoff_exempt }))}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 10, marginBottom: 12, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', border: `2px solid ${termsForm.cutoff_exempt ? C.grn : C.brd}`, background: termsForm.cutoff_exempt ? C.grn + '18' : 'transparent' }}>
                        <span>
                          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: termsForm.cutoff_exempt ? C.grn : C.txt }}>⭐ VIP sem horário (sempre grátis)</span>
                          <span style={{ display: 'block', fontSize: 11, color: C.mut, marginTop: 2 }}>Ignora a virada de preço do evento — esta lista nunca passa a cobrar.</span>
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 18 }}>{termsForm.cutoff_exempt ? '✅' : '⬜'}</span>
                      </button>
                      {/* Preview do custo estimado */}
                      {(() => {
                        const fixo = Math.round((parseFloat(termsForm.fixed_fee_cents) || 0) * 100)
                        const minEnt = parseInt(termsForm.min_entries) || 0
                        const male = Math.round((parseFloat(termsForm.entry_fee_male_cents) || 0) * 100)
                        const female = Math.round((parseFloat(termsForm.entry_fee_female_cents) || 0) * 100)
                        // média ♂/♀ como base de estimativa por entrada
                        const porEnt = male && female ? Math.round((male + female) / 2) : (male || female)
                        const cons = Math.round((parseFloat(termsForm.consumacao_cents) || 0) * 100)
                        const tot = fixo + minEnt * porEnt + minEnt * cons
                        if (tot === 0) return null
                        return (
                          <div style={{ background: C.gold + '12', border: `1px solid ${C.gold}33`, borderRadius: 10, padding: '8px 14px', marginBottom: 10 }}>
                            <div style={{ color: C.gold, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Custo estimado (mín. {minEnt} entradas):</div>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: C.mut }}>
                              {fixo > 0 && <span>Fixo: <b style={{ color: C.gold }}>{fmtCurrency(fixo)}</b></span>}
                              {minEnt > 0 && porEnt > 0 && <span>Entradas: <b style={{ color: C.gold }}>{fmtCurrency(minEnt * porEnt)}</b></span>}
                              {minEnt > 0 && cons > 0 && <span>Consumação: <b style={{ color: C.gold }}>{fmtCurrency(minEnt * cons)}</b></span>}
                            </div>
                            <div style={{ color: C.gold, fontWeight: 800, fontSize: 14, marginTop: 6 }}>Total: {fmtCurrency(tot)}</div>
                          </div>
                        )
                      })()}
                      <Btn onClick={() => saveTerms(l.id)} style={{ width: '100%' }}>💾 Salvar termos</Btn>
                    </div>
                  )}
                </div>
              )
              })
            })()
        }
      </Modal>

      {/* ── Modal Convidados de uma lista ── */}
      <Modal open={!!viewGuests} title={`👥 ${viewGuests?.events ? (viewGuests.events as { name: string }).name : 'Lista'}`} onClose={() => { setViewGuests(null); setGuestList([]) }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: C.mut, fontSize: 12 }}>{guestList.length} convidados</span>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ color: C.grn, fontSize: 12, fontWeight: 600 }}>{guestList.filter(g => g.checked_in).length} presentes</span>
            <span style={{ color: C.mut, fontSize: 12 }}>{guestList.filter(g => !g.checked_in).length} pendentes</span>
          </div>
        </div>
        {guestList.length === 0
          ? <p style={{ color: C.mut, textAlign: 'center', padding: 20 }}>Nenhum convidado na lista</p>
          : guestList.map((g, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.brd}` }}>
              <span style={{ color: g.checked_in ? C.grn : C.txt, fontSize: 13, flex: 1 }}>{g.full_name}</span>
              <span style={{ color: C.mut, fontSize: 12, width: 20, textAlign: 'center' }}>{g.gender === 'M' ? '♂' : g.gender === 'F' ? '♀' : ''}</span>
              {g.phone && <span style={{ color: C.mut, fontSize: 12 }}>{g.phone}</span>}
              <span style={{ color: g.checked_in ? C.grn : C.mut, fontSize: 13, width: 20, textAlign: 'center' }}>{g.checked_in ? '✓' : '—'}</span>
            </div>
          ))
        }
        <div style={{ marginTop: 14 }}>
          <Btn onClick={() => { setViewGuests(null) }} variant="ghost" style={{ width: '100%' }}>← Voltar às listas</Btn>
        </div>
      </Modal>

      {/* ── Header ── */}
      <div className="r-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ color: C.txt, fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>📋 Promoters</h1>
        <Btn onClick={openNew} icon="➕">Novo Promoter</Btn>
      </div>

      <Card>
        {promos.length === 0
          ? <div style={{ color: C.mut, textAlign: 'center', padding: 20 }}>Nenhum promoter cadastrado</div>
          : promos.map((pr, i) => (
            <div key={pr.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 0', borderBottom: i < promos.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
              {/* Avatar */}
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: C.acc + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                📋
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.txt, fontWeight: 700, fontSize: 14 }}>{pr.full_name}</div>
                <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
                  {pr.phone ? `📱 ${pr.phone}` : ''}
                  {pr.phone && pr.email ? ' · ' : ''}
                  {pr.email ? `✉️ ${pr.email}` : ''}
                </div>
                {(pr.fixed_fee_cents > 0 || pr.min_entries > 0 || pr.entry_fee_cents > 0 || pr.consumacao_cents > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {pr.fixed_fee_cents > 0 && <span style={{ background: C.gold+'18', color: C.gold, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>💰 {fmtCurrency(pr.fixed_fee_cents)}</span>}
                    {pr.min_entries > 0 && <span style={{ background: C.acc+'18', color: C.acc, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>🎫 {pr.min_entries} mín.</span>}
                    {pr.entry_fee_cents > 0 && <span style={{ background: C.acc+'18', color: C.acc, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>🚪 {fmtCurrency(pr.entry_fee_cents)}/ent.</span>}
                    {pr.consumacao_cents > 0 && <span style={{ background: C.grn+'18', color: C.grn, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>🍺 {fmtCurrency(pr.consumacao_cents)}/pess.</span>}
                  </div>
                )}
              </div>
              {/* Stats */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ color: C.grn, fontWeight: 700, fontSize: 18 }}>{stats[pr.id] ?? 0}</div>
                <div style={{ color: C.mut, fontSize: 10, marginBottom: 4 }}>check-ins</div>
                <div style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>📋 {listCounts[pr.id] ?? 0}</div>
                <div style={{ color: C.mut, fontSize: 10, marginBottom: 4 }}>lista{(listCounts[pr.id] ?? 0) !== 1 ? 's' : ''} ativa{(listCounts[pr.id] ?? 0) !== 1 ? 's' : ''}</div>
                <Pill color={C.acc} small>{pr.commission_pct ?? 10}%</Pill>
              </div>
              {/* Ações */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {pr.phone && (
                  <button onClick={() => setQuickWA({ name: pr.full_name, phone: pr.phone! })}
                    style={{ display: 'inline-flex', alignItems: 'center', background: '#25D36622', color: '#25D366', border: '1px solid #25D36644', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>
                    💬
                  </button>
                )}
                {pr.phone && (
                  <Btn onClick={() => sendPortal(pr)} small variant="secondary" disabled={sendingPortal === pr.id}
                    style={{ background: '#7c3aed22', color: '#a78bfa', border: '1px solid #7c3aed44' }} title="Enviar portal do promoter pelo WhatsApp">
                    {sendingPortal === pr.id ? '...' : '📲 Portal'}
                  </Btn>
                )}
                {/* Toggle de acesso ao portal (só aparece depois que o portal foi gerado) */}
                {portalOn[pr.id] !== undefined && (() => {
                  const on = portalOn[pr.id]
                  return (
                    <button onClick={() => togglePortal(pr)}
                      title={on ? 'Portal ativo — toque para desativar o acesso' : 'Portal desativado — toque para reativar'}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: on ? '#10b98118' : 'transparent', color: on ? '#10b981' : C.mut, border: `1px solid ${on ? '#10b98155' : C.brd}`, borderRadius: 8, padding: '6px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', width: 24, height: 13, borderRadius: 7, background: on ? '#10b981' : C.brd, position: 'relative', flexShrink: 0 }}>
                        <span style={{ position: 'absolute', top: 2, left: on ? 13 : 2, width: 9, height: 9, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                      </span>
                      {on ? 'Ativo' : 'Inativo'}
                    </button>
                  )
                })()}
                <Btn onClick={() => openEdit(pr)} small variant="ghost">✏️</Btn>
                <Btn onClick={() => loadPromoterLists(pr)} small variant="secondary">📋 Listas</Btn>
                <Btn onClick={() => del(pr.id)} small variant="danger">🗑️</Btn>
              </div>
            </div>
          ))
        }
      </Card>
    </div>
  )
}
