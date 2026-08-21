import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMailer } from '../src/auth/mailer.js'
import { testConfig } from './setup/harness.js'

describe('createMailer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws when RESEND_API_KEY is missing in production', () => {
    expect(() =>
      createMailer({ ...testConfig, nodeEnv: 'production', mail: { apiKey: undefined, from: testConfig.mail.from } }),
    ).toThrow(/RESEND_API_KEY/)
  })

  it('throws for an unrecognised nodeEnv (e.g. "staging") with no key, not just "production"', () => {
    expect(() =>
      createMailer({ ...testConfig, nodeEnv: 'staging', mail: { apiKey: undefined, from: testConfig.mail.from } }),
    ).toThrow(/RESEND_API_KEY/)
  })

  it('falls back to a console mailer in development with no key', () => {
    expect(() =>
      createMailer({ ...testConfig, nodeEnv: 'development', mail: { apiKey: undefined, from: testConfig.mail.from } }),
    ).not.toThrow()
  })

  it('falls back to a console mailer in test with no key', () => {
    expect(() =>
      createMailer({ ...testConfig, nodeEnv: 'test', mail: { apiKey: undefined, from: testConfig.mail.from } }),
    ).not.toThrow()
  })

  it('prefers Resend whenever an API key is configured, regardless of nodeEnv', () => {
    expect(() =>
      createMailer({ ...testConfig, nodeEnv: 'production', mail: { apiKey: 're_test_key', from: testConfig.mail.from } }),
    ).not.toThrow()
  })

  it('the Resend mailer throws on a non-2xx response without leaking the recipient address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('resend says no', { status: 500 })),
    )
    const mailer = createMailer({ ...testConfig, mail: { apiKey: 're_test_key', from: testConfig.mail.from } })

    const to = 'victim@example.com'
    const url = 'https://example.com/callback?token=super-secret-token-value'

    await expect(mailer.sendSignInLink(to, url, 'signin')).rejects.toThrow(/Mail send failed with status 500/)

    let caught: unknown
    try {
      await mailer.sendSignInLink(to, url, 'signin')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect(String((caught as Error).message)).not.toContain(to)
  })
})
