import { useState, useEffect } from 'react'
import { C } from '../constants/theme'

interface BIPEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Botão "Instalar app" (PWA) do portal do promoter.
 *
 * O caso que importa aqui é o do link que chega POR WhatsApp — que é como o
 * portal é enviado. O promoter toca no link e ele abre no navegador INTERNO do
 * WhatsApp, onde instalar não existe: no Android o evento `beforeinstallprompt`
 * nunca dispara, e no iPhone não há "Adicionar à Tela de Início".
 *
 * Antes o componente devolvia null nesse caso (`if (!deferred && !isIOS)`), então
 * no Android o promoter não via NADA — nem botão, nem explicação. Parecia que o
 * app não existia. Agora o navegador interno é tratado como o que é: um lugar de
 * onde se sai, com o passo a passo e o link pronto para colar.
 */
export function InstallButton({ full = false }: { full?: boolean }) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [abrirDicas, setAbrirDicas] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const isIOS = /iphone|ipad|ipod/i.test(ua)
  // Navegadores internos (WhatsApp, Instagram, Facebook...) não instalam PWA.
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

  async function instalar() {
    if (!deferred) return
    await deferred.prompt()
    const escolha = await deferred.userChoice
    if (escolha.outcome === 'accepted') setInstalled(true)
    setDeferred(null)
  }

  async function copiarLink() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // clipboard bloqueado no navegador interno: seleciona num campo temporário
      const t = document.createElement('textarea')
      t.value = url; t.style.position = 'fixed'; t.style.opacity = '0'
      document.body.appendChild(t); t.select()
      try { document.execCommand('copy') } catch { /* sem copiar: resta o passo manual */ }
      document.body.removeChild(t)
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2500)
  }

  if (installed) return null

  const larg: React.CSSProperties = { width: full ? '100%' : undefined }
  const btn: React.CSSProperties = {
    ...larg,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: full ? '12px 16px' : '10px 14px', borderRadius: 12,
    background: `linear-gradient(135deg, ${C.acc}, #2563eb)`, border: 'none',
    color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  }
  const caixa: React.CSSProperties = {
    marginTop: 8, background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10,
    padding: '12px 14px', color: C.sub, fontSize: 12.5, lineHeight: 1.7,
  }
  const forte = { color: C.txt }

  // ── 1. Abriu dentro do WhatsApp/Instagram: não dá para instalar daqui ──
  if (isInApp) {
    return (
      <div className="install-btn" style={larg}>
        <button onClick={() => setAbrirDicas(v => !v)} style={btn}>
          📲 Instalar app {abrirDicas ? '▴' : '▾'}
        </button>
        {abrirDicas && (
          <div style={caixa}>
            Este link abriu <strong style={forte}>dentro do WhatsApp</strong>, que não
            permite instalar. São dois passos:
            <div style={{ marginTop: 8 }}>
              <strong style={forte}>1.</strong> Toque no menu{' '}
              <strong style={forte}>{isIOS ? '⋯' : '⋮'}</strong> no canto da tela e escolha{' '}
              <strong style={forte}>{isIOS ? '“Abrir no Safari”' : '“Abrir no Chrome”'}</strong>.
            </div>
            <div style={{ marginTop: 4 }}>
              <strong style={forte}>2.</strong>{' '}
              {isIOS
                ? <>No Safari, toque em <strong style={forte}>Compartilhar</strong> ⎙ e depois em <strong style={forte}>“Adicionar à Tela de Início”</strong>.</>
                : <>No Chrome, toque no menu <strong style={forte}>⋮</strong> e depois em <strong style={forte}>“Instalar aplicativo”</strong>.</>}
            </div>
            {/* Se o menu do WhatsApp estiver escondido, colar o link no navegador
                resolve do mesmo jeito. */}
            <button onClick={copiarLink}
              style={{ ...btn, marginTop: 10, background: 'transparent', border: `1px solid ${C.brd}`, color: copiado ? C.grn : C.sub, fontSize: 13 }}>
              {copiado ? '✅ Link copiado — cole no navegador' : '🔗 Copiar link'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── 2. Android/Chrome com tudo pronto: instala em um toque ──
  if (deferred) {
    return (
      <div className="install-btn" style={larg}>
        <button onClick={instalar} style={btn}>📲 Instalar app</button>
      </div>
    )
  }

  // ── 3. iPhone no Safari: não há prompt, só o passo manual ──
  if (isIOS) {
    return (
      <div className="install-btn" style={larg}>
        <button onClick={() => setAbrirDicas(v => !v)} style={btn}>
          📲 Instalar app {abrirDicas ? '▴' : '▾'}
        </button>
        {abrirDicas && (
          <div style={caixa}>
            No iPhone: toque em <strong style={forte}>Compartilhar</strong> ⎙ na barra do
            Safari e escolha <strong style={forte}>“Adicionar à Tela de Início”</strong>.
          </div>
        )}
      </div>
    )
  }

  // Computador ou navegador sem suporte: não há o que oferecer.
  return null
}
