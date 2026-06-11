import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { C, RC, RL } from '../constants/theme'
import { Card, Toast, Btn, Modal, Pill } from '../components/ui'
import { sT, type ToastState } from '../utils/toast'
import { ROLE_PAGES, ALL_PAGES, PAGE_LABELS, PAGE_ICONS } from '../constants/permissions'
import type { House } from '../types'

interface Props { house: House; user: { id: string; email: string }; role: string }

interface HouseUser {
  id: string
  user_id: string
  house_id: string
  role: string
  is_active: boolean
  allowed_pages: string[] | null
  freelancer_id: string | null
  created_at: string
  profiles?: { full_name?: string; email?: string }
  freelancers?: { full_name: string; phone?: string }
}

interface StaffOption { id: string; full_name: string; staff_type?: string }

const ROLES_LIST = [
  { value: 'super_admin', label: 'Super Admin',    desc: 'Acesso total ao sistema',                      pages: 11 },
  { value: 'admin',       label: 'Administrador',  desc: 'Gerencia tudo, incluindo usuários',             pages: 11 },
  { value: 'operador',    label: 'Operador',        desc: 'Check-in, clientes, eventos e reservas',        pages: 6  },
  { value: 'portaria',    label: 'Portaria',        desc: 'Somente acesso ao check-in de clientes',        pages: 1  },
  { value: 'financeiro',  label: 'Financeiro',      desc: 'Dashboard, eventos e relatórios financeiros',   pages: 3  },
  { value: 'promoter',    label: 'Promoter',        desc: 'Gerencia suas listas e visualiza clientes',     pages: 2  },
]

const SEL: React.CSSProperties = {
  width: '100%', background: C.inp, border: `1px solid ${C.brd}`,
  borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14,
  fontFamily: 'inherit', outline: 'none',
}

const INP: React.CSSProperties = { ...SEL }

function initials(name?: string) {
  if (!name) return '?'
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

export function UsersPage({ house, user: currentUser, role: currentRole }: Props) {
  const [users, setUsers]   = useState<HouseUser[]>([])
  const [staff, setStaff]   = useState<StaffOption[]>([])
  const [toast, setToast]   = useState<ToastState | null>(null)
  const [ldg, setLdg]       = useState(true)

  // ─── Edit modal ───
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [editRole, setEditRole]           = useState('operador')
  const [editFreelancer, setEditFreelancer] = useState('')
  const [customPages, setCustomPages]     = useState(false)
  const [editPages, setEditPages]         = useState<string[]>([])
  const [saving, setSaving]               = useState(false)

  // ─── Invite modal ───
  const [showInvite, setShowInvite]       = useState(false)
  const [invEmail, setInvEmail]           = useState('')
  const [invFreelancer, setInvFreelancer] = useState('')
  const [invRole, setInvRole]             = useState('operador')
  const [invStatus, setInvStatus]         = useState<'idle'|'checking'|'found'|'notfound'>('idle')
  const [invSending, setInvSending]       = useState(false)
  const [invFoundId, setInvFoundId]       = useState<string | null>(null)

  function load() {
    supabase.from('house_users')
      .select('*,profiles(full_name,email),freelancers(full_name,phone)')
      .eq('house_id', house.id)
      .order('created_at')
      .then(r => { setLdg(false); if (!r.error) setUsers((r.data ?? []) as HouseUser[]) })
  }

  useEffect(() => {
    load()
    supabase.from('freelancers').select('id,full_name,staff_type').eq('house_id', house.id).eq('status','active')
      .then(r => setStaff((r.data ?? []) as StaffOption[]))
  }, [house.id])

  // ─── Edit helpers ───
  const editing = users.find(u => u.id === editingId) ?? null

  function openEdit(hu: HouseUser) {
    setEditingId(hu.id)
    setEditRole(hu.role)
    setEditFreelancer(hu.freelancer_id ?? '')
    const hasCust = !!(hu.allowed_pages?.length)
    setCustomPages(hasCust)
    setEditPages(hasCust ? hu.allowed_pages! : (ROLE_PAGES[hu.role] ?? [...ALL_PAGES]))
  }

  function onRoleChange(r: string) {
    setEditRole(r)
    if (!customPages) setEditPages(ROLE_PAGES[r] ?? [...ALL_PAGES])
  }

  function toggleCustom(on: boolean) {
    setCustomPages(on)
    if (!on) setEditPages(ROLE_PAGES[editRole] ?? [...ALL_PAGES])
  }

  function togglePage(p: string) {
    setEditPages(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase.from('house_users').update({
      role: editRole,
      freelancer_id: editFreelancer || null,
      allowed_pages: customPages ? editPages : null,
    }).eq('id', editing.id)
    setSaving(false)
    if (error) { sT(setToast, '❌ Erro ao salvar', 'error'); return }
    sT(setToast, '✅ Acesso atualizado!', 'success')
    setEditingId(null)
    load()
  }

  async function toggleActive(hu: HouseUser) {
    if (hu.user_id === currentUser.id) return
    await supabase.from('house_users').update({ is_active: !hu.is_active }).eq('id', hu.id)
    load()
  }

  // ─── Invite helpers ───
  async function checkEmail() {
    if (!invEmail.trim()) return
    setInvStatus('checking')
    const { data } = await supabase.from('profiles').select('id,full_name').eq('email', invEmail.trim().toLowerCase()).maybeSingle()
    if (data) { setInvFoundId(data.id); setInvStatus('found') }
    else { setInvFoundId(null); setInvStatus('notfound') }
  }

  async function sendInvite() {
    setInvSending(true)

    if (invFoundId) {
      // User exists → create house_users directly
      const { error } = await supabase.from('house_users').insert({
        user_id: invFoundId,
        house_id: house.id,
        role: invRole,
        freelancer_id: invFreelancer || null,
        is_active: true,
      })
      if (error) { sT(setToast, '❌ Erro: ' + error.message, 'error'); setInvSending(false); return }
      sT(setToast, '✅ Acesso criado com sucesso!', 'success')
    } else {
      // User not registered yet → create pending invite
      const { error } = await supabase.from('house_invites').insert({
        house_id: house.id,
        invited_email: invEmail.trim().toLowerCase(),
        role: invRole,
        freelancer_id: invFreelancer || null,
        created_by: currentUser.id,
      })
      if (error) { sT(setToast, '❌ Erro ao salvar convite', 'error'); setInvSending(false); return }
      sT(setToast, '📨 Convite registrado! Assim que o colaborador criar conta, ele terá acesso.', 'success')
    }

    setShowInvite(false)
    setInvEmail(''); setInvFreelancer(''); setInvRole('operador'); setInvStatus('idle'); setInvFoundId(null); setInvSending(false)
    load()
  }

  const isAdmin = ['super_admin','admin'].includes(currentRole)
  const effPages = (hu: HouseUser) => hu.allowed_pages?.length ? hu.allowed_pages : (ROLE_PAGES[hu.role] ?? [...ALL_PAGES])

  if (ldg) return <div style={{ padding: 60, textAlign: 'center', color: C.mut }}>Carregando...</div>

  return (
    <div style={{ paddingBottom: 40 }}>
      <Toast toast={toast} />

      {/* ─── Header ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: C.txt, margin: 0 }}>Usuários do Sistema</h1>
          <p style={{ color: C.mut, fontSize: 14, marginTop: 4 }}>{users.length} colaborador{users.length !== 1 ? 'es' : ''} com acesso</p>
        </div>
        {isAdmin && (
          <Btn onClick={() => { setShowInvite(true); setInvStatus('idle') }}>
            <i className="bi bi-person-plus-fill" style={{ marginRight: 6 }} />
            Adicionar
          </Btn>
        )}
      </div>

      {/* ─── User list ─── */}
      <div style={{ display: 'grid', gap: 12 }}>
        {users.map(hu => {
          const prof = hu.profiles as { full_name?: string; email?: string } | undefined
          const name = hu.freelancers?.full_name ?? prof?.full_name ?? prof?.email ?? 'Usuário'
          const email = prof?.email ?? '—'
          const isSelf = hu.user_id === currentUser.id
          const pages = effPages(hu)
          const color = RC[hu.role] ?? C.mut

          return (
            <Card key={hu.id} style={{ opacity: hu.is_active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                {/* Avatar */}
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: color + '22', border: `2px solid ${color}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color, fontWeight: 800, fontSize: 15,
                }}>
                  {initials(name)}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: C.txt, fontWeight: 700, fontSize: 15 }}>{name}</span>
                    {isSelf && <span style={{ color: C.acc, fontSize: 11, fontWeight: 600 }}>(você)</span>}
                    {!hu.is_active && <span style={{ color: C.red, fontSize: 11, fontWeight: 600 }}>INATIVO</span>}
                  </div>
                  <div style={{ color: C.mut, fontSize: 12, marginTop: 2 }}>{email}</div>

                  {/* Staff link */}
                  {hu.freelancers ? (
                    <div style={{ color: C.grn, fontSize: 12, marginTop: 4 }}>
                      <i className="bi bi-link-45deg" /> Equipe: {hu.freelancers.full_name}
                    </div>
                  ) : (
                    <div style={{ color: C.mut, fontSize: 12, marginTop: 4 }}>
                      <i className="bi bi-exclamation-circle" /> Não vinculado à equipe
                    </div>
                  )}

                  {/* Pages */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                    <Pill color={color} small>{RL[hu.role] ?? hu.role}</Pill>
                    {pages.slice(0, 4).map(p => (
                      <span key={p} style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 7px',
                        borderRadius: 6, background: C.brd, color: C.sub,
                      }}>
                        {PAGE_LABELS[p] ?? p}
                      </span>
                    ))}
                    {pages.length > 4 && (
                      <span style={{ fontSize: 10, color: C.mut }}>+{pages.length - 4}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {isAdmin && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Btn onClick={() => openEdit(hu)} variant="ghost" small>
                      <i className="bi bi-pencil-fill" style={{ marginRight: 4 }} />Editar
                    </Btn>
                    {!isSelf && (
                      <Btn onClick={() => toggleActive(hu)} variant={hu.is_active ? 'danger' : 'secondary'} small>
                        <i className={`bi bi-${hu.is_active ? 'lock-fill' : 'unlock-fill'}`} style={{ marginRight: 4 }} />
                        {hu.is_active ? 'Desativar' : 'Ativar'}
                      </Btn>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {/* ─── Edit modal ─── */}
      <Modal open={!!editingId} title="Editar Acesso" onClose={() => setEditingId(null)}>
        {editing && (
          <div style={{ display: 'grid', gap: 20 }}>

            {/* Colaborador */}
            <div>
              <label style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>
                COLABORADOR DA EQUIPE
              </label>
              <select value={editFreelancer} onChange={e => setEditFreelancer(e.target.value)} style={SEL}>
                <option value="">— Não vinculado —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name} {s.staff_type === 'funcionario' ? '(Funcionário)' : '(Freelancer)'}</option>)}
              </select>
              <p style={{ color: C.mut, fontSize: 11, marginTop: 5 }}>
                Usuários devem ser membros cadastrados na aba Equipe
              </p>
            </div>

            {/* Nível de acesso */}
            <div>
              <label style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>
                NÍVEL DE ACESSO
              </label>
              <div style={{ display: 'grid', gap: 6 }}>
                {ROLES_LIST.map(r => (
                  <button key={r.value} onClick={() => onRoleChange(r.value)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 10,
                      border: `2px solid ${editRole === r.value ? (RC[r.value] ?? C.acc) : C.brd}`,
                      background: editRole === r.value ? (RC[r.value] ?? C.acc) + '18' : 'transparent',
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: editRole === r.value ? (RC[r.value] ?? C.acc) : C.brd,
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: C.txt, fontWeight: 700, fontSize: 13 }}>{r.label}</div>
                      <div style={{ color: C.mut, fontSize: 11 }}>{r.desc}</div>
                    </div>
                    <span style={{ color: C.mut, fontSize: 11 }}>{r.pages} área{r.pages !== 1 ? 's' : ''}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Páginas */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: '0.06em' }}>
                  PÁGINAS PERMITIDAS
                </label>
                <button onClick={() => toggleCustom(!customPages)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 32, height: 18, borderRadius: 9, position: 'relative',
                    background: customPages ? C.acc : C.brd, transition: 'background .2s',
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', background: '#fff',
                      position: 'absolute', top: 2, left: customPages ? 16 : 2, transition: 'left .2s',
                    }} />
                  </div>
                  <span style={{ color: C.mut, fontSize: 11 }}>Personalizar</span>
                </button>
              </div>

              {!customPages ? (
                <div style={{ background: C.inp, borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ color: C.sub, fontSize: 11, marginBottom: 6 }}>Padrão do nível "{RL[editRole] ?? editRole}":</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(ROLE_PAGES[editRole] ?? [...ALL_PAGES]).map(p => (
                      <span key={p} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: C.brd, color: C.sub }}>
                        {PAGE_LABELS[p] ?? p}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[...ALL_PAGES].map(p => {
                    const on = editPages.includes(p)
                    return (
                      <button key={p} onClick={() => togglePage(p)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                          borderRadius: 8, border: `1px solid ${on ? C.acc : C.brd}`,
                          background: on ? C.acc + '18' : 'transparent',
                          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                        }}>
                        <i className={`bi bi-${PAGE_ICONS[p] ?? 'circle'}`}
                          style={{ fontSize: 14, color: on ? C.acc : C.mut, flexShrink: 0 }} />
                        <span style={{ color: on ? C.txt : C.mut, fontSize: 12, fontWeight: on ? 600 : 400 }}>
                          {PAGE_LABELS[p] ?? p}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={saveEdit} style={{ flex: 1 }}>
                {saving ? 'Salvando...' : '✅ Salvar'}
              </Btn>
              <Btn onClick={() => setEditingId(null)} variant="ghost">Cancelar</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Invite modal ─── */}
      <Modal open={showInvite} title="Adicionar Colaborador" onClose={() => { setShowInvite(false); setInvStatus('idle') }}>
        <div style={{ display: 'grid', gap: 16 }}>

          {/* Buscar integrante da equipe (primeiro passo) */}
          <div>
            <label style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
              👷 BUSCAR INTEGRANTE DA EQUIPE
            </label>
            <select value={invFreelancer} onChange={e => setInvFreelancer(e.target.value)} style={SEL}>
              <option value="">— Selecione o integrante —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <div style={{ color: C.mut, fontSize: 11, marginTop: 4 }}>Somente quem está cadastrado na aba Equipe pode receber acesso.</div>
          </div>

          {/* Email */}
          <div>
            <label style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
              E-MAIL DO COLABORADOR
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={invEmail} onChange={e => { setInvEmail(e.target.value); setInvStatus('idle') }}
                onKeyDown={e => e.key === 'Enter' && checkEmail()}
                placeholder="colaborador@email.com" style={{ ...INP, flex: 1 }} type="email" />
              <Btn onClick={checkEmail} variant="secondary">
                {invStatus === 'checking' ? '...' : 'Verificar'}
              </Btn>
            </div>
          </div>

          {/* Status feedback */}
          {invStatus === 'found' && (
            <div style={{ background: C.grn + '18', border: `1px solid ${C.grn}44`, borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ color: C.grn, fontWeight: 700, fontSize: 13 }}>✅ Usuário encontrado no sistema</div>
              <div style={{ color: C.sub, fontSize: 12, marginTop: 2 }}>O acesso será criado imediatamente.</div>
            </div>
          )}
          {invStatus === 'notfound' && (
            <div style={{ background: '#f59e0b18', border: '1px solid #f59e0b44', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 13 }}>⚠️ Usuário ainda não cadastrado</div>
              <div style={{ color: C.sub, fontSize: 12, marginTop: 4 }}>
                Um convite será registrado. Peça ao colaborador para acessar o sistema e clicar em
                {' '}<strong style={{ color: C.txt }}>"Criar conta"</strong> usando este e-mail.
                O acesso será liberado automaticamente.
              </div>
            </div>
          )}

          {/* Staff + Role (show after email checked) */}
          {(invStatus === 'found' || invStatus === 'notfound') && (
            <>
              <div>
                <label style={{ fontSize: 11, color: C.sub, fontWeight: 700, letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                  NÍVEL DE ACESSO
                </label>
                <select value={invRole} onChange={e => setInvRole(e.target.value)} style={SEL}>
                  {ROLES_LIST.map(r => <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Action */}
          <div style={{ display: 'flex', gap: 10 }}>
            {(invStatus === 'found' || invStatus === 'notfound') ? (
              <Btn onClick={sendInvite} style={{ flex: 1 }}>
                {invSending ? 'Salvando...' : invFoundId ? '✅ Criar Acesso' : '📨 Registrar Convite'}
              </Btn>
            ) : (
              <Btn onClick={checkEmail} style={{ flex: 1 }} variant="secondary">
                🔍 Verificar E-mail
              </Btn>
            )}
            <Btn onClick={() => { setShowInvite(false); setInvStatus('idle') }} variant="ghost">Cancelar</Btn>
          </div>

          <div style={{ background: C.inp, borderRadius: 10, padding: '12px 14px', borderLeft: `3px solid ${C.acc}` }}>
            <div style={{ color: C.acc, fontWeight: 700, fontSize: 12, marginBottom: 4 }}>ℹ️ Regra de acesso</div>
            <div style={{ color: C.mut, fontSize: 12, lineHeight: 1.6 }}>
              Somente colaboradores cadastrados na aba <strong style={{ color: C.txt }}>Equipe</strong> podem
              receber acesso ao sistema. Vincule o usuário ao membro da equipe correspondente.
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
