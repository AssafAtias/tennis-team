import { describe, expect, it } from 'vitest'
import { scrubSensitive } from '../src/plugins/error-handler.js'

describe('scrubSensitive', () => {
  it('redacts an email address embedded in an error message', () => {
    const message = 'Key (email)=(alice@example.com) already exists.'
    const scrubbed = scrubSensitive(message)
    expect(scrubbed).not.toContain('alice@example.com')
    expect(scrubbed).toContain('[redacted-email]')
  })

  it('redacts an email address embedded in a stack trace', () => {
    const stack = [
      'DatabaseError: Key (email)=(bob@example.com) already exists.',
      '    at Parser.parseErrorMessage (/app/node_modules/pg-protocol/dist/parser.js:1:1)',
      '    at Connection.emit (node:events:1:1)',
    ].join('\n')
    const scrubbed = scrubSensitive(stack)
    expect(scrubbed).not.toContain('bob@example.com')
    expect(scrubbed).toContain('[redacted-email]')
  })

  it('redacts a long opaque token', () => {
    const message = `session token abcdefghijklmnopqrstuvwxyz0123456789ABCD rejected`
    const scrubbed = scrubSensitive(message)
    expect(scrubbed).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789ABCD')
    expect(scrubbed).toContain('[redacted-token]')
  })

  it('leaves ordinary text untouched', () => {
    expect(scrubSensitive('Something went wrong on our side.')).toBe('Something went wrong on our side.')
  })
})
