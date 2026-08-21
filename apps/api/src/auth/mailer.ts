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
    })
    if (!res.ok) {
      // Deliberately does not include `to`: the address must not reach the logs.
      throw new Error(`Mail send failed with status ${res.status}`)
    }
  }
}

class ConsoleMailer implements Mailer {
  async sendSignInLink(_to: string, url: string, kind: 'invite' | 'signin'): Promise<void> {
    // Local development only. Prints the link so you can sign in without a mail provider.
    console.log(`[mail:${kind}] ${url}`)
  }
}

export function createMailer(config: Config): Mailer {
  if (config.mail.apiKey) return new ResendMailer(config.mail.apiKey, config.mail.from)
  if (config.nodeEnv === 'production') {
    throw new Error('RESEND_API_KEY is required in production; sign-in would be impossible without it')
  }
  return new ConsoleMailer()
}
