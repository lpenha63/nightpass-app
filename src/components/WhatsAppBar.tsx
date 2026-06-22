import { useWhatsAppStatus } from '../hooks/useWhatsAppStatus'
import { C } from '../constants/theme'

const META: Record<string, { color: string; label: string }> = {
  open: { color: '#22c55e', label: 'WhatsApp conectado' },
  connecting: { color: '#f59e0b', label: 'WhatsApp conectando…' },
  close: { color: '#ef4444', label: 'WhatsApp desconectado' },
}

// Barra fina no topo da tela com a luz de status + botão Reconectar.
// Some quando a integração não está configurada/ativa.
export function WhatsAppBar({ houseId, onOpenSettings }: { houseId: string; onOpenSettings?: () => void }) {
  const { status, reconnect, reconnecting } = useWhatsAppStatus(houseId)
  if (status === 'off' || status === 'loading') return null
  const m = META[status] ?? META.close
  const ok = status === 'open'

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 14px',
      background: ok ? m.color + '10' : m.color + '1c',
      borderBottom: `1px solid ${m.color}${ok ? '33' : '66'}`,
      backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
    }}>
      <span style={{
        width: 9, height: 9, borderRadius: '50%', background: m.color, flexShrink: 0,
        boxShadow: ok ? `0 0 7px ${m.color}` : 'none',
        animation: status === 'connecting' ? 'pulse 1.5s ease-in-out infinite' : 'none',
      }} />
      <i className="bi bi-whatsapp" style={{ color: m.color, fontSize: 14, flexShrink: 0 }} />
      <span style={{ color: ok ? C.sub : m.color, fontSize: 12.5, fontWeight: 700, flex: 1 }}>{m.label}</span>

      {!ok && (
        <button onClick={reconnect} disabled={reconnecting}
          style={{ background: m.color + '22', border: `1px solid ${m.color}66`, borderRadius: 7, padding: '4px 12px', color: m.color, fontSize: 12, fontWeight: 700, cursor: reconnecting ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
          {reconnecting ? 'Reconectando…' : '🔄 Reconectar'}
        </button>
      )}
      {onOpenSettings && (
        <button onClick={onOpenSettings} title="Abrir configurações do WhatsApp"
          style={{ background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 7, padding: '4px 10px', color: C.mut, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
          Configurar
        </button>
      )}
    </div>
  )
}
