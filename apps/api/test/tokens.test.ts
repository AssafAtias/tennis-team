import { describe, expect, it } from 'vitest'
import { hashToken, newToken, TOKEN_TTL_MS } from '../src/auth/tokens.js'

describe('tokens', () => {
  it('generates a URL-safe token of at least 32 bytes of entropy', () => {
    const { token } = newToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/)
  })

  it('never repeats a token', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newToken().token))
    expect(seen.size).toBe(500)
  })

  it('hashes deterministically to 32 bytes and does not embed the token', () => {
    const { token, hash } = newToken()
    expect(hash).toEqual(hashToken(token))
    expect(hash).toHaveLength(32)
    expect(hash.toString('utf8')).not.toContain(token)
  })

  it('expires tokens after fifteen minutes', () => {
    expect(TOKEN_TTL_MS).toBe(900_000)
  })
})
