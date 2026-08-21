import { createHash, randomBytes } from 'node:crypto'

export const TOKEN_TTL_MS = 15 * 60 * 1000

/** Only the hash is ever persisted; the plaintext lives only in the emailed URL. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}
