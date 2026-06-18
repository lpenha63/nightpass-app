import type { CSSProperties, ReactNode } from 'react'

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
      className={className ?? ''}
      style={{
        background: '#111827',
        border: '1px solid #1e2736',
        borderRadius: 16,
        padding: '16px 18px',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
