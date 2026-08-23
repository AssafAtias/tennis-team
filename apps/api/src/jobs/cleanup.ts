import type { FastifyBaseLogger } from 'fastify'
import type { SessionDeps } from '../auth/sessions.js'

const TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000

/** Idempotent, so running on more than one instance is harmless. */
export async function sweepExpired(deps: SessionDeps): Promise<{ sessions: number; tokens: number }> {
  const now = deps.now()

  const sessions = await deps.db
    .deleteFrom('sessions')
    .where('expires_at', '<=', now)
    .executeTakeFirst()

  const tokens = await deps.db
    .deleteFrom('login_tokens')
    .where('created_at', '<', new Date(now.getTime() - TOKEN_RETENTION_MS))
    .where((eb) => eb.or([eb('consumed_at', 'is not', null), eb('expires_at', '<=', now)]))
    .executeTakeFirst()

  return {
    sessions: Number(sessions.numDeletedRows ?? 0n),
    tokens: Number(tokens.numDeletedRows ?? 0n),
  }
}

/**
 * `SessionDeps & { log: FastifyBaseLogger }` rather than a hand-written
 * `{ info(...): void; error(...): void }` shape: using Fastify's own logger
 * type means this signature can never drift from what `app.log` actually is.
 */
export function startCleanupJob(deps: SessionDeps & { log: FastifyBaseLogger }): () => void {
  const tick = () => {
    sweepExpired(deps).then(
      (r) => {
        if (r.sessions || r.tokens) deps.log.info(r, 'cleanup swept expired rows')
      },
      (err: unknown) => deps.log.error({ err }, 'cleanup sweep failed'),
    )
  }
  const timer = setInterval(tick, SWEEP_INTERVAL_MS)
  timer.unref() // never hold the process open
  tick()
  return () => clearInterval(timer)
}
