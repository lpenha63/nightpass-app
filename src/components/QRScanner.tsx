import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

interface Props {
  onScan: (token: string) => void
  onClose: () => void
}

const C = { bg: '#0a0e1a', card: '#111827', brd: '#1e2736', acc: '#3b82f6', txt: '#f9fafb', mut: '#6b7280', red: '#f87171' }

export function QRScanner({ onScan, onClose }: Props) {
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const divId = 'qr-scanner-container'

  useEffect(() => {
    const scanner = new Html5Qrcode(divId)
    scannerRef.current = scanner

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decoded) => {
        // Extract token: either full UUID or URL ending with UUID
        const uuidMatch = decoded.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)
        if (uuidMatch) {
          scanner.stop().catch(() => {})
          onScan(uuidMatch[0])
        }
      },
      () => { /* ignore scan errors */ }
    ).then(() => setStarted(true))
      .catch(e => setError('Câmera não disponível: ' + String(e)))

    return () => { scanner.stop().catch(() => {}) }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: C.txt, fontWeight: 800, fontSize: 18, marginBottom: 20 }}>🎫 Scanner de Ingresso</div>

      {error
        ? <div style={{ color: C.red, fontSize: 14, padding: 20, textAlign: 'center' }}>{error}</div>
        : (
          <div style={{ position: 'relative' }}>
            <div id={divId} style={{ width: 300, height: 300, borderRadius: 16, overflow: 'hidden' }} />
            {!started && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mut, fontSize: 14 }}>Iniciando câmera...</div>}
            {/* Scan frame overlay */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', border: `2px solid ${C.acc}`, borderRadius: 16 }} />
          </div>
        )
      }

      <div style={{ color: C.mut, fontSize: 13, marginTop: 16, marginBottom: 24 }}>
        Aponte para o QR code do ingresso
      </div>

      <button onClick={onClose}
        style={{ background: 'none', border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 10, padding: '10px 24px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
        Cancelar
      </button>
    </div>
  )
}
