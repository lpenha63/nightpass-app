import { C, RC, RL } from '../constants/theme'
import { Pill } from './ui'
import { useWhatsAppStatus } from '../hooks/useWhatsAppStatus'
import type { Session } from '../types'

export type PageId =
  | 'dashboard' | 'checkin' | 'clients' | 'events'
  | 'reservas' | 'promoters' | 'reports'
  | 'whatsapp' | 'users' | 'freelancers' | 'settings'

interface NavItem {
  id: PageId
  icon: string
  label: string
  adminOnly?: boolean
  badge?: number
}

const NAV: NavItem[] = [
  { id: 'dashboard',   icon: 'house-fill',            label: 'Dashboard' },
  { id: 'checkin',     icon: 'person-check-fill',     label: 'Check-in' },
  { id: 'clients',     icon: 'person-lines-fill',     label: 'Clientes' },
  { id: 'events',      icon: 'calendar-event-fill',   label: 'Eventos' },
  { id: 'reservas',    icon: 'calendar2-check-fill',  label: 'Reservas' },
  { id: 'promoters',   icon: 'megaphone-fill',        label: 'Promoters' },
  { id: 'freelancers', icon: 'people-fill',           label: 'Equipe' },
  { id: 'reports',     icon: 'graph-up-arrow',        label: 'Relatórios' },
  { id: 'whatsapp',    icon: 'whatsapp',              label: 'WhatsApp' },
  { id: 'users',       icon: 'person-gear',           label: 'Usuários',      adminOnly: true },
  { id: 'settings',    icon: 'gear-fill',             label: 'Configurações', adminOnly: true },
]

interface SidebarProps {
  session: Session
  active: PageId
  setActive: (id: PageId) => void
  mOpen: boolean
  setMOpen: (v: boolean) => void
  newCI: number
  pendingRatings?: number
  onLogout: () => void
}

export function Sidebar({ session, active, setActive, mOpen, setMOpen, newCI, pendingRatings = 0, onLogout }: SidebarProps) {
  const isAdmin = ['super_admin', 'admin'].includes(session.role)
  const waStatus = useWhatsAppStatus(session.house.id)
  const waDot: Record<string, { color: string; title: string }> = {
    open: { color: '#22c55e', title: 'WhatsApp conectado' },
    connecting: { color: '#f59e0b', title: 'WhatsApp conectando…' },
    close: { color: '#ef4444', title: 'WhatsApp desconectado' },
    off: { color: '#6b7280', title: 'WhatsApp desativado' },
    loading: { color: '#6b7280', title: 'Verificando WhatsApp…' },
  }

  return (
    <>
      {/* Mobile overlay */}
      {mOpen && (
        <div
          onClick={() => setMOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 99 }}
        />
      )}

      {/* Burger button */}
      <button className="np-burger" onClick={() => setMOpen(!mOpen)}>☰</button>

      {/* Sidebar */}
      <aside
        className={`np-sb${mOpen ? ' open' : ''}`}
        style={{
          width: 240, minWidth: 240,
          background: 'rgba(10,14,26,0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRight: '1px solid rgba(59,130,246,0.12)',
          display: 'flex', flexDirection: 'column',
          height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 100,
          boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
        }}
      >
        {/* Logo */}
        <div style={{
          padding: '18px 16px', borderBottom: `1px solid ${C.brd}`,
          background: `linear-gradient(135deg,${C.acd}18,transparent)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            {session.house.logo_url
              ? <img src={session.house.logo_url} alt={session.house.name} style={{ width: 34, height: 34, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
              : <div style={{ width: 34, height: 34, background: `linear-gradient(135deg,${C.acd},${C.acc})`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, boxShadow: `0 0 14px ${C.acd}55` }}>🎭</div>
            }
            <div style={{ color: C.txt, fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>
              {session.house.name || 'NightPass'}
            </div>
          </div>
          <Pill color={RC[session.role] || C.mut} small>
            {RL[session.role] || session.role}
          </Pill>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
          {NAV.filter(n => {
            if (n.adminOnly && !isAdmin) return false
            return session.allowedPages.includes(n.id)
          }).map(n => {
            const isActive = active === n.id
            const badgeCount = n.id === 'checkin' ? newCI : n.id === 'freelancers' ? pendingRatings : 0
            const badgeColor = n.id === 'freelancers' ? '#f59e0b' : C.acc
            const showBadge = badgeCount > 0
            return (
              <button
                key={n.id}
                onClick={() => { setActive(n.id); setMOpen(false) }}
                style={{
                  width: '100%',
                  background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(59,130,246,0.3)' : 'transparent'}`,
                  borderRadius: 12,
                  padding: '11px 14px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  color: isActive ? C.acc : C.mut,
                  fontSize: 15,
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  marginBottom: 4,
                  textAlign: 'left',
                  boxShadow: isActive ? '0 0 20px rgba(59,130,246,0.08)' : 'none',
                  fontFamily: 'inherit',
                }}
              >
                <i
                  className={`bi bi-${n.icon}`}
                  style={{ fontSize: 18, opacity: isActive ? 1 : 0.6, flexShrink: 0, lineHeight: 1 }}
                />
                <span style={{ flex: 1 }}>{n.label}</span>
                {n.id === 'whatsapp' && (() => {
                  const d = waDot[waStatus] ?? waDot.off
                  return (
                    <span title={d.title} style={{
                      width: 9, height: 9, borderRadius: '50%', background: d.color, flexShrink: 0,
                      boxShadow: waStatus === 'open' ? `0 0 7px ${d.color}` : 'none',
                      animation: waStatus === 'connecting' ? 'pulse 1.5s ease-in-out infinite' : 'none',
                    }} />
                  )
                })()}
                {showBadge && (
                  <span style={{
                    background: badgeColor, color: '#fff',
                    fontSize: 10, fontWeight: 800,
                    padding: '2px 7px', borderRadius: 10,
                    minWidth: 18, textAlign: 'center', lineHeight: '16px',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}>
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* Logout */}
        <div style={{ padding: '12px 10px', borderTop: `1px solid rgba(59,130,246,0.08)` }}>
          <button
            onClick={onLogout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: 12,
              background: 'none', border: `1px solid rgba(255,255,255,0.07)`,
              color: C.mut, fontSize: 14, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <i className="bi bi-box-arrow-left" style={{ fontSize: 16 }} />
            Sair
          </button>
        </div>
      </aside>
    </>
  )
}
