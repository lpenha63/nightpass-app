import type { ReactNode } from 'react'
import { C, lbl } from '../theme'

export function Center({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mut }}>
      {children}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto', zIndex: 50,
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: wide ? 780 : 560, background: C.card,
          border: `1px solid ${C.brd}`, borderRadius: 18, padding: 24,
        }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ fontSize: 18, fontWeight: 900, flex: 1 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.mut, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={lbl}>{label}</label>
      {children}
      {hint && <div style={{ color: C.mut, fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 0', textAlign: 'left' }}>
      <span style={{ width: 38, height: 22, borderRadius: 12, background: checked ? C.grn : C.brd, position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
      </span>
      <span style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>{label}</span>
    </button>
  )
}

export function Kpi({ label, val, color, sub }: { label: string; val: string; color: string; sub?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${color}33`, borderTop: `3px solid ${color}`, borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
      <div style={{ color: C.mut, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 5 }}>{label.toUpperCase()}</div>
      <div style={{ color, fontSize: 18, fontWeight: 900, wordBreak: 'break-word' }}>{val}</div>
      {sub && <div style={{ color: C.mut, fontSize: 10, marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

export function NavTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent', border: 'none', borderBottom: `2px solid ${active ? C.acc : 'transparent'}`,
        padding: '8px 14px', color: active ? C.txt : C.mut, fontSize: 14, fontWeight: 800,
        cursor: 'pointer', marginBottom: -2, fontFamily: 'inherit', whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  )
}

export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? C.acc + '22' : 'transparent', border: `1px solid ${active ? C.acc : C.brd}`,
        borderRadius: 10, padding: '8px 16px', color: active ? C.acc : C.mut,
        fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
      }}>
      {children}
    </button>
  )
}

export function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{ background: color + '22', color, border: `1px solid ${color}55`, borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ color: C.mut, fontSize: 13, padding: 20, textAlign: 'center' }}>{children}</div>
}
