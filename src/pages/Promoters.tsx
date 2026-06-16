import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal, Pill } from '../components/ui'
import { fmtCurrency } from '../utils/format'
import { sT, type ToastState } from '../utils/toast'
import { QuickWA, type QuickWATarget } from '../components/QuickWA'
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
  guest_count?: number; checked_count?: number
  events?: { name: string; event_date: string }
}

interface Guest {
  full_name: string; phone?: string; gender?: string; checked_in?: boolean; event_id?: string
}

const DEF = { full_name: '', phone: '', email: '', commission_pct: 10, notes: '', fixed_fee_cents: '', min_entries: '', entry_fee_cents: '', consumacao_cents: '' }
const TERMS_DEF = { fixed_fee_cents: '', min_entries: '', entry_fee_cents: '', consumacao_cents: '' }

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
  const [noTable, setNoTable] = useState(false)
  const [ldg, setLdg] = useState(true)

  // ── Listas modal ──
  const [selPr, setSelPr] = useState<Promoter | null>(null)
  const [prLists, setPrLists] = useState<PromoterList[]>([])
  const [loadingLists, setLoadingLists] = useState(false)

  // ── Editar termos comerciais ──
  const [editTermsId, setEditTermsId] = useState<string | null>(null)
  const [termsForm, setTermsForm] = useState<Record<string, string>>(TERMS_DEF)

  // ── Ver convidados de uma lista ──
  const [viewGuests, setViewGuests] = useState<PromoterList | null>(null)
  const [guestList, setGuestList] = useState<Guest[]>([])

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
      })
  }

  useEffect(() => { load() }, [house.id])

  async function loadPromoterLists(pr: Promoter) {
    setSelPr(pr)
    setPrLists([])
    setLoadingLists(true)
    const { data } = await supabase
      .from('promoter_lists')
      .select('id, name, token, event_id, fixed_fee_cents, min_entries, entry_fee_cents, consumacao_cents, events(name, event_date)')
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
    setTermsForm({
      fixed_fee_cents: l.fixed_fee_cents > 0 ? (l.fixed_fee_cents / 100).toFixed(2) : '',
      min_entries: l.min_entries > 0 ? String(l.min_entries) : '',
      entry_fee_cents: l.entry_fee_cents > 0 ? (l.entry_fee_cents / 100).toFixed(2) : '',
      consumacao_cents: l.consumacao_cents > 0 ? (l.consumacao_cents / 100).toFixed(2) : '',
    })
  }

  async function saveTerms(listId: string) {
    const data = {
      fixed_fee_cents: Math.round((parseFloat(termsForm.fixed_fee_cents) || 0) * 100),
      min_entries: parseInt(termsForm.min_entries) || 0,
      entry_fee_cents: Math.round((parseFloat(termsForm.entry_fee_cents) || 0) * 100),
      consumacao_cents: Math.round((parseFloat(termsForm.consumacao_cents) || 0) * 100),
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
                <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🎟️ QTD MÍN. ENTRADAS</label>
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
      <Modal open={!!selPr && !viewGuests} title={`📋 Listas — ${selPr?.full_name ?? ''}`} onClose={() => { setSelPr(null); setPrLists([]); setEditTermsId(null) }} wide>
        {loadingLists
          ? <div style={{ color: C.mut, textAlign: 'center', padding: 24 }}>Carregando...</div>
          : prLists.length === 0
            ? <div style={{ color: C.mut, textAlign: 'center', padding: 24 }}>Nenhuma lista criada por este promoter</div>
            : prLists.map(l => {
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
                  {!isEditing && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                      {[
                        { icon: '💰', label: 'Valor Fixo', val: l.fixed_fee_cents },
                        { icon: '🎟️', label: 'Mín. Entradas', val: null, raw: l.min_entries > 0 ? `${l.min_entries} pessoas` : '—' },
                        { icon: '🚪', label: 'Valor/Entrada', val: l.entry_fee_cents },
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
                    </div>
                  )}

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
                          <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🎟️ QTD MÍNIMA DE ENTRADAS</label>
                          <input type="number" min="0" value={termsForm.min_entries}
                            onChange={e => setTermsForm(p => ({ ...p, min_entries: e.target.value }))}
                            placeholder="0" style={SL} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🚪 VALOR POR ENTRADA (R$)</label>
                          <input type="number" step="0.01" min="0" value={termsForm.entry_fee_cents}
                            onChange={e => setTermsForm(p => ({ ...p, entry_fee_cents: e.target.value }))}
                            placeholder="0,00" style={SL} />
                        </div>
                        <div>
                          <label style={{ fontSize: 11, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>🍺 CONSUMAÇÃO (R$/pessoa)</label>
                          <input type="number" step="0.01" min="0" value={termsForm.consumacao_cents}
                            onChange={e => setTermsForm(p => ({ ...p, consumacao_cents: e.target.value }))}
                            placeholder="0,00" style={SL} />
                        </div>
                      </div>
                      {/* Preview do custo estimado */}
                      {(() => {
                        const fixo = Math.round((parseFloat(termsForm.fixed_fee_cents) || 0) * 100)
                        const minEnt = parseInt(termsForm.min_entries) || 0
                        const porEnt = Math.round((parseFloat(termsForm.entry_fee_cents) || 0) * 100)
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 style={{ color: C.txt, fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>📋 Promoters</h1>
        <Btn onClick={openNew} icon="➕">Novo Promoter</Btn>
      </div>

      <Card>
        {promos.length === 0
          ? <div style={{ color: C.mut, textAlign: 'center', padding: 20 }}>Nenhum promoter cadastrado</div>
          : promos.map((pr, i) => (
            <div key={pr.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < promos.length - 1 ? `1px solid ${C.brd}` : 'none' }}>
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
                    {pr.min_entries > 0 && <span style={{ background: C.acc+'18', color: C.acc, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>🎟️ {pr.min_entries} mín.</span>}
                    {pr.entry_fee_cents > 0 && <span style={{ background: C.acc+'18', color: C.acc, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>🚪 {fmtCurrency(pr.entry_fee_cents)}/ent.</span>}
                    {pr.consumacao_cents > 0 && <span style={{ background: C.grn+'18', color: C.grn, borderRadius: 5, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>🍺 {fmtCurrency(pr.consumacao_cents)}/pess.</span>}
                  </div>
                )}
              </div>
              {/* Stats */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ color: C.grn, fontWeight: 700, fontSize: 18 }}>{stats[pr.id] ?? 0}</div>
                <div style={{ color: C.mut, fontSize: 10 }}>check-ins</div>
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
