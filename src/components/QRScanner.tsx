import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { C } from '../constants/theme'

interface Props {
  onScan: (token: string) => void
  onClose: () => void
}

/**
 * Leitor de QR do ingresso.
 *
 * Cuidados que existem por terem falhado na porta:
 *
 * 1. O contêiner é renderizado SEMPRE. A biblioteca procura o elemento pelo id no
 *    momento em que é criada; escondê-lo quando havia erro fazia a construção lançar
 *    exceção dentro do efeito — o React derrubava a árvore e a tela ficava BRANCA,
 *    sem mensagem nenhuma.
 * 2. Tudo dentro de try/catch. Falha de leitor não pode derrubar o app inteiro no meio
 *    da fila de entrada.
 * 3. A mensagem diz o que fazer. "Câmera não disponível" com o erro cru em inglês não
 *    ajuda ninguém às 2h da manhã.
 */
export function QRScanner({ onScan, onClose }: Props) {
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const jaLeu = useRef(false)
  const divId = 'qr-scanner-container'
  // onScan vem como funcao nova a cada render da tela de check-in. Se entrasse na
  // dependencia do efeito, a camera reiniciaria em laco. Guardamos a referencia.
  const aoLer = useRef(onScan)
  aoLer.current = onScan

  useEffect(() => {
    let scanner: Html5Qrcode | null = null
    try {
      scanner = new Html5Qrcode(divId)
      scannerRef.current = scanner
    } catch (e) {
      setError('Não foi possível iniciar o leitor. Use o campo "digite o código" abaixo. (' + String(e) + ')')
      return
    }

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      decoded => {
        // Aceita o token puro OU um link terminado nele
        const uuid = decoded.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)
        if (!uuid || jaLeu.current) return
        jaLeu.current = true   // trava: a câmera dispara várias leituras do mesmo código
        scanner?.stop().catch(() => {})
        aoLer.current(uuid[0])
      },
      () => { /* quadro sem QR — normal, ignora */ },
    ).then(() => setStarted(true))
      .catch((e: unknown) => {
        const msg = String((e as { message?: string })?.message ?? e)
        setError(
          /permission|denied|NotAllowed/i.test(msg)
            ? 'A câmera está bloqueada para este site. Toque no cadeado 🔒 ao lado do endereço e libere "Câmera" — depois recarregue.'
            : /NotFound|no camera|Requested device/i.test(msg)
              ? 'Nenhuma câmera encontrada neste aparelho. Use o campo "digite o código" abaixo.'
              : `Não foi possível abrir a câmera. Use o campo "digite o código" abaixo. (${msg})`,
        )
      })

    return () => {
      try {
        if (scanner?.isScanning) scanner.stop().catch(() => {})
      } catch { /* já parado ou elemento removido */ }
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ color: '#fff', fontWeight: 800, fontSize: 18, marginBottom: 20 }}>🎫 Scanner de Ingresso</div>

      {/* O contêiner NUNCA sai do DOM — só encolhe quando há erro. Ver cuidado 1 acima. */}
      <div style={{ position: 'relative', display: error ? 'none' : 'block' }}>
        <div id={divId} style={{ width: 300, height: 300, borderRadius: 16, overflow: 'hidden', background: '#000' }} />
        {!started && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 14 }}>
            Iniciando câmera…
          </div>
        )}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', border: `2px solid ${C.acc}`, borderRadius: 16 }} />
      </div>

      {error && (
        <div style={{ color: '#fca5a5', fontSize: 14, lineHeight: 1.6, padding: '16px 8px', textAlign: 'center', maxWidth: 340 }}>
          {error}
        </div>
      )}

      <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 16, marginBottom: 24, textAlign: 'center' }}>
        {error ? 'Você pode fechar e digitar o código do ingresso.' : 'Aponte para o QR code do ingresso'}
      </div>

      <button onClick={onClose}
        style={{ background: 'none', border: '1px solid #475569', color: '#e2e8f0', borderRadius: 10, padding: '10px 24px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
        {error ? 'Fechar' : 'Cancelar'}
      </button>
    </div>
  )
}
