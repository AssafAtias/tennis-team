import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { Kysely } from 'kysely'
import type { Database } from './db/schema.js'
import type { Config } from './config.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerOriginGuard } from './plugins/origin-guard.js'
import { isAuthPreHandler } from './plugins/session.js'
import { healthRoutes } from './routes/health.js'
import { authRoutes } from './routes/auth.js'
import { memberRoutes } from './routes/members.js'

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
  // Test-only hook: an alternate pino destination so a test can capture what
  // the app actually logs (e.g. to prove a token never appears in a log
  // line) without touching process.stdout globally. Left undefined in every
  // real caller, in which case pino falls back to its normal stdout
  // destination exactly as before this field existed.
  logDestination?: NodeJS.WritableStream
}

// Lets a later preHandler/hook reach `req.server.deps` (e.g. the Task 4
// session plugin needs `deps.db`) without threading Deps through every route.
declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps
  }
  // Backs the `config: { public: true }` opt-out the `onRoute` guard below
  // checks for. Declared here (rather than left as the ad-hoc cast the
  // guard used to read it with) because a route whose `config` also carries
  // a `rateLimit`-plugin-typed `preHandler` pins TypeScript's inference of
  // the route's ContextConfig type parameter to `FastifyContextConfig` —
  // once that happens, an un-declared `public` key on the literal is an
  // excess-property error, not a loose extra field.
  interface FastifyContextConfig {
    public?: boolean
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
      // The default `req` serializer includes the full `url`, and this
      // app's sign-in callback carries a single-use token in its query
      // string (`/api/auth/callback?token=...`) — a URL here can be a
      // credential. `redact` above can't help: it strips values sitting
      // at a key literally named e.g. `token`, not a token embedded inside
      // a URL string. So every logged URL is truncated to its path,
      // dropping the query entirely, for every route, not just this one —
      // a per-route exception would be one omission away from leaking the
      // next token.
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url.includes('?') ? req.url.slice(0, req.url.indexOf('?')) : req.url,
          host: req.host,
          remoteAddress: req.ip,
        }),
      },
      // Test-only: lets a test capture what actually gets logged (see
      // `Deps.logDestination`) instead of writing to the real stdout.
      // Absent in every real caller, so pino falls back to its normal
      // destination exactly as before.
      ...(deps.logDestination ? { stream: deps.logDestination } : {}),
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
    // No `ajv: { plugins: [...] }` here: `@fastify/ajv-compiler@4` (bundled
    // by fastify@5.12.1) already calls `require('ajv-formats')(this.ajv)`
    // itself by default (see its `lib/validator-compiler.js`) unless the
    // caller supplies a plugin literally named `formatsPlugin`. TypeBox's
    // `format: 'email'` (used by the auth contracts) is therefore already
    // enforced with no extra wiring — confirmed by a request with a
    // malformed address getting a 400 in auth-routes.test.ts. Wiring our own
    // `ajv-formats` on top would be redundant, and would additionally hit a
    // TypeScript-only conflict: this repo's root `eslint` pins `ajv@6` at
    // the shared top-level `node_modules/ajv` slot, so npm can't hoist one
    // shared `ajv@8` for the packages that need it, and a manually-imported
    // `ajv-formats` ends up with its own physical `ajv@8` copy that
    // TypeScript treats as a different (incompatible) type from the one
    // `@fastify/ajv-compiler` uses internally.
  })

  // app.decorate('deps', deps) lets later preHandlers (e.g. the Task 4 session
  // plugin) reach the db/config/mailer/storage/clock from a bare hook without
  // threading them through every route registration.
  app.decorate('deps', deps)

  // Default-deny, enforced at registration time (not deferred to `ready()`):
  // every `/api/` route must either carry a preHandler branded by
  // `requireAuth`/`requireRole` (see `isAuthPreHandler` in
  // plugins/session.ts) or opt out explicitly with `config: { public: true
  // }`. Checking only for *some* preHandler being present would not be
  // enough — a rate limiter, a logger, or a typo'd no-op preHandler would
  // satisfy that check while establishing no `request.member` at all, which
  // is why the brand check exists. Without this, a route in a later task
  // that forgets its auth preHandler still compiles and lints clean —
  // `request.member` is typed non-optional — and at runtime either serves
  // team data to an anonymous caller or throws trying to read `req.member`
  // off an undefined value. This is what makes that non-optional
  // `request.member` type honest, and it is the one thing this app claims
  // not to do.
  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/')) return
    if (route.config?.public) return
    const handlers = [route.preHandler].flat().filter(Boolean)
    if (!handlers.some(isAuthPreHandler)) {
      throw new Error(
        `Route ${route.method} ${route.url} has no authenticating preHandler and is not marked public. ` +
          `Add requireAuth or requireRole(...), or config: { public: true }.`,
      )
    }
  })

  registerErrorHandler(app)

  // Every `/api/` response carries per-caller data (roster, profile, session
  // state) that a shared proxy cache or the browser's back/forward cache
  // must never retain. Set once here, globally, rather than per route: Task
  // 5 added this header by hand on `GET /api/auth/me` alone, and every route
  // after it returns the same kind of personal data — relying on each future
  // task to remember the header is exactly how one gets missed.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store')
    }
    return payload
  })
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
  await app.register(authRoutes, deps)
  await app.register(memberRoutes, deps)
  return app
}
