import type { FastifyError, FastifyInstance } from 'fastify'

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details)
export const unauthorized = (msg = 'Sign in required') => new AppError(401, 'unauthorized', msg)
export const forbidden = (msg = 'Not permitted') => new AppError(403, 'forbidden', msg)
export const notFound = (msg = 'Not found') => new AppError(404, 'not_found', msg)
export const conflict = (msg: string, code = 'conflict') => new AppError(409, code, msg)

// `@fastify/static`'s `sendFile` decorator isn't registered until Task 19 wires
// the plugin in, so its type isn't visible here. Augment it as optional so the
// not-found handler below can feature-detect it without an `any` cast.
declare module 'fastify' {
  interface FastifyReply {
    sendFile?(filename: string): FastifyReply
  }
}

/**
 * ONE setNotFoundHandler for the whole app, registered here so it exists from
 * Task 3 onward. Task 19 (serving the built React client from this same
 * server) must NOT register its own — Fastify throws if setNotFoundHandler is
 * called twice for the same prefix — so the SPA fallback branch below is
 * dead code until then, when `@fastify/static` decorates `reply.sendFile`.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req, reply) => {
    // /api and /health always answer JSON, so a mistyped fetch fails loudly
    // instead of returning HTML that JSON.parse then chokes on.
    if (req.url.startsWith('/api') || req.url.startsWith('/health')) {
      reply.code(404).send({ error: { code: 'not_found', message: 'No such route' } })
      return
    }
    // SPA fallback, available only once @fastify/static is registered (Task 19).
    if (typeof reply.sendFile === 'function') {
      reply.sendFile('index.html')
      return
    }
    reply.code(404).send({ error: { code: 'not_found', message: 'No such route' } })
  })

  // Fastify 5's setErrorHandler defaults its error generic to `unknown`
  // (rather than FastifyError), so this repo's strict tsconfig needs an
  // explicit annotation here. AppError structurally satisfies FastifyError
  // (code: string, statusCode?: number), and ajv validation failures attach a
  // `validation` array that isn't in fastify's own FastifyError type — both
  // are named explicitly below rather than left as `unknown`.
  type ValidationEntry = { instancePath?: string; message?: string }
  type HandledError = AppError | (FastifyError & { validation?: ValidationEntry[] })

  app.setErrorHandler((err: HandledError, req, reply) => {
    if (err instanceof AppError) {
      const payload = { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }
      reply.code(err.statusCode).send({ error: payload })
      return
    }

    // Fastify's schema validation failures.
    if ('validation' in err && err.validation) {
      reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: 'Request did not match the expected shape',
          details: { fields: err.validation.map((v) => ({ path: v.instancePath, message: v.message })) },
        },
      })
      return
    }

    if (err.statusCode === 429) {
      reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } })
      return
    }

    // Never leak internals; give the caller only the correlation id.
    req.log.error({ err, reqId: req.id }, 'unhandled error')
    reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side.',
        details: { requestId: req.id },
      },
    })
  })
}
