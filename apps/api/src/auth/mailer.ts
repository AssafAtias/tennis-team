import type { Mailer } from '../app.js'
import type { Config } from '../config.js'

const SUBJECTS = {
  invite: 'You have been added to the tennis team',
  signin: 'Your sign-in link',
} as const

function body(url: string, kind: 'invite' | 'signin'): string {
  const lead =
    kind === 'invite'
      ? 'You have been added to the team. Use the link below to set up your profile.'
      : 'Use the link below to sign in.'
  return `${lead}\n\n${url}\n\nThis link works once and expires in 15 minutes.`
}

class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendSignInLink(to: string, url: string, kind: 'invite' | 'signin'): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to, subject: SUBJECTS[kind], text: body(url, kind) }),
      // Fastify's `requestTimeout` is disabled by default, so without this a
      // hung Resend call would hang the sign-in request indefinitely.
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      // Drain the body so the underlying connection can be reused/closed
      // cleanly. Deliberately does not include `to` or the response body in
      // the thrown message: the recipient address (and anything Resend might
      // echo back) must not reach the logs.
      await res.text().catch(() => undefined)
      throw new Error(`Mail send failed with status ${res.status}`)
    }
  }
}

class ConsoleMailer implements Mailer {
  async sendSignInLink(_to: string, url: string, kind: 'invite' | 'signin'): Promise<void> {
    // Local development only. Prints the link so you can sign in without a mail provider.
    // eslint-disable-next-line no-console -- intentional dev-only stdout sink, guarded by createMailer below
    console.log(`[mail:${kind}] ${url}`)
  }
}

export function createMailer(config: Config): Mailer {
  if (config.mail.apiKey) return new ResendMailer(config.mail.apiKey, config.mail.from)
  // Allowlist, not a denylist: an unset/unrecognised NODE_ENV (missing env
  // var, a typo, "staging", "prod", "preview", ...) must fail loudly, not
  // silently fall through to logging sign-in links — with a real token in
  // that link — to stdout while every sign-in appears to succeed.
  if (config.nodeEnv === 'development' || config.nodeEnv === 'test') return new ConsoleMailer()
  throw new Error('RESEND_API_KEY is required outside development; sign-in would silently fail without it')
}
