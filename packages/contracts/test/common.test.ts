import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { ErrorEnvelope, Id } from '../src/index.js'

describe('contracts', () => {
  it('accepts a well-formed error envelope', () => {
    const ok = { error: { code: 'not_found', message: 'No such member' } }
    expect(Value.Check(ErrorEnvelope, ok)).toBe(true)
  })

  it('rejects an envelope missing a code', () => {
    expect(Value.Check(ErrorEnvelope, { error: { message: 'x' } })).toBe(false)
  })

  it('rejects a non-positive id', () => {
    expect(Value.Check(Id, 0)).toBe(false)
    expect(Value.Check(Id, 7)).toBe(true)
  })
})
