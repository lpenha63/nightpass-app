import type { ReactNode, CSSProperties } from 'react'
import { C } from '../../constants/theme'

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface BtnProps {
  onClick?: () => void
  variant?: BtnVariant
  disabled?: boolean
  small?: boolean
  icon?: string
  style?: CSSProperties
  children?: ReactNode
  type?: 'button' | 'submit' | 'reset'
  title?: string
  'aria-label'?: string
}

export function Btn({
  onClick,
  variant,
  disabled,
  small,
  icon,
  style,
  children,
  type = 'button',
  title,
  'aria-label': ariaLabel,
}: BtnProps) {
  const isPri = !variant || variant === 'primary'
  const bg =
    variant === 'danger' ? 'linear-gradient(135deg,#7f1d1d,#991b1b)' :
    variant === 'ghost'  ? 'transparent' :
    variant === 'secondary' ? C.card :
    `linear-gradient(135deg,${C.acd},${C.acc})`

  const col = variant === 'ghost' ? C.mut : C.txt
  const bd =
    variant === 'danger'    ? '#7f1d1d55' :
    variant === 'secondary' ? C.brd :
    variant === 'ghost'     ? 'transparent' : 'transparent'

  const sh = isPri && !disabled
    ? '0 4px 20px rgba(59,130,246,0.35), 0 0 40px rgba(59,130,246,0.1)'
    : 'none'

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={{
        background: bg,
        color: col,
        border: `1px solid ${bd}`,
        borderRadius: 10,
        padding: small ? '6px 14px' : '10px 20px',
        fontSize: small ? 12 : 13,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: sh,
        minHeight: small ? 34 : 40,
        transition: 'transform .15s, box-shadow .15s',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap' as const,
        ...style,
      }}
    >
      {icon && <span style={{ fontSize: small ? 13 : 15 }}>{icon}</span>}
      {children}
    </button>
  )
}
