import { memo } from 'react'
import { C } from '../constants/theme'
import type { PageId } from './Sidebar'

interface BottomNavItem {
  id: PageId
  icon: string
  label: string
  emoji: string
  hasFill?: boolean
}

// speedometer2 não tem variante "-fill" no Bootstrap Icons — usá-la faz o ícone sumir ao ativar
const BOTTOM_NAV: BottomNavItem[] = [
  { id: 'checkin',   icon: 'door-open',      emoji: '🚪', label: 'Check-in', hasFill: true },
  { id: 'dashboard', icon: 'speedometer2',   emoji: '📊', label: 'Dashboard', hasFill: false },
  { id: 'reservas',  icon: 'bookmark-check', emoji: '🎫', label: 'Reservas', hasFill: true },
  { id: 'events',    icon: 'calendar-event', emoji: '📅', label: 'Eventos', hasFill: true },
]

interface Props {
  active: PageId
  setActive: (id: PageId) => void
  setMOpen: (v: boolean) => void
  newCI: number
  pendingRatings?: number
}

function BottomNavImpl({ active, setActive, setMOpen, newCI, pendingRatings = 0 }: Props) {
  const isBottomTab = (id: PageId) => BOTTOM_NAV.some(n => n.id === id)

  return (
    <nav
      className="np-bottom-nav"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 150,
        background: 'var(--c-nav-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: `1px solid rgba(59,130,246,0.12)`,
        display: 'flex',
        height: 62,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {BOTTOM_NAV.map(item => {
        const isActive = active === item.id
        const showBadge = item.id === 'checkin' && newCI > 0
        return (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            style={{
              flex: 1,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 2,
              background: 'none', border: 'none',
              color: isActive ? C.acc : C.sub,
              cursor: 'pointer',
              fontFamily: 'inherit',
              position: 'relative',
              transition: 'color .15s',
            }}
          >
            {/* Active indicator */}
            {isActive && (
              <div style={{
                position: 'absolute', top: 0, left: '50%',
                transform: 'translateX(-50%)',
                width: 28, height: 2,
                background: C.acc,
                borderRadius: '0 0 2px 2px',
              }} />
            )}

            <div style={{ position: 'relative' }}>
              <i
                className={`bi bi-${item.icon}${isActive && item.hasFill !== false ? '-fill' : ''}`}
                style={{ fontSize: 20, lineHeight: 1 }}
              />
              {showBadge && (
                <span style={{
                  position: 'absolute', top: -5, right: -8,
                  background: C.acc, color: '#fff',
                  fontSize: 9, fontWeight: 800,
                  padding: '1px 5px', borderRadius: 8,
                  minWidth: 16, textAlign: 'center', lineHeight: '14px',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}>
                  {newCI > 99 ? '99+' : newCI}
                </span>
              )}
            </div>

            <span style={{ fontSize: 10, fontWeight: isActive ? 700 : 500, lineHeight: 1 }}>
              {item.label}
            </span>
          </button>
        )
      })}

      {/* Menu button */}
      <button
        onClick={() => setMOpen(true)}
        style={{
          flex: 1,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 2,
          background: 'none', border: 'none',
          color: !isBottomTab(active) ? C.acc : C.sub,
          cursor: 'pointer',
          fontFamily: 'inherit',
          position: 'relative',
          transition: 'color .15s',
        }}
      >
        {!isBottomTab(active) && (
          <div style={{
            position: 'absolute', top: 0, left: '50%',
            transform: 'translateX(-50%)',
            width: 28, height: 2,
            background: C.acc,
            borderRadius: '0 0 2px 2px',
          }} />
        )}
        <div style={{ position: 'relative' }}>
          <i className="bi bi-grid-fill" style={{ fontSize: 20, lineHeight: 1 }} />
          {pendingRatings > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -7,
              background: '#f59e0b', color: '#fff',
              fontSize: 9, fontWeight: 800,
              padding: '1px 5px', borderRadius: 8,
              minWidth: 16, textAlign: 'center', lineHeight: '14px',
            }}>
              {pendingRatings > 99 ? '99+' : pendingRatings}
            </span>
          )}
        </div>
        <span style={{ fontSize: 10, fontWeight: !isBottomTab(active) ? 700 : 500, lineHeight: 1 }}>
          Menu
        </span>
      </button>
    </nav>
  )
}

export const BottomNav = memo(BottomNavImpl)
