import { useState, useEffect } from 'react'
import { C } from '../constants/theme'

interface BIPEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Botão "Instalar app" (PWA).
 * - Android/Chrome/Edge: usa o evento beforeinstallprompt para instalar com 1 toque.
 * - iOS (Safari): mostra instruções para "Adicionar à Tela de Início".
 * - Já instalado / sem suporte: não aparece.
 */
export function InstallButton({ full = false }: { full?: boolean }) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [showIOS, setShowIOS] = useState(false)

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS = /iphone|ipad|ipod/i.test(ua)
  // Navegadores internos (WhatsApp, Instagram, Facebook, etc.) NÃO têm "Adicionar à Tela de Início".
  // Precisa abrir no Safari primeiro.
  const isInApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|WeChat|MicroMessenger|Twitter|Snapchat|TikTok|Musical_ly/i.test(ua)
  const standalone = typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)

  useEffect(() => {
    if (standalone) { setInstalled(true); return }
    const onBIP = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent) }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onBIP)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [standalone])

  // Já instalado, ou navegador sem suporte e não é iOS → não mostra nada
  if (installed) return null
  if (!deferred && !isIOS) return null

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setDeferred(null)
  }

  const btnStyle: React.CSSProperties = {
    width: full ? '100%' : undefined,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: full ? '12px 16px' : '10px 14px', borderRadius: 12,
    background: `linear-gradient(135deg, ${C.acc}, #2563eb)`, border: 'none',
    color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  }

  return (
    <div style={{ width: full ? '100%' : undefined }}>
      <button onClick={() => (deferred ? install() : setShowIOS(v => !v))} style={btnStyle}>
        📲 Instalar app
      </button>
      {isIOS && !deferred && showIOS && (
        <div style={{ marginTop: 8, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: '10px 12px', color: C.sub, fontSize: 12, lineHeight: 1.6 }}>
          {isInApp ? (
            <>
              ⚠️ Este link abriu <strong style={{ color: C.txt }}>dentro de outro app</strong> (WhatsApp/Instagram), que não permite instalar.<br />
              <strong style={{ color: C.txt }}>1.</strong> Toque no menu <strong style={{ color: C.txt }}>⋯</strong> (ou <span style={{ fontSize: 14 }}>⎙</span>) no canto da tela e escolha <strong style={{ color: C.txt }}>“Abrir no Safari”</strong>.<br />
              <strong style={{ color: C.txt }}>2.</strong> No Safari, toque em <strong style={{ color: C.txt }}>Compartilhar</strong> <span style={{ fontSize: 14 }}>⎙</span> e depois em <strong style={{ color: C.txt }}>“Adicionar à Tela de Início”</strong>.
            </>
          ) : (
            <>
              No iPhone: toque em <strong style={{ color: C.txt }}>Compartilhar</strong> <span style={{ fontSize: 14 }}>⎙</span> na barra do Safari e escolha <strong style={{ color: C.txt }}>“Adicionar à Tela de Início”</strong>.
            </>
          )}
        </div>
      )}
    </div>
  )
}
