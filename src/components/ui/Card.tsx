import type { CSSProperties, ReactNode } from 'react'
import { C } from '../../constants/theme'

interface CardProps {
  style?: CSSProperties
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ style, children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={['np-card', className].filter(Boolean).join(' ')}
      style={{
        background: C.card,
        border: `1px solid ${C.brd}`,
        borderRadius: 16,
        padding: '16px 18px',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
