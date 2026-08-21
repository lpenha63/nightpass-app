import { memo } from 'react'
import type { WAStatus } from '../hooks/useWhatsAppStatus'
import { C } from '../constants/theme'

const META: Record<string, { color: string; label: string }> = {
  open:       { color: '#22c55e', label: 'WhatsApp conectado' },
  connecting: { color: '#f59e0b', label: 'WhatsApp conectando…' },
  close:      { color: '#ef4444', label: 'WhatsApp desconectado' },
}

interface Props {
  status: WAStatus
  reconnect: () => void | Promise<void>
  reconnecting: boolean
  onOpenSettings?: () => void
}

const iconBtn: React.CSSProperties = {
  background: 'transparent', border: 'none',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', padding: '4px 6px', borderRadius: 6, flexShrink: 0,
  lineHeight: 1,
}

function WhatsAppBarImpl({ status, reconnect, reconnecting, onOpenSettings }: Props) {
  if (status === 'off' || status === 'loading') return null
  const m = META[status] ?? META.close
  const ok = status === 'open'

  return (
    <div className="wa-bar" style={{
      position: 'fixed', top: 10, right: 16, zIndex: 100,
      display: 'flex', alignItems: 'center', gap: 4,
      background: 'rgba(0,0,0,0.45)',
      backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      border: `1px solid rgba(255,255,255,0.08)`,
      borderRadius: 20, padding: '4px 10px',
    }}>
      {/* bolinha de status */}
      <span title={m.label} style={{
        width: 7, height: 7, borderRadius: '50%', background: m.color,
        boxShadow: ok ? `0 0 6px ${m.color}` : 'none',
        animation: status === 'connecting' ? 'pulse 1.5s ease-in-out infinite' : 'none',
        cursor: 'default', flexShrink: 0,
      }} />

      {/* ícone WhatsApp */}
      <i className="bi bi-whatsapp" title={m.label}
        style={{ color: m.color, fontSize: 14, flexShrink: 0 }} />

      {/* botão Reconectar — só aparece quando desconectado */}
      {!ok && (
        <button onClick={reconnect} disabled={reconnecting}
          title={reconnecting ? 'Reconectando…' : 'Reconectar'}
          style={{ ...iconBtn, opacity: reconnecting ? 0.5 : 1 }}>
          <i className="bi bi-arrow-clockwise"
            style={{ color: m.color, fontSize: 14 }} />
        </button>
      )}

      {/* engrenagem de configurações */}
      {onOpenSettings && (
        <button onClick={onOpenSettings} title="Configurações do WhatsApp" style={iconBtn}>
          <i className="bi bi-gear" style={{ color: C.mut, fontSize: 14 }} />
        </button>
      )}
    </div>
  )
}

export const WhatsAppBar = memo(WhatsAppBarImpl)
