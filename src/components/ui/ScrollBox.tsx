import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { C } from '../../constants/theme'

interface ScrollBoxProps {
  maxHeight: number | string
  children: ReactNode
  className?: string
  style?: CSSProperties
  // "sangra" a barrinha até a borda do card: estende N px à direita (= padding do card)
  // e recompõe o padding interno, deixando a barra colada na borda.
  bleedRight?: number
}

// Lista com rolagem interna + barrinha lateral SEMPRE visível (não depende do navegador
// mostrar a scrollbar nativa, que em mobile só aparece durante o gesto de arrastar).
//
// A nativa é escondida por CSS (.np-scrollbox): como este componente desenha a própria
// barrinha, as duas juntas apareciam lado a lado — ficou evidente quando a scrollbar
// global passou de 5px para a largura do sistema.
export function ScrollBox({ maxHeight, children, className, style, bleedRight = 0 }: ScrollBoxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState({ top: 0, height: 0, visible: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const recalc = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      if (scrollHeight <= clientHeight + 2) { setThumb(t => (t.visible ? { top: 0, height: 0, visible: false } : t)); return }
      const heightPct = Math.max(10, (clientHeight / scrollHeight) * 100)
      const topPct = (scrollTop / (scrollHeight - clientHeight)) * (100 - heightPct)
      setThumb({ top: topPct, height: heightPct, visible: true })
    }
    recalc()
    el.addEventListener('scroll', recalc)
    const ro = new ResizeObserver(recalc)
    ro.observe(el)
    const mo = new MutationObserver(recalc)
    mo.observe(el, { childList: true, subtree: true })
    window.addEventListener('resize', recalc)
    return () => {
      el.removeEventListener('scroll', recalc)
      ro.disconnect(); mo.disconnect()
      window.removeEventListener('resize', recalc)
    }
  }, [])

  return (
    <div style={{ position: 'relative', marginRight: bleedRight ? -bleedRight : undefined }}>
      <div ref={ref} className={['np-scrollbox', className].filter(Boolean).join(' ')} style={{ maxHeight, overflowY: 'auto', paddingRight: bleedRight || undefined, ...style }}>
        {children}
      </div>
      {thumb.visible && (
        <div style={{ position: 'absolute', right: 2, top: 0, bottom: 0, width: 5, borderRadius: 3, background: C.brd + '55', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', right: 0, top: `${thumb.top}%`, height: `${thumb.height}%`, width: 5, borderRadius: 3, background: C.acc, boxShadow: `0 0 6px ${C.acc}aa`, transition: 'top .08s linear' }} />
        </div>
      )}
    </div>
  )
}
