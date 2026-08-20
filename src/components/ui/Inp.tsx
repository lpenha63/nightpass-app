import type { CSSProperties } from 'react'
import { C } from '../../constants/theme'
import { cn, fcpf, ftel } from '../../utils/format'

type InputMask = 'cpf' | 'phone' | 'currency' | 'date'

interface InpProps {
  label?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mask?: InputMask
  type?: string
  required?: boolean
  disabled?: boolean
  style?: CSSProperties
  rows?: number
}

const inputStyle = (): CSSProperties => ({
  width: '100%',
  background: C.inp,
  border: `1px solid ${C.brd}`,
  borderRadius: 8,
  padding: '10px 12px',
  color: C.txt,
  fontSize: 14,
  minHeight: 44,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
})

export function Inp({ label, value, onChange, placeholder, mask, type = 'text', required, disabled, style, rows }: InpProps) {
  function handleChange(ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    let v = ev.target.value
    if (mask === 'cpf') v = cn(v).slice(0, 11)
    if (mask === 'phone') v = cn(v).slice(0, 11)
    onChange(v)
  }

  const displayValue =
    mask === 'cpf'   ? fcpf(value) :
    mask === 'phone' ? ftel(value) : value

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>
          {label}{required && <span style={{ color: C.red }}> *</span>}
        </label>
      )}
      {rows ? (
        <textarea
          value={displayValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          style={{ ...inputStyle(), resize: 'vertical', minHeight: rows * 24, ...style }}
        />
      ) : (
        <input
          type={type}
          value={displayValue}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          style={{ ...inputStyle(), ...style }}
        />
      )}
    </div>
  )
}

interface SelProps {
  label?: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  style?: CSSProperties
}

export function Sel({ label, value, onChange, options, style }: SelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <label style={{ fontSize: 12, color: C.mut, fontWeight: 600 }}>{label}</label>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle(), ...style }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
