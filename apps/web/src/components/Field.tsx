import type { InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef, useId } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string | undefined
  hint?: ReactNode
}

// forwardRef is required, not decorative: Tasks 14 and 18 spread react-hook-form's
// register() onto this component, and register() returns a ref. A plain function
// component would silently drop that ref and every form field would read empty.
export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { label, error, hint, ...rest },
  ref,
) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-night-700">
        {label}
      </label>
      <input
        {...rest}
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
        className={`tap-target rounded-card border bg-white px-3 text-base ${
          error ? 'border-clay-500' : 'border-line'
        }`}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-night-700/70">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-clay-600">
          {error}
        </p>
      ) : null}
    </div>
  )
})
