import type { PropsWithChildren } from 'react'

export function Card({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`rounded-card border border-line bg-chalk p-4 shadow-lift ${className}`}>{children}</div>
  )
}
