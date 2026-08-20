import { type ReactNode, useRef, useEffect, useCallback } from 'react'
import { C } from '../../constants/theme'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  wide?: boolean
  maxWidth?: number
  fullscreen?: boolean
  noDirtyCheck?: boolean
  zIndex?: number
  children: ReactNode
}

const CONFIRM_MSG = 'Tem alterações não salvas.\nDeseja sair sem salvar?'

export function Modal({ open, onClose, title, wide, maxWidth, fullscreen, noDirtyCheck, zIndex, children }: ModalProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const dirtyRef = useRef(false)

  // Reset dirty whenever modal opens/closes
  useEffect(() => { dirtyRef.current = false }, [open])

  // Track dirty via any input or select change inside modal body
  useEffect(() => {
    if (!open || !bodyRef.current) return
    const el = bodyRef.current
    const markDirty = () => { dirtyRef.current = true }
    el.addEventListener('input', markDirty)
    el.addEventListener('change', markDirty)
    return () => {
      el.removeEventListener('input', markDirty)
      el.removeEventListener('change', markDirty)
    }
  }, [open])

  const handleClose = useCallback(() => {
    if (!noDirtyCheck && dirtyRef.current && !window.confirm(CONFIRM_MSG)) return
    dirtyRef.current = false
    onClose()
  }, [onClose, noDirtyCheck])

  // Intercept "Cancelar" button clicks in capture phase so we can show confirm first
  useEffect(() => {
    if (!open || !bodyRef.current) return
    const el = bodyRef.current
    const handler = (e: Event) => {
      if (noDirtyCheck || !dirtyRef.current) return
      const btn = (e.target as HTMLElement).closest('button')
      if (!btn) return
      if (btn.textContent?.trim() === 'Cancelar') {
        e.preventDefault()
        e.stopPropagation()
        if (window.confirm(CONFIRM_MSG)) { dirtyRef.current = false; onClose() }
      }
    }
    el.addEventListener('click', handler, true)
    return () => el.removeEventListener('click', handler, true)
  }, [open, onClose])

  // Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, handleClose])

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(4,6,18,0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: zIndex ?? 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className={fullscreen ? 'modal-inner' : 'modal-inner modal-sheet'}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--c-modal-bg)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(59,130,246,0.18)',
          borderRadius: fullscreen ? 0 : 24,
          width: fullscreen ? '100vw' : '100%',
          maxWidth: fullscreen ? '100vw' : (maxWidth ?? (wide ? 720 : 480)),
          height: fullscreen ? '100vh' : undefined,
          maxHeight: fullscreen ? '100vh' : '90vh',
          overflowY: 'auto',
          boxShadow: fullscreen ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.5), 0 32px 80px rgba(0,0,0,0.6)',
          display: fullscreen ? 'flex' : undefined,
          flexDirection: fullscreen ? 'column' : undefined,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 22px', borderBottom: `1px solid ${C.brd}`,
        }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.txt }}>{title}</h2>
          <button
            onClick={handleClose}
            aria-label="Fechar"
            style={{
              background: 'none', border: 'none', color: C.mut,
              fontSize: 22, cursor: 'pointer', lineHeight: 1,
              padding: '0 4px', borderRadius: 6,
            }}
          >
            ×
          </button>
        </div>
        {/* Body */}
        <div ref={bodyRef} style={{ padding: '18px 22px', flex: fullscreen ? '1 1 0' : undefined, overflowY: fullscreen ? 'auto' : undefined }}>{children}</div>
      </div>
    </div>
  )
}
