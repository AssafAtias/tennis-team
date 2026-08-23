import { BLOCKS, WEEKDAY_LABELS, type AvailabilityGrid as Grid, type Slot } from '@tennis/contracts'

const keyOf = (weekday: number, block: string) => `${weekday}:${block}`

interface Props {
  slots: Grid
  onChange?: (next: Grid) => void
  disabled?: boolean
}

/**
 * 7 x 3 grid. Read-only when no onChange is supplied, which is how the player
 * page and the edit page share one component.
 */
export function AvailabilityGrid({ slots, onChange, disabled }: Props) {
  const selected = new Set(slots.map((s) => keyOf(s.weekday, s.block)))
  const readOnly = !onChange

  const toggle = (weekday: number, block: Slot['block']) => {
    const key = keyOf(weekday, block)
    const next = selected.has(key)
      ? slots.filter((s) => keyOf(s.weekday, s.block) !== key)
      : [...slots, { weekday, block }]
    onChange?.(next)
  }

  return (
    <div role="group" aria-label="Weekly availability" className="overflow-x-auto">
      <table className="w-full min-w-[20rem] border-separate border-spacing-1 text-center">
        <thead>
          <tr>
            <th className="w-16" />
            {WEEKDAY_LABELS.map((d) => (
              <th key={d} scope="col" className="text-xs font-semibold text-night-700/70">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BLOCKS.map((block) => (
            <tr key={block}>
              <th scope="row" className="text-right text-xs font-medium capitalize text-night-700/70">
                {block}
              </th>
              {WEEKDAY_LABELS.map((label, weekday) => {
                const on = selected.has(keyOf(weekday, block))
                const description = `${label} ${block}`
                return (
                  <td key={label}>
                    {readOnly ? (
                      <span
                        className={`block h-9 rounded-card ${on ? 'bg-court-500' : 'bg-line/60'}`}
                        title={`${description}: ${on ? 'available' : 'not available'}`}
                      >
                        <span className="sr-only">{`${description}: ${on ? 'available' : 'not available'}`}</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={description}
                        disabled={disabled}
                        onClick={() => toggle(weekday, block)}
                        className={`h-11 w-full rounded-card transition-colors disabled:opacity-50 ${
                          on ? 'bg-court-500 text-chalk' : 'bg-line/60 hover:bg-line'
                        }`}
                      >
                        <span aria-hidden="true">{on ? '✓' : ''}</span>
                      </button>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
