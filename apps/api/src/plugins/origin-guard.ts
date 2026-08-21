import type { FastifyInstance } from 'fastify'
import { AppError } from './error-handler.js'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Backs up SameSite=Lax: a state-changing request must either carry no Origin
 * (non-browser client) or carry exactly our own. Browsers always send Origin on
 * POST/PATCH/PUT/DELETE, so a cross-site form post cannot pass this.
 */
export function registerOriginGuard(app: FastifyInstance, appOrigin: string): void {
  app.addHook('onRequest', async (req) => {
    if (SAFE.has(req.method)) return
    const origin = req.headers.origin
    if (origin === undefined) return
    if (origin !== appOrigin) {
      throw new AppError(403, 'bad_origin', 'Request origin is not permitted')
    }
  })
}
