import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { AvailabilityGrid as Grid } from '@tennis/contracts'
import { AvailabilityGrid } from '../src/components/AvailabilityGrid.js'

describe('AvailabilityGrid', () => {
  describe('read-only mode (no onChange)', () => {
    it('renders zero interactive elements -- a screen reader must not hear 21 disabled controls', () => {
      render(<AvailabilityGrid slots={[]} />)
      expect(screen.queryAllByRole('switch')).toHaveLength(0)
      expect(screen.queryAllByRole('button')).toHaveLength(0)
    })

    it('describes each cell with day, block, and availability in a form a reader would understand', () => {
      const slots: Grid = [{ weekday: 1, block: 'evening' }]
      render(<AvailabilityGrid slots={slots} />)
      expect(screen.getByText('Mon evening: available')).toBeTruthy()
      expect(screen.getByText('Sun morning: not available')).toBeTruthy()
    })
  })

  describe('editable mode (onChange supplied)', () => {
    it('renders all 21 switches with aria-checked reflecting the given slots', () => {
      const slots: Grid = [{ weekday: 1, block: 'evening' }]
      render(<AvailabilityGrid slots={slots} onChange={vi.fn()} />)
      const switches = screen.getAllByRole('switch')
      expect(switches).toHaveLength(21)

      const on = screen.getByRole('switch', { name: 'Mon evening' })
      expect(on.getAttribute('aria-checked')).toBe('true')

      const off = screen.getByRole('switch', { name: 'Sun morning' })
      expect(off.getAttribute('aria-checked')).toBe('false')
    })

    it('adds a slot when toggling an off cell', async () => {
      const slots: Grid = [{ weekday: 1, block: 'evening' }]
      const onChange = vi.fn()
      render(<AvailabilityGrid slots={slots} onChange={onChange} />)

      await userEvent.click(screen.getByRole('switch', { name: 'Tue evening' }))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([
        { weekday: 1, block: 'evening' },
        { weekday: 2, block: 'evening' },
      ])
    })

    it('removes a slot when toggling an on cell -- this is Task 16 (editable /me) built directly on top of', async () => {
      const slots: Grid = [
        { weekday: 1, block: 'evening' },
        { weekday: 6, block: 'morning' },
      ]
      const onChange = vi.fn()
      render(<AvailabilityGrid slots={slots} onChange={onChange} />)

      await userEvent.click(screen.getByRole('switch', { name: 'Mon evening' }))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([{ weekday: 6, block: 'morning' }])
    })
  })
})
