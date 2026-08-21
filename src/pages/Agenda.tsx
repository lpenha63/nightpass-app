import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { diaOperacionalStr, viradaDa } from '../utils/diaOperacional'
import { C } from '../constants/theme'
import { Card, Toast, Modal, Btn } from '../components/ui'
import { sT, type ToastState } from '../utils/toast'
import { sendWADirect, notifyTaskAssigned } from '../utils/whatsapp'
import { DEFAULT_AREAS, areaMeta, type WorkArea } from '../constants/areas'
import type { House } from '../types'

interface Props { house: House; user: { id: string; email: string }; role: string }

// Roteia por papel: admin vê a agenda de TODA a equipe (gestão); colaborador vê só a sua.
export function AgendaPage({ house, user, role }: Props) {
  return (role === 'admin' || role === 'super_admin')
    ? <AdminAgenda house={house} />
    : <MyAgenda house={house} user={user} role={role} />
}

interface Step { id: string; title: string; done: boolean; done_by?: string | null }
interface Task { id: string; steps?: Step[]; title: string; area?: string; area_icon?: string; description?: string; deadline?: string; status?: string; completed_at?: string }
interface EvAgenda { id: string; name: string; event_date: string; start_time?: string; confirmed?: boolean; scaled?: boolean; role?: string; house_name?: string; house_logo?: string | null; tasks: Task[] }
interface UpEv { id: string; name: string; event_date: string; start_time?: string; reservas?: number }
interface AgendaData { freelancer: { name: string; staff_type?: string; can_delegate?: boolean } | null; events: EvAgenda[]; avulsas?: Task[]; upcoming?: UpEv[] }

const fmtDate = (d: string) => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
const fmtDeadline = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

interface SentTask { id: string; title: string; status?: string; deadline?: string; completed_at?: string; assignee_name?: string; event_name?: string; event_date?: string }
interface DelegTarget { id: string; full_name: string; phone?: string; staff_type?: string }

// Selo da unidade no card: quem atende mais de um estabelecimento precisa saber,
// olhando o card, em qual casa é o evento. Sem logo, cai nas iniciais.
function UnidadeSelo({ nome, logo }: { nome?: string; logo?: string | null }) {
  const n = (nome ?? '').trim()
  if (!n && !logo) return null
  const base: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, flexShrink: 0 }
  const p = n.split(/\s+/).filter(Boolean)
  const ini = ((p[0] ?? '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
  const selo = (
    <div title={n} style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#7c3aed,#a78bfa)', color: '#fff', fontSize: 13, fontWeight: 900 }}>{ini}</div>
  )
  if (!logo) return selo
  // Iniciais por baixo, logo por cima: logo quebrada some e o selo continua identificando a casa
  return (
    <div style={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 0, left: 0 }}>{selo}</div>
      <img src={logo} alt={n} onError={e => { e.currentTarget.style.display = 'none' }}
        style={{ ...base, position: 'absolute', top: 0, left: 0, objectFit: 'cover', background: C.bg, border: `1px solid ${C.brd}` }} />
    </div>
  )
}

function MyAgenda({ house }: Props) {
  const [data, setData] = useState<AgendaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [openEv, setOpenEv] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<ToastState | null>(null)
  // Delegação (só funcionário)
  const [sent, setSent] = useState<SentTask[]>([])
  const [team, setTeam] = useState<DelegTarget[]>([])
  const [delegOpen, setDelegOpen] = useState(false)
  const [dTarget, setDTarget] = useState<DelegTarget | null>(null)
  const [dSearch, setDSearch] = useState('')
  const [dForm, setDForm] = useState({ title: '', deadline: '', event_id: '' })
  const [dSaving, setDSaving] = useState(false)

  const load = useCallback(() => {
    supabase.rpc('my_agenda').then(r => {
      const d = (r.data ?? { freelancer: null, events: [] }) as AgendaData
      setData(d)
      setLoading(false)
      if (d.freelancer?.can_delegate) {
        supabase.rpc('staff_sent_tasks').then(rs => setSent((rs.data ?? []) as SentTask[]))
      }
    })
  }, [])
  useEffect(() => { load() }, [load])

  const isFunc = data?.freelancer?.can_delegate === true

  function openDelegate() {
    setDTarget(null); setDSearch(''); setDForm({ title: '', deadline: '', event_id: '' }); setDelegOpen(true)
    if (team.length === 0) supabase.rpc('staff_team').then(r => setTeam((r.data ?? []) as DelegTarget[]))
  }

  async function sendDelegate() {
    if (!dTarget) { sT(setToast, 'Escolha o colaborador', 'warn'); return }
    if (!dForm.title.trim()) { sT(setToast, 'Informe o título da tarefa', 'warn'); return }
    setDSaving(true)
    const { data: res, error } = await supabase.rpc('staff_create_task', {
      p_target: dTarget.id, p_title: dForm.title.trim(),
      p_deadline: dForm.deadline || null, p_event: dForm.event_id || null,
    })
    setDSaving(false)
    const r = res as { ok?: boolean; error?: string } | null
    if (error || !r?.ok) { sT(setToast, 'Erro: ' + (r?.error || error?.message || 'falha'), 'error'); return }
    const to = dTarget.full_name
    // Notifica o colaborador no WhatsApp (segundo plano; não abre aba se a API estiver fora)
    const evName = (data?.upcoming ?? []).find(e => e.id === dForm.event_id)?.name ?? null
    notifyTaskAssigned(house.id, house.name, dTarget.id, dForm.title.trim(), { eventName: evName, deadline: dForm.deadline || null })
    setDelegOpen(false)
    sT(setToast, `✅ Tarefa enviada para ${to}`, 'success')
    supabase.rpc('staff_sent_tasks').then(rs => setSent((rs.data ?? []) as SentTask[]))
  }

  async function toggleStep(s: Step) {
    if (busy[s.id]) return
    setBusy(p => ({ ...p, [s.id]: true }))
    const { data, error } = await supabase.rpc('my_step_toggle', { p_step_id: s.id, p_done: !s.done })
    setBusy(p => ({ ...p, [s.id]: false }))
    const r = data as { ok?: boolean; error?: string; tarefa_concluida?: boolean } | null
    if (error || !r?.ok) { sT(setToast, r?.error ?? 'Não foi possível marcar', 'error'); return }
    if (!s.done && r.tarefa_concluida) sT(setToast, '✅ Tarefa concluída!', 'success')
    load()
  }

  // Checklist da tarefa: marcar o último passo conclui a tarefa (regra no servidor)
  function stepsBox(tk: Task) {
    const steps = tk.steps ?? []
    if (!steps.length) return null
    const dn = steps.filter(s => s.done).length
    return (
      <div style={{ marginTop: 8, borderLeft: `2px solid ${C.brd}`, paddingLeft: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: C.mut, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
          <span>Subtarefas</span><span style={{ color: dn === steps.length ? C.grn : C.mut }}>{dn} de {steps.length}</span>
        </div>
        <div style={{ height: 4, background: C.bg, borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{ height: '100%', width: `${Math.round(dn / steps.length * 100)}%`, background: `linear-gradient(90deg,${C.grn},#059669)`, transition: 'width .25s' }} />
        </div>
        {steps.map(s => (
          <button key={s.id} onClick={() => toggleStep(s)} disabled={busy[s.id]}
            style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '7px 0', cursor: 'pointer', fontFamily: 'inherit', opacity: busy[s.id] ? 0.5 : 1 }}>
            <span style={{ width: 21, height: 21, borderRadius: 6, border: `2px solid ${s.done ? C.grn : C.brd}`, background: s.done ? C.grn : 'transparent', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{s.done ? '✓' : ''}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.25, color: s.done ? C.mut : C.txt, textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</span>
          </button>
        ))}
      </div>
    )
  }

  async function toggle(t: Task) {
    if (busy[t.id]) return
    const done = t.status !== 'done'
    setBusy(p => ({ ...p, [t.id]: true }))
    const { data: ok, error } = await supabase.rpc('my_task_toggle', { p_task_id: t.id, p_done: done })
    setBusy(p => ({ ...p, [t.id]: false }))
    if (error || ok === false) { sT(setToast, 'Não foi possível atualizar', 'error'); return }
    setData(prev => prev ? { ...prev, events: prev.events.map(e => ({ ...e, tasks: e.tasks.map(x => x.id === t.id ? { ...x, status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : undefined } : x) })) } : prev)
    sT(setToast, done ? '✅ Tarefa concluída!' : '↩️ Reaberta', 'success')
  }

  // Card = evento em que a pessoa foi ESCALADA. Tarefa recebida para um evento sem escala
  // não vira card (senão parece que ela trabalha nesse dia) — vai para "Tarefas avulsas".
  const evsAll = data?.events ?? []
  const evs = evsAll.filter(e => e.scaled)
  // 'avulsas' = tarefas sem evento (o "dia a dia" do gestor). Não têm evento onde morar,
  // e por isso não chegavam ao colaborador — só o WhatsApp avisava.
  const doDia = (data?.avulsas ?? []).map(t => ({ t, ev: 'Dia a dia', ic: '🧹' }))
  const soltas = [...doDia, ...evsAll.filter(e => !e.scaled).flatMap(e => e.tasks.map(t => ({ t, ev: e.name, ic: '🎉' })))]
  const allTasks = [...evsAll.flatMap(e => e.tasks), ...(data?.avulsas ?? [])]
  const doneN = allTasks.filter(t => t.status === 'done').length
  // Abre sozinho o evento de hoje (ou o próximo): com 1 evento ninguém precisa clicar
  const hojeStr = diaOperacionalStr(viradaDa(house))
  const autoOpen = evs.find(e => e.event_date === hojeStr)?.id ?? evs[0]?.id
  const isOpen = (e: EvAgenda) => openEv[e.id] ?? (e.id === autoOpen)

  if (loading) return <div style={{ color: C.mut, textAlign: 'center', padding: 60 }}>Carregando sua agenda…</div>

  return (
    <div className="pb-24 md:pb-10" style={{ maxWidth: 620, margin: '0 auto' }}>
      <Toast toast={toast} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: C.txt }}>📋 Minha Agenda</h1>
          <p style={{ color: C.mut, fontSize: 13, marginTop: 2 }}>Suas tarefas e eventos em {house.name}</p>
        </div>
        {isFunc && (
          <button onClick={openDelegate} style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>➕ Delegar tarefa</button>
        )}
      </div>

      {!data?.freelancer ? (
        <Card><div style={{ textAlign: 'center', color: C.mut, padding: 40 }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>🔗</div>
          <div style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>Conta ainda não vinculada</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Peça a um administrador para vincular seu usuário ao seu cadastro na Equipe.</div>
        </div></Card>
      ) : (<>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {[
            { n: evs.length, l: 'Eventos', c: '#a78bfa' },
            { n: allTasks.length - doneN, l: 'A fazer', c: C.gold },
            { n: doneN, l: 'Concluídas', c: C.grn },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '12px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: s.c }}>{s.n}</div>
              <div style={{ fontSize: 10, color: C.mut, textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Próximos eventos da casa + reservas (só vem preenchido para funcionários — gate na RPC) */}
        {(data.upcoming ?? []).length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: C.mut, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', margin: '4px 0 8px' }}>🎉 Próximos eventos da casa</div>
            {(data.upcoming ?? []).map(u => {
              const d = new Date(u.event_date + 'T12:00')
              const dd = String(d.getDate()).padStart(2, '0')
              const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
              const wd = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
              return (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 12, padding: '10px 12px', marginBottom: 8 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: '#a78bfa18', border: '1px solid #a78bfa44', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}>
                    <span style={{ fontSize: 16, fontWeight: 900, color: '#a78bfa' }}>{dd}</span>
                    <span style={{ fontSize: 8, color: '#a78bfa', textTransform: 'uppercase', marginTop: 1 }}>{mon}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: C.mut, textTransform: 'capitalize' }}>{wd}, {dd}/{String(d.getMonth() + 1).padStart(2, '0')}{u.start_time ? ` · ${u.start_time.slice(0, 5)}` : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 900, color: C.gold }}>{u.reservas ?? 0}</div>
                    <div style={{ fontSize: 9, color: C.mut }}>🪑 reservas</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {evs.length === 0 ? (
          <Card><div style={{ textAlign: 'center', color: C.mut, padding: 40 }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>🎉</div>
            <div style={{ fontSize: 14 }}>Nenhum evento ou tarefa no momento.<br />Quando você for escalado, aparece aqui.</div>
          </div></Card>
        ) : evs.map(e => {
          const done = e.tasks.filter(t => t.status === 'done').length
          const pct = e.tasks.length ? Math.round(done / e.tasks.length * 100) : 0
          const badge = e.tasks.length && done === e.tasks.length
            ? { bg: '#3b82f622', c: '#3b82f6', t: '✅ Tudo pronto' }
            : e.confirmed ? { bg: C.grn + '22', c: C.grn, t: '✅ Presença confirmada' }
            : { bg: C.gold + '22', c: C.gold, t: `⏳ ${e.tasks.length - done} pendente(s)` }
          // agrupa por área
          const byArea: Record<string, Task[]> = {}
          e.tasks.forEach(t => { const k = `${t.area_icon || '📋'} ${t.area || 'Geral'}`; (byArea[k] = byArea[k] || []).push(t) })
          return (
            <Card key={e.id} style={{ marginBottom: 14 }}>
              <div onClick={() => setOpenEv(p => ({ ...p, [e.id]: !isOpen(e) }))} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.txt }}>{isOpen(e) ? '▾' : '▸'} {e.name}</div>
                  <div style={{ color: C.mut, fontSize: 12, marginTop: 2, textTransform: 'capitalize' }}>📅 {fmtDate(e.event_date)}{e.start_time ? ` · 🕒 ${e.start_time.slice(0, 5)}` : ''}</div>
                  {e.role && <div style={{ color: C.mut, fontSize: 12 }}>🏷️ {e.role}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0, maxWidth: '42%' }}>
                  <UnidadeSelo nome={e.house_name} logo={e.house_logo} />
                  {e.house_name && <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, textAlign: 'right', lineHeight: 1.2, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.house_name}</div>}
                  <span style={{ background: badge.bg, color: badge.c, borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>{badge.t}</span>
                </div>
              </div>
              {e.tasks.length > 0 ? (<>
                <div style={{ height: 5, background: C.bg, borderRadius: 3, overflow: 'hidden', margin: '12px 0' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${C.grn},#059669)`, borderRadius: 3, transition: 'width .3s' }} />
                </div>
                {!isOpen(e) && (
                  <div style={{ fontSize: 12, color: C.mut, marginTop: -4 }}>📋 {done}/{e.tasks.length} tarefas — toque para abrir</div>
                )}
                {isOpen(e) && Object.entries(byArea).map(([area, tasks]) => (
                  <div key={area}>
                    <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', margin: '12px 0 6px' }}>{area}</div>
                    {tasks.map(t => {
                      const isDone = t.status === 'done'
                      const overdue = !isDone && t.deadline && new Date(t.deadline) < new Date()
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 0', borderBottom: `1px solid ${C.brd}22` }}>
                          <div onClick={() => toggle(t)} style={{ width: 26, height: 26, borderRadius: 8, border: `2px solid ${isDone ? C.grn : C.brd}`, background: isDone ? C.grn : C.bg, color: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, cursor: 'pointer', marginTop: 1, opacity: busy[t.id] ? 0.5 : 1 }}>{isDone ? '✓' : ''}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, color: isDone ? C.mut : C.txt, textDecoration: isDone ? 'line-through' : 'none' }}>{t.title}</div>
                            {t.description && <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>{t.description}</div>}
                            {t.deadline && <div style={{ fontSize: 11, marginTop: 3, color: overdue ? C.red : C.mut, fontWeight: overdue ? 700 : 400 }}>⏰ {fmtDeadline(t.deadline)}{overdue ? ' — VENCIDO' : ''}</div>}
                            {stepsBox(t)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </>) : (
                <div style={{ color: C.mut, fontSize: 12, padding: '10px 0' }}>Sem tarefas atribuídas a você neste evento.</div>
              )}
            </Card>
          )
        })}

        {/* Tarefas de eventos em que a pessoa não está escalada: sem card, mas não podem sumir */}
        {soltas.length > 0 && (
          <Card style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.txt, marginBottom: 8 }}>📌 Tarefas sem evento ({soltas.length})</div>
            {soltas.map(({ t, ev, ic }, i) => {
              const isDone = t.status === 'done'
              const overdue = !isDone && t.deadline && new Date(t.deadline) < new Date()
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 0', borderBottom: i < soltas.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                  <div onClick={() => toggle(t)} style={{ width: 26, height: 26, borderRadius: 8, border: `2px solid ${isDone ? C.grn : C.brd}`, background: isDone ? C.grn : C.bg, color: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, cursor: 'pointer', marginTop: 1, opacity: busy[t.id] ? 0.5 : 1 }}>{isDone ? '✓' : ''}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, color: isDone ? C.mut : C.txt, textDecoration: isDone ? 'line-through' : 'none' }}>{t.title}</div>
                    <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>{ic} {ev}</div>
                    {t.deadline && <div style={{ fontSize: 11, marginTop: 3, color: overdue ? C.red : C.mut, fontWeight: overdue ? 700 : 400 }}>⏰ {fmtDeadline(t.deadline)}{overdue ? ' — VENCIDO' : ''}</div>}
                    {stepsBox(t)}
                  </div>
                </div>
              )
            })}
          </Card>
        )}

        {/* 📤 Enviei — tarefas que o funcionário delegou (acompanhar status) */}
        {isFunc && sent.length > 0 && (
          <Card style={{ marginTop: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.txt, marginBottom: 8 }}>📤 Tarefas que enviei ({sent.length})</div>
            {sent.map((s, i) => {
              const done = s.status === 'done'
              const overdue = !done && s.deadline && new Date(s.deadline) < new Date()
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderBottom: i < sent.length - 1 ? `1px solid ${C.brd}22` : 'none' }}>
                  <span style={{ fontSize: 15, marginTop: 1 }}>{done ? '✅' : overdue ? '⏰' : '⏳'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: done ? C.mut : C.txt, textDecoration: done ? 'line-through' : 'none' }}>{s.title}</div>
                    <div style={{ fontSize: 11, color: C.mut, marginTop: 1 }}>
                      👤 {s.assignee_name ?? '—'}{s.event_name ? ` · 🎉 ${s.event_name}` : ''}
                      {done && s.completed_at ? ` · ✅ ${fmtDeadline(s.completed_at)}` : (s.deadline ? ` · ⏰ ${fmtDeadline(s.deadline)}${overdue ? ' — vencida' : ''}` : '')}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, color: done ? C.grn : overdue ? C.red : C.gold, flexShrink: 0 }}>{done ? 'concluída' : overdue ? 'vencida' : 'pendente'}</span>
                </div>
              )
            })}
          </Card>
        )}
      </>)}

      {/* Modal: delegar tarefa (só funcionário) */}
      <Modal open={delegOpen} title="➕ Delegar tarefa" onClose={() => setDelegOpen(false)} noDirtyCheck>
        {(() => {
          const inp: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '9px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
          const evs2 = data?.upcoming ?? []
          return (
            <div style={{ display: 'grid', gap: 10 }}>
              {dTarget ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.acc + '14', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '8px 12px' }}>
                  <span style={{ fontSize: 16 }}>{dTarget.staff_type === 'funcionario' ? '🧑‍💼' : '👷'}</span>
                  <span style={{ flex: 1, color: C.txt, fontWeight: 700, fontSize: 14 }}>{dTarget.full_name}</span>
                  <button onClick={() => setDTarget(null)} style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>trocar</button>
                </div>
              ) : (
                <div>
                  <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Para quem? *</label>
                  <input value={dSearch} onChange={e => setDSearch(e.target.value)} placeholder="🔍 Buscar colaborador pelo nome…" autoFocus style={inp} />
                  {dSearch.trim() && (
                    <div style={{ maxHeight: 200, overflowY: 'auto', border: `1px solid ${C.brd}`, borderRadius: 8, marginTop: 6 }}>
                      {team.filter(m => m.full_name.toLowerCase().includes(dSearch.trim().toLowerCase())).slice(0, 30).map(m => (
                        <div key={m.id} onClick={() => { setDTarget(m); setDSearch('') }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: `1px solid ${C.brd}22`, cursor: 'pointer' }}>
                          <span style={{ fontSize: 15 }}>{m.staff_type === 'funcionario' ? '🧑‍💼' : '👷'}</span>
                          <span style={{ color: C.txt, fontSize: 14 }}>{m.full_name}</span>
                        </div>
                      ))}
                      {team.filter(m => m.full_name.toLowerCase().includes(dSearch.trim().toLowerCase())).length === 0 && (
                        <div style={{ color: C.mut, fontSize: 13, padding: '10px 12px' }}>Nenhum colaborador encontrado.</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <input value={dForm.title} onChange={e => setDForm(p => ({ ...p, title: e.target.value }))} placeholder="Título da tarefa *" style={inp} />
              <div>
                <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Prazo (opcional)</label>
                <input type="datetime-local" value={dForm.deadline} onChange={e => setDForm(p => ({ ...p, deadline: e.target.value }))} style={inp} />
              </div>
              {evs2.length > 0 && (
                <div>
                  <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Evento (opcional)</label>
                  <select value={dForm.event_id} onChange={e => setDForm(p => ({ ...p, event_id: e.target.value }))} style={inp}>
                    <option value="">📌 Sem evento</option>
                    {evs2.map(ev => <option key={ev.id} value={ev.id}>🎉 {ev.name} — {new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</option>)}
                  </select>
                </div>
              )}
              <Btn onClick={sendDelegate} disabled={dSaving} style={{ width: '100%' }}>{dSaving ? 'Enviando…' : '✅ Enviar tarefa'}</Btn>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
//  ADMIN — Agenda de toda a equipe (atribuir tarefas + verificar execução)
// ════════════════════════════════════════════════════════════════
interface TeamMember { id: string; full_name: string; phone?: string; staff_type?: string; access_token?: string }
interface AdminTask {
  id: string; event_id?: string | null; title: string; description?: string
  area?: string; area_icon?: string; deadline?: string; status?: string
  completed_at?: string; completed_by?: string; block_reason?: string; blocked_at?: string; blocked_by?: string; freelancer_id?: string | null
  assignee_name?: string | null; assignee_phone?: string | null
  events?: { name?: string; event_date?: string } | null
}
interface EvOpt { id: string; name: string; event_date: string; start_time?: string }

interface Tpl { id: string; name: string }
interface TplItem { id?: string; template_id?: string; title: string; description?: string | null; area: string; area_icon?: string; offset_min?: number | null; sort_order?: number; steps?: string[] | null }
// Prazo relativo à abertura da casa — em minutos. Data absoluta sai errada toda semana.
const OFFSETS: Array<[string, number | null]> = [
  ['Sem prazo', null], ['3h antes de abrir', -180], ['2h antes de abrir', -120],
  ['1h antes de abrir', -60], ['Na abertura', 0], ['1h depois de abrir', 60], ['2h depois de abrir', 120],
]

const TASK_COLS = 'id,event_id,title,description,area,area_icon,deadline,status,completed_at,completed_by,block_reason,blocked_at,blocked_by,freelancer_id,assignee_name,assignee_phone,events(name,event_date)'
const onlyDigits = (s?: string | null) => (s ?? '').replace(/\D/g, '')

function AdminAgenda({ house }: { house: House }) {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [tasks, setTasks] = useState<AdminTask[]>([])
  const [events, setEvents] = useState<EvOpt[]>([])
  const [resByEvent, setResByEvent] = useState<Record<string, number>>({})
  const [resByDate, setResByDate] = useState<Record<string, number>>({})
  const [listByEvent, setListByEvent] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'colaborador' | 'evento' | 'diaadia' | 'area'>('evento')
  // Area aberta dentro de cada card de evento. Fechado por padrao: um evento com 50
  // tarefas viraria uma listagem gigante e o card deixaria de ser um resumo.
  const [areaAberta, setAreaAberta] = useState<Record<string, string | null>>({})
  const [expiredTasks, setExpiredTasks] = useState<AdminTask[]>([])
  const [showExpired, setShowExpired] = useState(false)
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'overdue' | 'done' | 'unassigned'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  // Ocorrências relatadas pela equipe (app) — abertas
  interface StaffReport { id: string; message: string; target: string; category: string; author_name?: string; created_at: string; status: string; resolved_at?: string; event_name?: string }
  const [reports, setReports] = useState<StaffReport[]>([])
  const [showResolved, setShowResolved] = useState(false)
  const loadReports = useCallback(() => {
    supabase.from('staff_reports').select('id,message,target,category,author_name,created_at,status,resolved_at,events(name)')
      .eq('house_id', house.id).order('created_at', { ascending: false }).limit(60)
      .then(r => setReports(((r.data ?? []) as unknown as Array<StaffReport & { events?: { name?: string } }>)
        .map(x => ({ ...x, event_name: x.events?.name }))))
  }, [house.id])
  useEffect(() => { loadReports() }, [loadReports])
  async function resolveReport(id: string) {
    await supabase.from('staff_reports').update({ status: 'resolvido', resolved_at: new Date().toISOString() }).eq('id', id)
    setReports(p => p.map(x => x.id === id ? { ...x, status: 'resolvido', resolved_at: new Date().toISOString() } : x))
  }
  async function reopenReport(id: string) {
    await supabase.from('staff_reports').update({ status: 'aberto', resolved_at: null }).eq('id', id)
    setReports(p => p.map(x => x.id === id ? { ...x, status: 'aberto', resolved_at: undefined } : x))
  }
  const openReports = reports.filter(r => r.status !== 'resolvido')
  const doneReports = reports.filter(r => r.status === 'resolvido')
  // Atribuir tarefa: modal com colaborador escolhido (ou buscável) + evento opcional
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignFor, setAssignFor] = useState<TeamMember | null>(null)
  const [assignSearch, setAssignSearch] = useState('')
  const [form, setForm] = useState({ title: '', description: '', deadline: '', event_id: '', area: '' })
  // Subtarefas da nova tarefa. Uma por linha: digitar é mais rápido que somar campos.
  const [formSteps, setFormSteps] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [showDone, setShowDone] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  // ── Modelos de tarefas (checklist padrão por tipo de evento) ──
  const [workAreas, setWorkAreas] = useState<WorkArea[]>(DEFAULT_AREAS)
  const [tpls, setTpls] = useState<Tpl[]>([])
  const [tplOpen, setTplOpen] = useState(false)
  const [tplSel, setTplSel] = useState<Tpl | null>(null)
  const [tplItems, setTplItems] = useState<TplItem[]>([])
  const [tplNewName, setTplNewName] = useState('')
  const [itForm, setItForm] = useState<TplItem>({ title: '', area: '', offset_min: null })
  const [itSteps, setItSteps] = useState('')
  const [applyEv, setApplyEv] = useState<EvOpt | null>(null)
  const [applying, setApplying] = useState(false)
  const wlabel = (key: string) => { const m = areaMeta(workAreas, key); return `${m.icon} ${m.label}` }

  const loadTpls = useCallback(() => {
    supabase.from('task_templates').select('id,name').eq('house_id', house.id).order('name')
      .then(r => setTpls((r.data ?? []) as Tpl[]))
  }, [house.id])

  function openTplItems(tp: Tpl) {
    setTplSel(tp)
    setItForm({ title: '', area: workAreas[0]?.key ?? 'limpeza', offset_min: null })
    supabase.from('task_template_items').select('*').eq('template_id', tp.id).order('sort_order').order('title')
      .then(r => setTplItems((r.data ?? []) as TplItem[]))
  }

  async function criarTpl() {
    const nome = tplNewName.trim()
    if (!nome) { sT(setToast, 'Dê um nome ao modelo', 'warn'); return }
    const { data, error } = await supabase.from('task_templates').insert({ house_id: house.id, name: nome }).select('id,name').single()
    if (error || !data) { sT(setToast, 'Erro: ' + (error?.message ?? 'falha'), 'error'); return }
    setTplNewName(''); loadTpls(); openTplItems(data as Tpl)
    sT(setToast, '✅ Modelo criado — agora inclua as tarefas', 'success')
  }

  async function addItem() {
    if (!tplSel) return
    if (!itForm.title.trim()) { sT(setToast, 'Informe o título da tarefa', 'warn'); return }
    if (!itForm.area) { sT(setToast, 'Escolha a área', 'warn'); return }
    const icon = areaMeta(workAreas, itForm.area).icon
    const passos = itSteps.split('\n').map(s => s.replace(/^[-*•\s]+/, '').trim()).filter(Boolean)
    const { data, error } = await supabase.from('task_template_items').insert({
      template_id: tplSel.id, title: itForm.title.trim(), description: itForm.description || null,
      area: itForm.area, area_icon: icon, offset_min: itForm.offset_min ?? null, sort_order: tplItems.length,
      steps: passos.length ? passos : null,
    }).select('*').single()
    if (error || !data) { sT(setToast, 'Erro: ' + (error?.message ?? 'falha'), 'error'); return }
    setTplItems(p => [...p, data as TplItem])
    setItForm({ title: '', area: itForm.area, offset_min: itForm.offset_min ?? null })
    setItSteps('')
  }

  async function delItem(id?: string) {
    if (!id) return
    await supabase.from('task_template_items').delete().eq('id', id)
    setTplItems(p => p.filter(x => x.id !== id))
  }

  async function delTpl(tp: Tpl) {
    if (!confirm(`Excluir o modelo "${tp.name}"? As tarefas já geradas nos eventos não são afetadas.`)) return
    await supabase.from('task_templates').delete().eq('id', tp.id)
    if (tplSel?.id === tp.id) { setTplSel(null); setTplItems([]) }
    loadTpls()
  }

  // Gera as tarefas do modelo no evento: cada item vai para quem está escalado na área
  async function gerar(tplId: string) {
    if (!applyEv) return
    setApplying(true)
    const { data, error } = await supabase.rpc('apply_task_template', { p_event: applyEv.id, p_template: tplId })
    setApplying(false)
    const r = data as { ok?: boolean; error?: string; criadas?: number; puladas?: number; areas_sem_equipe?: string[] } | null
    if (error || !r?.ok) { sT(setToast, 'Erro: ' + (r?.error ?? error?.message ?? 'falha'), 'error'); return }
    setApplyEv(null)
    const sem = r.areas_sem_equipe ?? []
    if ((r.criadas ?? 0) === 0 && sem.length > 0) {
      sT(setToast, `Nenhuma tarefa criada — ninguém escalado em ${sem.map(wlabel).join(', ')}. Escale a equipe e gere de novo.`, 'warn')
    } else {
      const extra = [(r.puladas ?? 0) > 0 ? `${r.puladas} já existiam` : '', sem.length ? `sem equipe em ${sem.map(wlabel).join(', ')}` : '']
        .filter(Boolean).join(' · ')
      sT(setToast, `✅ ${r.criadas} tarefa(s) criada(s)${extra ? ' — ' + extra : ''}`, 'success')
    }
    load()
  }

  const load = useCallback(async () => {
    setLoadErr(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const [tR, kR, eR, rR, lR] = await Promise.all([
        supabase.from('freelancers').select('id, full_name, phone, staff_type, access_token, status').eq('house_id', house.id).order('full_name'),
        supabase.from('event_tasks').select(TASK_COLS).eq('house_id', house.id).order('deadline', { nullsFirst: false }),
        // Só eventos vigentes (data de hoje em diante), sem cancelados nem arquivados/encerrados
        supabase.from('events').select('id,name,event_date,start_time').eq('house_id', house.id).gte('event_date', today).not('status', 'in', '(cancelado,encerrado)').order('event_date', { ascending: true }),
        supabase.from('reservations').select('event_id,reservation_date').eq('house_id', house.id).gte('reservation_date', today).neq('status', 'cancelled'),
        supabase.from('promoter_lists').select('event_id').eq('house_id', house.id),
      ])
      const err = tR.error || kR.error || eR.error
      if (err) { console.error('AdminAgenda load error', tR.error, kR.error, eR.error, rR.error, lR.error); setLoadErr(err.message) }
      setTeam(((tR.data ?? []) as TeamMember[]).filter(f => (f as { status?: string }).status !== 'inativo'))
      // Ativas: avulsas (dia a dia) OU de eventos vigentes. Expiradas: de eventos que já passaram e não concluídas.
      const allTasks = (kR.data ?? []) as unknown as AdminTask[]
      setTasks(allTasks.filter(t => !t.event_id || ((t.events?.event_date ?? '') >= today)))
      setExpiredTasks(allTasks.filter(t => t.event_id && (t.events?.event_date ?? '') < today && t.status !== 'done'))
      setEvents((eR.data ?? []) as EvOpt[])
      // contadores por evento: reservas (por event_id, com fallback por data) e listas de promoter
      const rbe: Record<string, number> = {}, rbd: Record<string, number> = {}
      ;(rR.data ?? []).forEach((r: { event_id?: string | null; reservation_date?: string }) => {
        if (r.event_id) rbe[r.event_id] = (rbe[r.event_id] ?? 0) + 1
        else if (r.reservation_date) rbd[r.reservation_date] = (rbd[r.reservation_date] ?? 0) + 1
      })
      const lbe: Record<string, number> = {}
      ;(lR.data ?? []).forEach((l: { event_id?: string | null }) => { if (l.event_id) lbe[l.event_id] = (lbe[l.event_id] ?? 0) + 1 })
      setResByEvent(rbe); setResByDate(rbd); setListByEvent(lbe)
    } catch (e) {
      console.error('AdminAgenda load exception', e)
      setLoadErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [house.id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    loadTpls()
    supabase.from('work_areas').select('*').eq('house_id', house.id).order('sort_order').order('label')
      .then(r => { const a = (r.data ?? []) as WorkArea[]; if (a.length) setWorkAreas(a) })
  }, [house.id, loadTpls])

  // Funcionários primeiro, depois freelancers; alfabético dentro de cada grupo
  const sortedTeam = useMemo(() => [...team].sort((a, b) => {
    const r = ((a.staff_type ?? 'freelancer') === 'funcionario' ? 0 : 1) - ((b.staff_type ?? 'freelancer') === 'funcionario' ? 0 : 1)
    return r !== 0 ? r : a.full_name.localeCompare(b.full_name, 'pt-BR')
  }), [team])

  // telefone -> id do colaborador (para casar tarefas atribuídas só por telefone, ex: vindas da Produção)
  const phoneMap = useMemo(() => {
    const m: Record<string, string> = {}
    team.forEach(t => { const d = onlyDigits(t.phone); if (d) m[d] = t.id })
    return m
  }, [team])
  const ownerOf = useCallback((t: AdminTask) => t.freelancer_id ?? phoneMap[onlyDigits(t.assignee_phone)] ?? null, [phoneMap])

  const byMember = useMemo(() => {
    const m = new Map<string, AdminTask[]>()
    tasks.forEach(t => { const o = ownerOf(t); if (o) { const a = m.get(o) ?? []; a.push(t); m.set(o, a) } })
    return m
  }, [tasks, ownerOf])
  const unassigned = useMemo(() => tasks.filter(t => !ownerOf(t) && (t.assignee_name || t.title)), [tasks, ownerOf])

  const now = Date.now()
  // Agrupa por area preservando a ordem cadastrada da casa (e nao alfabetica),
  // porque o gestor le a lista na mesma ordem em que ela aparece na Equipe.
  function agruparPorArea(list: AdminTask[]): Array<[string, AdminTask[]]> {
    const m = new Map<string, AdminTask[]>()
    list.forEach(t => {
      const k = t.area || 'Geral'
      m.set(k, [...(m.get(k) ?? []), t])
    })
    const ordem = new Map(workAreas.map((a, i) => [a.key, i]))
    return [...m.entries()].sort((a, b) =>
      (ordem.get(a[0]) ?? 999) - (ordem.get(b[0]) ?? 999) || a[0].localeCompare(b[0]))
  }

  // Cartao compacto de uma area — mostra o placar e abre a lista ao ser tocado.
  function cartaoArea(area: string, todas: AdminTask[], aberto: boolean, onClick: () => void) {
    const s = statOf(todas)
    const completa = s.total > 0 && s.done === s.total
    const pct = s.total ? Math.round(s.done / s.total * 100) : 0
    const cor = completa ? C.grn : s.overdue > 0 ? C.red : C.acc
    return (
      <button key={area} onClick={onClick}
        title={aberto ? 'Fechar' : `Ver as tarefas de ${wlabel(area)}`}
        style={{
          flex: '1 1 132px', maxWidth: 200, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
          background: aberto ? C.acc + '14' : C.bg,
          border: `1px solid ${aberto ? C.acc : completa ? C.grn + '55' : C.brd}`,
          borderRadius: 12, padding: '9px 11px',
        }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 5 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {wlabel(area)}
          </span>
          <span style={{ fontSize: 13, fontWeight: 900, color: cor, whiteSpace: 'nowrap' }}>{s.done}/{s.total}</span>
        </div>
        <div style={{ height: 4, background: C.card, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: cor, borderRadius: 3, transition: 'width .3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, fontSize: 10 }}>
          <span style={{ color: completa ? C.grn : C.mut, fontWeight: 600 }}>
            {completa ? 'concluída' : `${s.pending} aberta(s)`}
          </span>
          {s.overdue > 0 && <span style={{ color: C.red, fontWeight: 800 }}>⏰ {s.overdue}</span>}
        </div>
      </button>
    )
  }

  // Cabecalho de uma area: e daqui que se ve, de relance, quem ja terminou.
  function faixaArea(area: string, list: AdminTask[]) {
    const s = statOf(list)
    const completa = s.total > 0 && s.done === s.total
    const pct = s.total ? Math.round(s.done / s.total * 100) : 0
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: completa ? C.grn : C.txt, whiteSpace: 'nowrap' }}>
          {completa ? '✅ ' : ''}{wlabel(area)}
        </span>
        <div style={{ flex: 1, height: 5, background: C.bg, borderRadius: 3, overflow: 'hidden', minWidth: 40 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: completa ? C.grn : `linear-gradient(90deg,${C.acc},#1d4ed8)`, borderRadius: 3, transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: completa ? C.grn : C.mut, whiteSpace: 'nowrap' }}>
          {s.done}/{s.total}{s.overdue > 0 ? ` · ${s.overdue} vencida(s)` : ''}
        </span>
      </div>
    )
  }

  const statOf = (list: AdminTask[]) => {
    const pend = list.filter(t => t.status !== 'done')
    const overdue = pend.filter(t => t.deadline && new Date(t.deadline).getTime() < now).length
    return { total: list.length, done: list.length - pend.length, pending: pend.length, overdue }
  }
  // Resumo geral (mini dashboard)
  const overview = (() => {
    const pend = tasks.filter(t => t.status !== 'done')
    const overdue = pend.filter(t => t.deadline && new Date(t.deadline).getTime() < now).length
    return { colaboradores: team.length, eventos: events.length, aFazer: pend.length, done: tasks.length - pend.length, overdue, semResp: unassigned.length }
  })()

  function openAssign(member: TeamMember | null, eventId = '') {
    setAssignFor(member); setAssignSearch(''); setForm({ title: '', description: '', deadline: '', event_id: eventId, area: '' }); setFormSteps(''); setAssignOpen(true)
  }
  function closeAssign() { setAssignOpen(false); setAssignFor(null); setAssignSearch(''); setFormSteps(''); setForm(f => ({ ...f, area: '' })) }

  async function assign() {
    if (!assignFor) { sT(setToast, 'Escolha o colaborador', 'warn'); return }
    if (!form.title.trim()) { sT(setToast, 'Informe o título da tarefa', 'warn'); return }
    setSaving(true)
    const { data, error } = await supabase.from('event_tasks').insert({
      house_id: house.id, event_id: form.event_id || null,
      // Antes gravava 'Geral' fixo: o app do colaborador agrupa por area, e tudo
      // caia no mesmo balde sem relacao com as areas cadastradas da casa.
      area: form.area || 'Geral',
      area_icon: form.area ? areaMeta(workAreas, form.area).icon : '📋',
      title: form.title.trim(),
      description: form.description || null, deadline: form.deadline || null,
      freelancer_id: assignFor.id, assignee_name: assignFor.full_name, assignee_phone: assignFor.phone || null,
      status: 'pending', sort_order: 0,
    }).select(TASK_COLS).single()
    setSaving(false)
    if (error) { sT(setToast, 'Erro: ' + error.message, 'error'); return }
    if (data) {
      const novaId = (data as unknown as AdminTask).id
      const passos = formSteps.split('\n').map(s => s.replace(/^[-*•\s]+/, '').trim()).filter(Boolean)
      if (passos.length) {
        await supabase.from('task_steps').insert(passos.map((p, i) => ({ task_id: novaId, title: p, sort_order: i })))
      }
      setTasks(p => [data as unknown as AdminTask, ...p])
      const to = assignFor.full_name
      const evName = events.find(e => e.id === form.event_id)?.name ?? null
      notifyTaskAssigned(house.id, house.name, assignFor.id, form.title.trim(), { eventName: evName, deadline: form.deadline || null })
      closeAssign()
      sT(setToast, `✅ Tarefa enviada para ${to}`, 'success')
    }
  }

  async function assignExisting(taskId: string, memberId: string) {
    const m = team.find(x => x.id === memberId); if (!m) return
    const { error } = await supabase.from('event_tasks').update({ freelancer_id: m.id, assignee_name: m.full_name, assignee_phone: m.phone || null }).eq('id', taskId)
    if (error) { sT(setToast, 'Erro ao atribuir', 'error'); return }
    const tk = tasks.find(x => x.id === taskId)
    setTasks(p => p.map(x => x.id === taskId ? { ...x, freelancer_id: m.id, assignee_name: m.full_name, assignee_phone: m.phone || null } : x))
    if (tk) notifyTaskAssigned(house.id, house.name, m.id, tk.title, { eventName: tk.events?.name ?? null, deadline: tk.deadline ?? null })
    sT(setToast, `✅ Atribuída a ${m.full_name}`, 'success')
  }

  async function toggle(t: AdminTask) {
    if (busy[t.id]) return
    const done = t.status !== 'done'
    setBusy(p => ({ ...p, [t.id]: true }))
    const { error } = await supabase.from('event_tasks').update({ status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : null, completed_by: done ? 'Admin' : null }).eq('id', t.id)
    setBusy(p => ({ ...p, [t.id]: false }))
    if (error) { sT(setToast, 'Erro ao atualizar', 'error'); return }
    setTasks(p => p.map(x => x.id === t.id ? { ...x, status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : undefined, completed_by: done ? 'Admin' : undefined } : x))
  }

  async function del(t: AdminTask) {
    if (!confirm(`Remover a tarefa "${t.title}"?`)) return
    await supabase.from('event_tasks').delete().eq('id', t.id)
    setTasks(p => p.filter(x => x.id !== t.id))
    setExpiredTasks(p => p.filter(x => x.id !== t.id))
  }

  async function sendLink(m: TeamMember) {
    if (!m.phone) { sT(setToast, 'Colaborador sem telefone cadastrado', 'warn'); return }
    if (!m.access_token) { sT(setToast, 'Abra a aba Equipe uma vez para gerar o link deste colaborador', 'warn'); return }
    const link = `${window.location.origin}/agenda.html?t=${m.access_token}`
    const msg = `📋 *Sua agenda em ${house.name}*\n\nVeja suas tarefas e confirme sua presença:\n${link}`
    const r = await sendWADirect(house.id, m.phone, msg, { type: 'agenda_colaborador' })
    sT(setToast, r ? '📲 Agenda enviada no WhatsApp!' : 'Abrindo WhatsApp...', 'success')
  }

  const whoOf = (t: AdminTask) => t.assignee_name ?? team.find(m => m.id === ownerOf(t))?.full_name ?? null

  const taskRow = (t: AdminTask, showAssign = false, showWho = false) => {
    const isDone = t.status === 'done'
    const overdue = !isDone && t.deadline && new Date(t.deadline).getTime() < now
    const who = showWho ? whoOf(t) : null
    return (
      <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: `1px solid ${C.brd}22` }}>
        <div onClick={() => toggle(t)} title={isDone ? 'Reabrir' : 'Marcar como concluída'} style={{ width: 24, height: 24, borderRadius: 7, border: `2px solid ${isDone ? C.grn : C.brd}`, background: isDone ? C.grn : 'transparent', color: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, cursor: 'pointer', marginTop: 1, opacity: busy[t.id] ? 0.5 : 1 }}>{isDone ? '✓' : ''}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: isDone ? C.mut : C.txt, textDecoration: isDone ? 'line-through' : 'none' }}>{t.title}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
            {who && <span style={{ fontSize: 11, color: C.acc, fontWeight: 700 }}>👤 {who}</span>}
            {who === null && showWho && <span style={{ fontSize: 11, color: C.gold, fontWeight: 700 }}>👤 sem responsável</span>}
            {!showWho && t.events?.name && <span style={{ fontSize: 11, color: '#a78bfa' }}>🎉 {t.events.name}</span>}
            {!showWho && !t.event_id && <span style={{ fontSize: 11, color: C.mut }}>📌 Avulsa</span>}
            {t.deadline && <span style={{ fontSize: 11, color: overdue ? C.red : C.mut, fontWeight: overdue ? 700 : 400 }}>⏰ {fmtDeadline(t.deadline)}{overdue ? ' — VENCIDO' : ''}</span>}
            {isDone && t.completed_at && <span style={{ fontSize: 11, color: C.grn }}>✅ {fmtDeadline(t.completed_at)}{t.completed_by ? ` · ${t.completed_by}` : ''}</span>}
          </div>
          {t.description && <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>{t.description}</div>}
          {/* Tarefa marcada como "não feita" pelo colaborador — com a justificativa */}
          {t.status === 'blocked' && t.block_reason && (
            <div style={{ marginTop: 6, background: C.red + '14', border: `1px solid ${C.red}33`, borderRadius: 8, padding: '7px 10px' }}>
              <div style={{ color: C.red, fontSize: 12, fontWeight: 700 }}>⚠️ Não foi feito: {t.block_reason}</div>
              <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>{t.blocked_by ?? '—'}{t.blocked_at ? ` · ${fmtDeadline(t.blocked_at)}` : ''}</div>
            </div>
          )}
          {showAssign && (
            <select value="" onChange={e => e.target.value && assignExisting(t.id, e.target.value)} style={{ marginTop: 6, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '5px 8px', color: C.txt, fontSize: 12, fontFamily: 'inherit' }}>
              <option value="">➕ Atribuir a…</option>
              {sortedTeam.map(m => <option key={m.id} value={m.id}>{m.staff_type === 'funcionario' ? '🧑‍💼' : '👷'} {m.full_name}</option>)}
            </select>
          )}
        </div>
        <button onClick={() => del(t)} title="Remover" style={{ background: 'none', border: 'none', color: C.red, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>🗑</button>
      </div>
    )
  }

  // Estilo de input dentro do componente (o Proxy C precisa ser lido a cada render p/ seguir o tema)
  const inp: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '9px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }

  if (loading) return <div style={{ color: C.mut, textAlign: 'center', padding: 60 }}>Carregando agenda da equipe…</div>

  return (
    <div className="pb-24 md:pb-10" style={{ maxWidth: 760, margin: '0 auto' }}>
      <Toast toast={toast} />
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: C.txt }}>📋 Agenda da Equipe</h1>
        <p style={{ color: C.mut, fontSize: 13, marginTop: 2 }}>Atribua tarefas e acompanhe a execução de cada colaborador</p>
      </div>

      {/* Mini dashboard — cards de tarefa são clicáveis e funcionam como filtro pra localizar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: taskFilter === 'all' ? 14 : 8 }}>
        {([
          ['👥', overview.colaboradores, 'Equipe', C.acc, null],
          ['🎉', overview.eventos, 'Próx. eventos', '#a78bfa', null],
          ['📋', overview.aFazer, 'A fazer', C.gold, 'pending'],
          ['⏰', overview.overdue, 'Vencidas', overview.overdue > 0 ? C.red : C.mut, 'overdue'],
          ['✅', overview.done, 'Concluídas', C.grn, 'done'],
          ['⚠️', overview.semResp, 'Sem resp.', overview.semResp > 0 ? C.gold : C.mut, 'unassigned'],
        ] as const).map(([icon, n, label, color, fk], i) => {
          const active = fk !== null && taskFilter === fk
          const clickable = fk !== null
          return (
            <button key={i} type="button" disabled={!clickable}
              onClick={() => clickable && setTaskFilter(active ? 'all' : (fk as typeof taskFilter))}
              style={{ background: active ? color + '1f' : C.bg, border: `1px solid ${active ? color : C.brd}`, borderRadius: 12, padding: '10px 8px', textAlign: 'center', cursor: clickable ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              <div style={{ fontSize: 12, marginBottom: 2 }}>{icon}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color }}>{n}</div>
              <div style={{ fontSize: 10, color: active ? color : C.mut, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: active ? 700 : 400 }}>{label}</div>
            </button>
          )
        })}
      </div>
      {taskFilter !== 'all' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: C.mut }}>🔎 Filtrando: <strong style={{ color: C.txt }}>{taskFilter === 'pending' ? 'A fazer' : taskFilter === 'overdue' ? 'Vencidas' : taskFilter === 'done' ? 'Concluídas' : 'Sem responsável'}</strong></span>
          <button onClick={() => setTaskFilter('all')} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '4px 10px', color: C.mut, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>✕ limpar filtro</button>
        </div>
      )}

      {/* Ocorrências relatadas pela equipe pelo app — sempre visível (é o canal de avisos deles) */}
      {(() => {
        const icon = (c: string) => c === 'compra' ? '🛒' : c === 'equipamento' ? '🔧' : c === 'limpeza' ? '🧹' : c === 'seguranca' ? '🛡️' : '📋'
        const linha = (r: StaffReport) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brd}33`, opacity: r.status === 'resolvido' ? 0.6 : 1 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>{icon(r.category)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.txt, fontSize: 13, fontWeight: 600, textDecoration: r.status === 'resolvido' ? 'line-through' : 'none' }}>{r.message}</div>
              <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
                {r.target === 'lider' ? '👤 Líder' : '🏢 ADM'} · {r.author_name ?? '—'}
                {r.event_name ? ` · 🎉 ${r.event_name}` : ''} · {new Date(r.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            {r.status === 'resolvido'
              ? <button onClick={() => reopenReport(r.id)} title="Reabrir"
                  style={{ flexShrink: 0, background: 'none', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>↩ Reabrir</button>
              : <button onClick={() => resolveReport(r.id)} title="Marcar como resolvido"
                  style={{ flexShrink: 0, background: C.grn + '22', border: `1px solid ${C.grn}55`, color: C.grn, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✓ Resolver</button>}
          </div>
        )
        return (
          <div style={{ background: C.bg, border: `1px solid ${openReports.length > 0 ? C.gold + '66' : C.brd}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: openReports.length ? 8 : 0 }}>
              <span style={{ color: openReports.length > 0 ? C.gold : C.sub, fontWeight: 800, fontSize: 14 }}>
                📣 Ocorrências da equipe {openReports.length > 0 ? `(${openReports.length} aberta${openReports.length > 1 ? 's' : ''})` : ''}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={loadReports} title="Atualizar"
                  style={{ background: 'none', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🔄</button>
                {doneReports.length > 0 && (
                  <button onClick={() => setShowResolved(v => !v)}
                    style={{ background: 'none', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {showResolved ? 'Ocultar resolvidas' : `Resolvidas (${doneReports.length})`}
                  </button>
                )}
              </div>
            </div>
            {openReports.length === 0 && !showResolved && (
              <div style={{ color: C.mut, fontSize: 12, padding: '6px 0' }}>
                Nenhuma ocorrência aberta. A equipe relata pelo app em <strong style={{ color: C.sub }}>📣 Relatar ocorrência</strong> (ex.: “precisa comprar morango”, “não tem cadeiras”).
              </div>
            )}
            {openReports.map(linha)}
            {showResolved && doneReports.map(linha)}
          </div>
        )
      })()}

      {/* Visão + nova tarefa (some quando há filtro ativo) */}
      {taskFilter === 'all' && (<>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {([['evento', '🎉 Por evento'], ['area', '🍳 Por área'], ['colaborador', '👤 Por colaborador'], ['diaadia', '🧹 Dia a dia']] as const).map(([v, l]) => (
          <button key={v} onClick={() => setView(v)} style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${view === v ? C.acc : C.brd}`, background: view === v ? C.acc + '22' : 'transparent', color: view === v ? C.acc : C.mut, fontSize: 13, fontWeight: view === v ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => { setTplSel(null); setTplOpen(true) }} title="Checklist padrão por tipo de evento" style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #a78bfa55', background: '#a78bfa18', color: '#a78bfa', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🧩 Modelos</button>
        <button onClick={() => openAssign(null)} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>➕ Nova tarefa</button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.mut, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.acc, cursor: 'pointer' }} />
        Mostrar tarefas já concluídas
      </label>
      </>)}

      {/* Lista filtrada — quando um card do dashboard está ativo */}
      {taskFilter !== 'all' && (() => {
        const match = tasks.filter(t => {
          const isDone = t.status === 'done'
          if (taskFilter === 'done') return isDone
          if (taskFilter === 'pending') return !isDone
          if (taskFilter === 'overdue') return !isDone && !!t.deadline && new Date(t.deadline).getTime() < now
          if (taskFilter === 'unassigned') return !ownerOf(t)
          return true
        })
        const ordered = [...match].sort((a, b) => (a.deadline ?? '~').localeCompare(b.deadline ?? '~'))
        return (
          <Card style={{ marginBottom: 14 }}>
            {ordered.length === 0
              ? <div style={{ textAlign: 'center', color: C.mut, padding: 32 }}>Nenhuma tarefa neste filtro.</div>
              : ordered.map(t => taskRow(t, taskFilter === 'unassigned', true))}
          </Card>
        )
      })()}

      {loadErr && (
        <Card style={{ marginBottom: 14, border: `1px solid ${C.red}55` }}>
          <div style={{ color: C.red, fontWeight: 700, fontSize: 14, marginBottom: 4 }}>⚠️ Erro ao carregar</div>
          <div style={{ color: C.mut, fontSize: 12, wordBreak: 'break-word' }}>{loadErr}</div>
          <button onClick={() => { setLoading(true); load() }} style={{ marginTop: 10, background: C.acc + '18', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '7px 14px', color: C.acc, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 Tentar de novo</button>
        </Card>
      )}

      {/* Não atribuídas — tarefas "delegar depois" da Produção */}
      {taskFilter === 'all' && unassigned.length > 0 && (
        <Card style={{ marginBottom: 14, border: `1px solid ${C.gold}44` }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.gold, marginBottom: 4 }}>⚠️ {unassigned.length} tarefa(s) sem responsável</div>
          <div style={{ color: C.mut, fontSize: 12, marginBottom: 8 }}>Escolha quem executa cada uma para enviar à agenda dele.</div>
          {unassigned.map(t => taskRow(t, true))}
        </Card>
      )}

      {taskFilter === 'all' && view === 'colaborador' && (sortedTeam.length === 0 ? (
        <Card><div style={{ textAlign: 'center', color: C.mut, padding: 40 }}>Nenhum colaborador cadastrado. Adicione na aba Equipe.</div></Card>
      ) : sortedTeam.map(m => {
        const list = (byMember.get(m.id) ?? []).filter(t => showDone || t.status !== 'done')
        const all = byMember.get(m.id) ?? []
        const s = statOf(all)
        const isFunc = m.staff_type === 'funcionario'
        const open = expanded === m.id
        // tarefas agrupadas por evento (ou avulsas)
        const groups: Record<string, AdminTask[]> = {}
        list.forEach(t => { const k = t.events?.name ?? '📌 Avulsas'; (groups[k] = groups[k] || []).push(t) })
        return (
          <Card key={m.id} style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: (isFunc ? C.grn : C.acc) + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{isFunc ? '🧑‍💼' : '👷'}</div>
              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setExpanded(open ? null : m.id)}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name}</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: 12 }}>
                  <span style={{ color: C.gold, fontWeight: 700 }}>{s.pending} <span style={{ color: C.mut, fontWeight: 400 }}>a fazer</span></span>
                  <span style={{ color: C.grn, fontWeight: 700 }}>{s.done} <span style={{ color: C.mut, fontWeight: 400 }}>ok</span></span>
                  {s.overdue > 0 && <span style={{ color: C.red, fontWeight: 700 }}>{s.overdue} vencida(s)</span>}
                </div>
              </div>
              <button onClick={() => openAssign(m)} title="Atribuir tarefa" style={{ background: C.acc + '18', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '6px 10px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>➕ Tarefa</button>
              <button onClick={() => sendLink(m)} title="Enviar link da agenda no WhatsApp" style={{ background: '#25D36618', border: '1px solid #25D36644', borderRadius: 8, padding: '6px 9px', color: '#25D366', fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>📲</button>
              <span onClick={() => setExpanded(open ? null : m.id)} style={{ color: C.mut, fontSize: 15, cursor: 'pointer', flexShrink: 0 }}>{open ? '▼' : '▶'}</span>
            </div>
            {open && (
              <div style={{ padding: '0 14px 14px' }}>
                {all.length === 0
                  ? <div style={{ color: C.mut, fontSize: 13, padding: '8px 0' }}>Nenhuma tarefa atribuída.</div>
                  : Object.entries(groups).map(([g, ts]) => (
                    <div key={g}>
                      <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', margin: '10px 0 2px' }}>{g}</div>
                      {ts.map(t => taskRow(t))}
                    </div>
                  ))}
              </div>
            )}
          </Card>
        )
      }))}

      {/* ── VISÃO POR EVENTO — card do evento (data, reservas, listas) + tarefas abaixo ── */}
      {taskFilter === 'all' && view === 'evento' && (() => {
        const evList = [...events].sort((a, b) => a.event_date.localeCompare(b.event_date))
        const todayStr = new Date().toISOString().slice(0, 10)
        return (<>
          {evList.length === 0
            ? <Card><div style={{ textAlign: 'center', color: C.mut, padding: 40 }}>Nenhum evento no período.</div></Card>
            : evList.map(ev => {
              const evTasks = tasks.filter(t => t.event_id === ev.id && (showDone || t.status !== 'done'))
              const allEvTasks = tasks.filter(t => t.event_id === ev.id)
              const s = statOf(allEvTasks)
              const resN = resByEvent[ev.id] ?? resByDate[ev.event_date] ?? 0
              const listN = listByEvent[ev.id] ?? 0
              const isToday = ev.event_date === todayStr
              return (
                <Card key={ev.id} style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: evTasks.length ? `1px solid ${C.brd}` : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: C.txt, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          {ev.name}
                          {isToday && <span style={{ background: C.grn + '22', color: C.grn, border: `1px solid ${C.grn}44`, borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>Hoje</span>}
                        </div>
                        <div style={{ color: C.mut, fontSize: 12, marginTop: 2, textTransform: 'capitalize' }}>📅 {fmtDate(ev.event_date)}{ev.start_time ? ` · 🕒 ${ev.start_time.slice(0, 5)}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {tpls.length > 0 && <button onClick={() => setApplyEv(ev)} title="Gerar as tarefas de um modelo neste evento" style={{ background: '#a78bfa18', border: '1px solid #a78bfa55', borderRadius: 8, padding: '6px 10px', color: '#a78bfa', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>⚡ Gerar</button>}
                        <button onClick={() => openAssign(null, ev.id)} title="Enviar tarefa deste evento" style={{ background: C.acc + '18', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '6px 10px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>➕ Tarefa</button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 10, fontSize: 12 }}>
                      <span style={{ color: C.gold, fontWeight: 700 }}>🪑 {resN} <span style={{ color: C.mut, fontWeight: 400 }}>reservas</span></span>
                      <span style={{ color: '#a78bfa', fontWeight: 700 }}>📋 {listN} <span style={{ color: C.mut, fontWeight: 400 }}>listas</span></span>
                      <span style={{ color: C.acc, fontWeight: 700 }}>✅ {s.done}/{s.total} <span style={{ color: C.mut, fontWeight: 400 }}>tarefas</span></span>
                      {s.overdue > 0 && <span style={{ color: C.red, fontWeight: 700 }}>{s.overdue} vencida(s)</span>}
                    </div>
                  </div>
                  {evTasks.length > 0 && (
                    <div style={{ padding: '4px 16px 12px' }}>
                      {(() => {
                        const grupos = agruparPorArea(evTasks)
                        // Com uma area so, exigir o clique seria burocracia inutil
                        const unica = grupos.length === 1 ? grupos[0][0] : null
                        const aberta = areaAberta[ev.id] !== undefined ? areaAberta[ev.id] : unica
                        const daAberta = grupos.find(g => g[0] === aberta)?.[1] ?? []
                        return (<>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {grupos.map(([area]) => cartaoArea(
                              area,
                              allEvTasks.filter(x => (x.area || 'Geral') === area),
                              aberta === area,
                              () => setAreaAberta(p => ({ ...p, [ev.id]: p[ev.id] === area ? null : area })),
                            ))}
                          </div>
                          {aberta && daAberta.length > 0 && (
                            <div style={{ marginTop: 4 }}>
                              {faixaArea(aberta, allEvTasks.filter(x => (x.area || 'Geral') === aberta))}
                              {daAberta.map(t => taskRow(t, false, true))}
                            </div>
                          )}
                        </>)
                      })()}
                    </div>
                  )}
                </Card>
              )
            })}
        </>)
      })()}

      {/* ── VISÃO POR ÁREA — "o que ainda falta na cozinha" ── */}
      {taskFilter === 'all' && view === 'area' && (() => {
        const base = tasks.filter(t => showDone || t.status !== 'done')
        const grupos = agruparPorArea(base)
        return (<>
          {grupos.length === 0
            ? <Card><div style={{ textAlign: 'center', color: C.mut, padding: 40 }}>Nenhuma tarefa no período.</div></Card>
            : grupos.map(([area, list]) => {
              const todasDaArea = tasks.filter(x => (x.area || 'Geral') === area)
              const s = statOf(todasDaArea)
              const completa = s.total > 0 && s.done === s.total
              return (
                <Card key={area} style={{ marginBottom: 12, border: completa ? `1px solid ${C.grn}44` : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: completa ? C.grn : C.txt }}>
                      {completa ? '✅ ' : ''}{wlabel(area)}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                      <span style={{ color: completa ? C.grn : C.acc, fontWeight: 700 }}>{s.done}/{s.total} feitas</span>
                      {s.overdue > 0 && <span style={{ color: C.red, fontWeight: 700 }}>{s.overdue} vencida(s)</span>}
                    </div>
                  </div>
                  <div style={{ height: 6, background: C.bg, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', width: `${s.total ? Math.round(s.done / s.total * 100) : 0}%`, background: completa ? C.grn : `linear-gradient(90deg,${C.acc},#1d4ed8)`, borderRadius: 4, transition: 'width .3s' }} />
                  </div>
                  {list.length === 0
                    ? <div style={{ color: C.grn, fontSize: 13, padding: '6px 0' }}>Tudo pronto nesta área. 🎉</div>
                    : list.map(t => taskRow(t, !ownerOf(t), true))}
                </Card>
              )
            })}
        </>)
      })()}

      {/* ── VISÃO DIA A DIA — tarefas que não dependem de evento (rotinas) ── */}
      {taskFilter === 'all' && view === 'diaadia' && (() => {
        const dia = tasks.filter(t => !t.event_id)
        const list = dia.filter(t => showDone || t.status !== 'done')
        const groups = new Map<string, AdminTask[]>()
        list.forEach(t => { const o = ownerOf(t) ?? '__none__'; groups.set(o, [...(groups.get(o) ?? []), t]) })
        // sem responsável primeiro, depois colaboradores em ordem
        const ordered = [...groups.entries()].sort((a, b) => (a[0] === '__none__' ? -1 : b[0] === '__none__' ? 1 : 0))
        return (<>
          <Card style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: C.txt }}>🧹 Tarefas do dia a dia</div>
                <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>Rotinas que não dependem de um evento (limpeza, estoque, manutenção…)</div>
              </div>
              <button onClick={() => openAssign(null)} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg,${C.acc},#1d4ed8)`, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>➕ Nova do dia a dia</button>
            </div>
          </Card>
          {dia.length === 0
            ? <Card><div style={{ textAlign: 'center', color: C.mut, padding: 36 }}>Nenhuma tarefa do dia a dia. Toque em "➕ Nova do dia a dia".</div></Card>
            : ordered.map(([owner, ts]) => {
              const m = owner === '__none__' ? null : sortedTeam.find(x => x.id === owner)
              return (
                <Card key={owner} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 15 }}>{m ? (m.staff_type === 'funcionario' ? '🧑‍💼' : '👷') : '⚠️'}</span>
                    <span style={{ fontWeight: 700, fontSize: 14, color: m ? C.txt : C.gold }}>{m ? m.full_name : 'Sem responsável'}</span>
                  </div>
                  {ts.map(t => taskRow(t, owner === '__none__'))}
                </Card>
              )
            })}
        </>)
      })()}

      {/* ── Tarefas expiradas — eventos que já passaram e não foram concluídas (relatório) ── */}
      {expiredTasks.length > 0 && (
        <Card style={{ marginTop: 8, border: `1px dashed ${C.brd}` }}>
          <button onClick={() => setShowExpired(v => !v)} style={{ width: '100%', background: 'none', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            <span style={{ color: C.mut, fontSize: 13, fontWeight: 700 }}>⏰ {expiredTasks.length} tarefa(s) expirada(s) — não executadas em eventos que já passaram</span>
            <span style={{ color: C.mut, fontSize: 14 }}>{showExpired ? '▼' : '▶'}</span>
          </button>
          {showExpired && (() => {
            const byEvent: Record<string, AdminTask[]> = {}
            expiredTasks.forEach(t => { const k = `${t.events?.name ?? '—'} · ${t.events?.event_date ? fmtDate(t.events.event_date) : ''}`; (byEvent[k] = byEvent[k] || []).push(t) })
            return <div style={{ marginTop: 10 }}>{Object.entries(byEvent).map(([ev, ts]) => (
              <div key={ev} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, textTransform: 'capitalize', margin: '6px 0 2px' }}>{ev}</div>
                {ts.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.brd}22`, opacity: 0.75 }}>
                    <span style={{ flex: 1, minWidth: 0, color: C.sub, fontSize: 13 }}>{t.title}{whoOf(t) ? <span style={{ color: C.mut, fontSize: 11 }}> · {whoOf(t)}</span> : null}</span>
                    <span style={{ fontSize: 10, color: C.red, background: C.red + '18', border: `1px solid ${C.red}33`, borderRadius: 6, padding: '1px 7px', fontWeight: 700, whiteSpace: 'nowrap' }}>expirada</span>
                    <button onClick={() => del(t)} title="Remover" style={{ background: 'none', border: 'none', color: C.mut, fontSize: 13, cursor: 'pointer' }}>🗑</button>
                  </div>
                ))}
              </div>
            ))}</div>
          })()}
        </Card>
      )}

      {/* Modal: atribuir nova tarefa (colaborador buscável + evento opcional) */}
      <Modal open={assignOpen} title="➕ Nova tarefa" onClose={closeAssign} noDirtyCheck>
        <div style={{ display: 'grid', gap: 10 }}>
          {/* Colaborador: escolhido ou buscável */}
          {assignFor ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.acc + '14', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '8px 12px' }}>
              <span style={{ fontSize: 16 }}>{assignFor.staff_type === 'funcionario' ? '🧑‍💼' : '👷'}</span>
              <span style={{ flex: 1, color: C.txt, fontWeight: 700, fontSize: 14 }}>{assignFor.full_name}</span>
              <button onClick={() => setAssignFor(null)} style={{ background: 'none', border: 'none', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>trocar</button>
            </div>
          ) : (
            <div>
              <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Para quem? *</label>
              <input value={assignSearch} onChange={e => setAssignSearch(e.target.value)} placeholder="🔍 Buscar colaborador pelo nome…" autoFocus style={inp} />
              {assignSearch.trim() && (
                <div style={{ maxHeight: 200, overflowY: 'auto', border: `1px solid ${C.brd}`, borderRadius: 8, marginTop: 6 }}>
                  {sortedTeam.filter(m => m.full_name.toLowerCase().includes(assignSearch.trim().toLowerCase())).slice(0, 30).map(m => (
                    <div key={m.id} onClick={() => { setAssignFor(m); setAssignSearch('') }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: `1px solid ${C.brd}22`, cursor: 'pointer' }}>
                      <span style={{ fontSize: 15 }}>{m.staff_type === 'funcionario' ? '🧑‍💼' : '👷'}</span>
                      <span style={{ color: C.txt, fontSize: 14 }}>{m.full_name}</span>
                    </div>
                  ))}
                  {sortedTeam.filter(m => m.full_name.toLowerCase().includes(assignSearch.trim().toLowerCase())).length === 0 && (
                    <div style={{ color: C.mut, fontSize: 13, padding: '10px 12px' }}>Nenhum colaborador encontrado.</div>
                  )}
                </div>
              )}
            </div>
          )}
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Título da tarefa *" style={inp} />
          <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Descrição (opcional)" style={{ ...inp, height: 60, resize: 'vertical' }} />
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Área</label>
            <select value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))} style={inp}>
              <option value="">📋 Geral</option>
              {workAreas.map(a => <option key={a.key} value={a.key}>{a.icon} {a.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: C.mut, marginTop: 3 }}>
              É por aqui que a tarefa aparece agrupada na agenda de quem executa.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Subtarefas (opcional) — <span style={{ fontWeight: 400 }}>uma por linha</span>
            </label>
            <textarea value={formSteps} onChange={e => setFormSteps(e.target.value)}
              placeholder={'Limpar chapa\nLimpar coifa\nRetirar óleo'}
              style={{ ...inp, height: 76, resize: 'vertical' }} />
            <div style={{ fontSize: 11, color: C.mut, marginTop: 3 }}>
              A tarefa vira uma checklist e se conclui sozinha quando o último item for marcado.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Prazo (opcional)</label>
            <input type="datetime-local" value={form.deadline} onChange={e => setForm(p => ({ ...p, deadline: e.target.value }))} style={inp} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: C.mut, fontWeight: 600, display: 'block', marginBottom: 4 }}>Evento (opcional)</label>
            <select value={form.event_id} onChange={e => setForm(p => ({ ...p, event_id: e.target.value }))} style={inp}>
              <option value="">📌 Sem evento (tarefa avulsa)</option>
              {events.map(ev => <option key={ev.id} value={ev.id}>🎉 {ev.name} — {new Date(ev.event_date + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</option>)}
            </select>
          </div>
          <Btn onClick={assign} disabled={saving} style={{ width: '100%' }}>{saving ? 'Enviando…' : '✅ Enviar para a agenda'}</Btn>
        </div>
      </Modal>

      {/* ── Modelos de tarefas: monta-se a checklist uma vez e gera-se a cada evento ── */}
      <Modal open={tplOpen} title="🧩 Modelos de tarefas" maxWidth={720} onClose={() => { setTplOpen(false); setTplSel(null); setTplItems([]) }} noDirtyCheck>
        {(() => {
          const inp: React.CSSProperties = { width: '100%', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '9px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }
          if (!tplSel) return (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ color: C.mut, fontSize: 13 }}>
                Monte a checklist padrão de um tipo de evento (ex.: <b style={{ color: C.txt }}>Terça Bandida</b>). Depois, em cada evento, o botão <b style={{ color: '#a78bfa' }}>⚡ Gerar</b> cria as tarefas para quem estiver escalado em cada área.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={tplNewName} onChange={e => setTplNewName(e.target.value)} placeholder="Nome do modelo (ex.: Terça Bandida)" style={inp} />
                <Btn onClick={criarTpl} small>➕ Criar</Btn>
              </div>
              {tpls.length === 0
                ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: 22 }}>Nenhum modelo ainda.</div>
                : tpls.map(tp => (
                  <div key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px' }}>
                    <span style={{ flex: 1, color: C.txt, fontWeight: 700, fontSize: 14 }}>🧩 {tp.name}</span>
                    <button onClick={() => openTplItems(tp)} style={{ background: C.acc + '18', border: `1px solid ${C.acc}44`, borderRadius: 8, padding: '6px 10px', color: C.acc, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>✏️ Editar</button>
                    <button onClick={() => delTpl(tp)} style={{ background: 'none', border: `1px solid ${C.red}44`, borderRadius: 8, padding: '6px 10px', color: C.red, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🗑</button>
                  </div>
                ))}
            </div>
          )
          const porArea: Record<string, TplItem[]> = {}
          tplItems.forEach(i => { (porArea[i.area] = porArea[i.area] || []).push(i) })
          return (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => { setTplSel(null); setTplItems([]) }} style={{ background: 'none', border: `1px solid ${C.brd}`, borderRadius: 8, padding: '6px 10px', color: C.mut, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>← Modelos</button>
                <span style={{ color: C.txt, fontWeight: 800, fontSize: 15 }}>🧩 {tplSel.name}</span>
                <span style={{ color: C.mut, fontSize: 12 }}>{tplItems.length} tarefa(s)</span>
              </div>
              <div style={{ background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
                <input value={itForm.title} onChange={e => setItForm(p => ({ ...p, title: e.target.value }))} placeholder="Título da tarefa *" style={inp} />
                <input value={itForm.description ?? ''} onChange={e => setItForm(p => ({ ...p, description: e.target.value }))} placeholder="Descrição (opcional)" style={inp} />
                <textarea value={itSteps} onChange={e => setItSteps(e.target.value)}
                  placeholder={'Subtarefas (opcional), uma por linha:\nLimpar chapa\nLimpar coifa'}
                  style={{ ...inp, height: 70, resize: 'vertical' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={itForm.area} onChange={e => setItForm(p => ({ ...p, area: e.target.value }))} style={inp}>
                    <option value="">Área *</option>
                    {workAreas.map(a => <option key={a.key} value={a.key}>{a.icon} {a.label}</option>)}
                  </select>
                  <select value={String(itForm.offset_min ?? '')} onChange={e => setItForm(p => ({ ...p, offset_min: e.target.value === '' ? null : Number(e.target.value) }))} style={inp}>
                    {OFFSETS.map(([l, v]) => <option key={l} value={v === null ? '' : String(v)}>{l}</option>)}
                  </select>
                </div>
                <Btn onClick={addItem} small style={{ width: '100%' }}>➕ Incluir no modelo</Btn>
              </div>
              {tplItems.length === 0
                ? <div style={{ color: C.mut, fontSize: 13, textAlign: 'center', padding: 18 }}>Modelo vazio — inclua a primeira tarefa acima.</div>
                : Object.entries(porArea).map(([area, its]) => (
                  <div key={area}>
                    <div style={{ fontSize: 11, color: C.mut, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', margin: '8px 0 4px' }}>{wlabel(area)}</div>
                    {its.map(i => (
                      <div key={i.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brd}22` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: C.txt, fontSize: 14, fontWeight: 700 }}>{i.title}</div>
                          {i.description && <div style={{ color: C.mut, fontSize: 12 }}>{i.description}</div>}
                          <div style={{ color: C.mut, fontSize: 11, marginTop: 2 }}>
                            ⏰ {OFFSETS.find(([, v]) => v === (i.offset_min ?? null))?.[0] ?? 'Sem prazo'}
                            {(i.steps?.length ?? 0) > 0 && ` · ☑️ ${i.steps!.length} subtarefa(s)`}
                          </div>
                        </div>
                        <button onClick={() => delItem(i.id)} style={{ background: 'none', border: 'none', color: C.red, fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>🗑</button>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )
        })()}
      </Modal>

      {/* ── Gerar as tarefas de um modelo em um evento ── */}
      <Modal open={!!applyEv} title={`⚡ Gerar tarefas — ${applyEv?.name ?? ''}`} onClose={() => setApplyEv(null)} noDirtyCheck>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ color: C.mut, fontSize: 13 }}>
            Cada tarefa do modelo vai para <b style={{ color: C.txt }}>quem já está escalado na área</b> dela. Escale a equipe antes; gerar de novo depois não duplica o que já existe.
          </div>
          {tpls.map(tp => (
            <button key={tp.id} onClick={() => gerar(tp.id)} disabled={applying}
              style={{ textAlign: 'left', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '12px 14px', color: C.txt, fontSize: 14, fontWeight: 700, cursor: applying ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: applying ? 0.6 : 1 }}>
              🧩 {tp.name}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}
