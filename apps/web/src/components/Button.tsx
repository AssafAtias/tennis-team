import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const STYLES: Record<Variant, string> = {
  primary: 'bg-clay-500 text-chalk hover:bg-clay-600 disabled:bg-clay-300',
  secondary: 'bg-clay-100 text-night-900 hover:bg-clay-300/60',
  ghost: 'bg-transparent text-night-700 hover:bg-line/60',
  danger: 'bg-transparent text-clay-600 ring-1 ring-clay-300 hover:bg-clay-50',
}

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`tap-target inline-flex items-center justify-center gap-2 rounded-card px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${STYLES[variant]} ${className}`}
    />
  )
}
