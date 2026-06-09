import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../constants/theme'
import { Card, Toast, Btn, Modal, Pill, FAB } from '../components/ui'
import { fmtCurrency, cn } from '../utils/format'
import { sT, type ToastState } from '../utils/toast'
import type { House, Freelancer } from '../types'
import { DEFAULT_AREAS, AREA_ICON_OPTIONS, AREA_COLOR_OPTIONS, slugifyArea, areaMeta, type WorkArea } from '../constants/areas'

interface Props { house: House }

const DEF = {
  full_name: '', address: '', phone: '', pix_key: '',
  daily_rate_cents: '', work_types: [] as string[], notes: '', status: 'ativo', staff_type: 'freelancer',
}

const AREA_FORM_DEF = { id: '', label: '', icon: '📋', color: '#60a5fa' }

export function FreelancersPage({ house }: Props) {
  const [freelancers, setFreelancers] = useState<Freelancer[]>([])
  const [areas, setAreas] = useState<WorkArea[]>(DEFAULT_AREAS)
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

  useEffect(() => { load(); loadAreas() }, [house.id])

  function openNew() { setEditing(null); setForm({ ...DEF }); setModal(true) }

  function openEdit(fr: Freelancer) {
    setEditing(fr.id)
    setForm({
      full_name: fr.full_name,
      address: fr.address ?? '',
      phone: fr.phone ?? '',
      pix_key: fr.pix_key ?? '',
      daily_rate_cents: fr.daily_rate_cents ? String(fr.daily_rate_cents / 100) : '',
      work_types: (fr.work_types ?? []) as string[],
      notes: fr.notes ?? '',
      status: fr.status,
      staff_type: fr.staff_type ?? 'freelancer',
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
      work_types: form.work_types,
      staff_type: form.staff_type,
      notes: form.notes || null,
      status: form.status,
      updated_at: new Date().toISOString(),
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
  })

  const inp = { style: { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '8px 12px', color: C.txt, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const } }

  if (ldg) return <div style={{ padding: 60, textAlign: 'center', color: C.mut }}>Carregando...</div>

  return (
    <div style={{ paddingBottom: 40 }}>
      <Toast toast={toast} />

      {/* Form modal */}
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

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ color: C.txt, fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>👷 Equipe</h1>
          <div style={{ color: C.mut, fontSize: 13, marginTop: 4 }}>{freelancers.filter(f => f.status === 'ativo').length} ativos · {areas.length} áreas</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => setAreasModal(true)} variant="secondary">⚙️ Administrar áreas</Btn>
          <Btn onClick={openNew} icon="➕">Novo cadastro</Btn>
        </div>
      </div>

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

      {/* Lista */}
      <Card>
        {filtered.length === 0
          ? <div style={{ color: C.mut, textAlign: 'center', padding: 32 }}>Nenhum cadastro encontrado</div>
          : filtered.map((fr, i) => {
            const isFunc = (fr.staff_type ?? 'freelancer') === 'funcionario'
            return (
              <div key={fr.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < filtered.length - 1 ? `1px solid ${C.brd}` : 'none', opacity: fr.status === 'inativo' ? 0.55 : 1 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: (isFunc ? '#10b981' : C.acc) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                  {isFunc ? '🧑‍💼' : '👷'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {fr.full_name}
                    <span style={{ background: (isFunc ? '#10b981' : C.acc) + '22', color: isFunc ? '#10b981' : C.acc, borderRadius: 5, padding: '1px 6px', fontSize: 9, fontWeight: 700 }}>{isFunc ? 'FUNCIONÁRIO' : 'FREELANCER'}</span>
                  </div>
                  <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>
                    {fr.phone ? `📱 ${fr.phone}` : ''}{fr.phone && fr.pix_key ? ' · ' : ''}{fr.pix_key ? `💳 PIX: ${fr.pix_key}` : ''}
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
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {fr.daily_rate_cents ? (
                    <div style={{ color: C.gold, fontWeight: 700, fontSize: 14 }}>{fmtCurrency(fr.daily_rate_cents)}<span style={{ color: C.mut, fontSize: 10, fontWeight: 400 }}>/dia</span></div>
                  ) : null}
                  <Pill color={fr.status === 'ativo' ? C.grn : C.mut} small>{fr.status}</Pill>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {fr.phone && (
                    <a href={`https://wa.me/55${cn(fr.phone)}`} target="_blank" rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', background: '#25D36622', color: '#25D366', border: '1px solid #25D36644', borderRadius: 8, padding: '6px 10px', fontSize: 12, textDecoration: 'none', fontWeight: 700 }}>
                      💬
                    </a>
                  )}
                  <Btn onClick={() => openEdit(fr)} small variant="ghost">✏️</Btn>
                  <Btn onClick={() => toggleStatus(fr)} small variant="ghost">{fr.status === 'ativo' ? '⏸' : '▶'}</Btn>
                  <Btn onClick={() => del(fr.id)} small variant="danger">🗑</Btn>
                </div>
              </div>
            )
          })
        }
      </Card>

      <FAB onClick={openNew} icon="➕" title="Novo cadastro" />
    </div>
  )
}
