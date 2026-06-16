import { useState, useEffect } from 'react'
import { Modal, Btn } from './ui'
import { C } from '../constants/theme'
import { sendWADirect } from '../utils/whatsapp'

export interface QuickWATarget { name: string; phone: string; clientId?: string | null }

/**
 * Composer rápido de WhatsApp: abre um campo para digitar a mensagem e envia
 * pela Evolution API (quando conectada) ou cai no WhatsApp Web como fallback.
 */
export function QuickWA({ houseId, target, onClose, onSent }: {
  houseId: string
  target: QuickWATarget | null
  onClose: () => void
  onSent?: (viaApi: boolean) => void
}) {
  const [msg, setMsg] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => { if (target) setMsg('') }, [target])

  async function send() {
    if (!target || !msg.trim()) return
    setSending(true)
    const r = await sendWADirect(houseId, target.phone, msg.trim(), { type: 'manual', clientId: target.clientId ?? null })
    setSending(false)
    onSent?.(r.viaApi)
    onClose()
  }

  return (
    <Modal open={!!target} title={`💬 Mensagem — ${target?.name ?? ''}`} onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 12, color: C.mut }}>📱 {target?.phone}</div>
        <textarea autoFocus value={msg} onChange={e => setMsg(e.target.value)} placeholder="Escreva a mensagem..."
          style={{ width: '100%', minHeight: 120, background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '10px 12px', color: C.txt, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={send} disabled={!msg.trim() || sending} style={{ flex: 1 }}>{sending ? 'Enviando...' : '📲 Enviar'}</Btn>
          <Btn onClick={onClose} variant="ghost">Cancelar</Btn>
        </div>
      </div>
    </Modal>
  )
}
