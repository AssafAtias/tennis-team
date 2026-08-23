import type { FastifyInstance } from 'fastify'

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

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g

/**
 * Errors from pg and elsewhere embed addresses and tokens in message/detail/
 * stack TEXT, where pino's key-path `redact` list cannot reach them (it only
 * strips values sitting at keys literally named e.g. `email`/`token`). A
 * duplicate-key violation on `members.email` throws with message text like
 * `Key (email)=(alice@example.com) already exists.` — that has to be scrubbed
 * at the string level before it is ever handed to the logger.
 */
export function scrubSensitive(text: string): string {
  return text.replace(EMAIL_RE, '[redacted-email]').replace(TOKEN_RE, '[redacted-token]')
}

type ValidationEntry = { instancePath?: string; message?: string }

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
    // instead of returning HTML that JSON.parse then chokes on. Segment-exact
    // (not prefix) matches: once Task 19 adds the SPA fallback, a path like
    // `/apiary` must NOT be misclassified as an API miss.
    if (req.url === '/health' || req.url.startsWith('/api/')) {
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

  // Fastify hands this handler whatever was actually thrown by any later
  // route — a bare string, null, a rejected primitive — not necessarily an
  // Error-like object. Fastify 5's `setErrorHandler` types default the error
  // generic to `unknown` for exactly this reason, so this is typed `unknown`
  // and every property access below is guarded rather than assumed. Notably,
  // `'validation' in err` would itself throw a TypeError if `err` were not an
  // object, which would skip this whole handler and defeat the "every error
  // response uses the envelope" guarantee for that request.
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      const payload = { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }
      reply.code(err.statusCode).send({ error: payload })
      return
    }

    const isObject = typeof err === 'object' && err !== null

    // Fastify's schema validation failures.
    if (isObject && 'validation' in err && (err as { validation?: unknown }).validation) {
      const validation = (err as { validation: ValidationEntry[] }).validation
      reply.code(400).send({
        error: {
          code: 'validation_failed',
          message: 'Request did not match the expected shape',
          details: { fields: validation.map((v) => ({ path: v.instancePath, message: v.message })) },
        },
      })
      return
    }

    if (isObject && (err as { statusCode?: unknown }).statusCode === 429) {
      reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } })
      return
    }

    // Never leak internals; give the caller only the correlation id. Log a
    // curated, scrubbed shape rather than the raw error/stack — pg's
    // duplicate-key errors embed the email address as text in `message`,
    // `detail`, and (via the message) `stack`, none of which pino's key-path
    // `redact` list can see inside.
    req.log.error(
      {
        reqId: req.id,
        errName: err instanceof Error ? err.name : typeof err,
        errCode: isObject ? (err as { code?: unknown }).code : undefined,
        errMessage: scrubSensitive(err instanceof Error ? err.message : String(err)),
        stack: err instanceof Error && err.stack ? scrubSensitive(err.stack) : undefined,
      },
      'unhandled error',
    )
    reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side.',
        details: { requestId: req.id },
      },
    })
  })
}
