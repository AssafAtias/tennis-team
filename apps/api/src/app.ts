import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { Kysely } from 'kysely'
import type { Database } from './db/schema.js'
import type { Config } from './config.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerOriginGuard } from './plugins/origin-guard.js'
import { healthRoutes } from './routes/health.js'

export interface Mailer {
  sendSignInLink(to: string, url: string, kind: 'invite' | 'signin'): Promise<void>
}

export interface ObjectStore {
  presignPut(key: string, contentType: string, maxBytes: number): Promise<string>
  get(key: string): Promise<Buffer>
  put(key: string, body: Buffer, contentType: string): Promise<void>
  delete(key: string): Promise<void>
  publicUrl(key: string): string
}

export interface Deps {
  db: Kysely<Database>
  config: Config
  mailer: Mailer
  storage: ObjectStore
  now: () => Date
}

// Lets a later preHandler/hook reach `req.server.deps` (e.g. the Task 4
// session plugin needs `deps.db`) without threading Deps through every route.
declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps
  }
}

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.nodeEnv === 'test' ? 'silent' : 'info',
      // Belt and braces: even a stray log of these keys is scrubbed. The hard
      // rule is that email addresses, tokens, and session ids never reach the
      // logs — log member_id instead. NOTE: fastify's default `req`
      // serializer only emits method/url/version/hostname/remoteAddress/
      // remotePort — it does not include `headers` at all, so the two
      // `req.headers.*` paths below are currently no-ops against what
      // actually gets logged. Kept for a future custom serializer that adds
      // headers back, not because they protect anything today. What
      // actually leaks — an email address embedded as free text in a pg
      // duplicate-key error's message/stack — is handled by `scrubSensitive`
      // in error-handler.ts instead, since key-path redaction can't reach
      // inside a string value.
      redact: ['req.headers.cookie', 'req.headers.authorization', '*.email', '*.token'],
    },
    disableRequestLogging: deps.config.nodeEnv === 'test',
    // Trust exactly one hop in front of the app, not the whole chain. `true`
    // trusts every hop and takes the leftmost (client-supplied)
    // X-Forwarded-For entry, letting anyone spoof `req.ip` and evade the
    // per-IP rate limiting the spec requires.
    //
    // NOTE this is a function, not the number `1`: in the installed
    // fastify@5.12.1, a numeric `trustProxy` is intentionally NOT a hop
    // count — `lib/request.js`'s `getTrustProxyFn` fails closed for
    // `typeof tp === 'number'` ("Hop-count-only trust cannot validate the
    // immediate peer"), returning a function that trusts nothing, which
    // would make `req.ip` always the directly-connected socket (the proxy
    // itself) and silently defeat the whole point of this option — every
    // real client would share the proxy's rate-limit bucket. `hop === 0`
    // trusts only the immediate peer's X-Forwarded-For entry (the one
    // real proxy), which is the actual single-hop-topology equivalent.
    trustProxy: (_address, hop) => hop === 0,
  })

  // app.decorate('deps', deps) lets later preHandlers (e.g. the Task 4 session
  // plugin) reach the db/config/mailer/storage/clock from a bare hook without
  // threading them through every route registration.
  app.decorate('deps', deps)

  registerErrorHandler(app)
  // contentSecurityPolicy: false only because there is no client bundle yet —
  // Task 19 replaces this with real directives once @fastify/static serves one.
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cookie, { secret: deps.config.sessionSecret })
  // Origin guard registered BEFORE rate-limit: both add `onRequest` hooks to
  // the root context and run in registration order. Rejecting a cross-site
  // request here first means it never consumes a rate-limit slot — this
  // matters once a route (e.g. Task 5's public /api/auth/request-link) opts
  // into a per-IP budget.
  registerOriginGuard(app, deps.config.appOrigin)
  await app.register(rateLimit, { global: false })

  await app.register(healthRoutes, deps)
  return app
}
