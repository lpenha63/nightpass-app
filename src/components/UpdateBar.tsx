import { useEffect, useState } from 'react'
import { C } from '../constants/theme'

// Versão gravada no build (vite.config.ts). Em dev vira 'dev'.
declare const __APP_BUILD__: string
export const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'

interface VersionFile { version?: string; build?: string; at?: string }

/**
 * Avisa quando existe uma versão mais nova publicada.
 *
 * Por que não confiar só no service worker: o app da equipe e a portaria ficam ABERTOS
 * a noite inteira. Sem recarregar a página, o código continua sendo o do início do turno —
 * o service worker só troca em navegação. Aqui comparamos o build que está rodando com o
 * /version.json publicado e oferecemos a recarga.
 */
export function UpdateBar() {
  const [novaVersao, setNovaVersao] = useState<string | null>(null)

  useEffect(() => {
    if (APP_BUILD === 'dev') return
    let vivo = true

    async function conferir() {
      try {
        // no-store: senão o próprio cache devolveria o arquivo antigo e nunca acusaria nada
        const r = await fetch('/version.json', { cache: 'no-store' })
        if (!r.ok) return
        const v = (await r.json()) as VersionFile
        if (vivo && v.build && v.build !== APP_BUILD) setNovaVersao(v.version ?? v.build)
      } catch { /* offline: tenta de novo depois */ }
    }

    conferir()
    const timer = setInterval(conferir, 15 * 60 * 1000)
    const aoVoltar = () => { if (document.visibilityState === 'visible') conferir() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { vivo = false; clearInterval(timer); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [])

  if (!novaVersao) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 78px)',
        zIndex: 90, display: 'flex', alignItems: 'center', gap: 10,
        background: C.card, border: `1px solid ${C.acc}66`, borderRadius: 999,
        padding: '8px 10px 8px 16px', boxShadow: '0 10px 30px rgba(0,0,0,.35)',
        maxWidth: 'calc(100vw - 24px)',
      }}>
      <span style={{ color: C.txt, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        ✨ Nova versão disponível
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          flexShrink: 0, border: 'none', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
          padding: '7px 14px', fontSize: 13, fontWeight: 800, color: '#fff',
          background: `linear-gradient(135deg,${C.acc},#1d4ed8)`,
        }}>
        Atualizar
      </button>
      <button
        onClick={() => setNovaVersao(null)}
        aria-label="Agora não"
        title="Agora não"
        style={{ flexShrink: 0, background: 'none', border: 'none', color: C.mut, fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>
        ✕
      </button>
    </div>
  )
}
