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
      // logs — log member_id instead.
      redact: ['req.headers.cookie', 'req.headers.authorization', '*.email', '*.token'],
    },
    disableRequestLogging: deps.config.nodeEnv === 'test',
    trustProxy: true,
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
  await app.register(rateLimit, { global: false })
  registerOriginGuard(app, deps.config.appOrigin)

  await app.register(healthRoutes, deps)
  return app
}
