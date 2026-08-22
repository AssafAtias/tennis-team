import { useForm } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import { RequestLinkBody, type RequestLinkBody as Body } from '@tennis/contracts'
import { typeboxFormResolver } from '../api/typeboxForm.js'
import { useRequestLink } from '../api/queries.js'
import { Button } from '../components/Button.js'
import { Card } from '../components/Card.js'
import { Field } from '../components/Field.js'

// `Email`'s format checker (registered in `@tennis/contracts`, next to the
// schema itself) is guaranteed to be registered by the time this form
// validates, because importing `RequestLinkBody` (which embeds `Email`)
// already forces that registration to happen.

export function Component() {
  const [params] = useSearchParams()
  const linkFailed = params.get('error') === 'link_invalid'
  const requestLink = useRequestLink()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Body>({ resolver: typeboxFormResolver(RequestLinkBody) })

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4">
      <header>
        <p className="font-display text-3xl tracking-tight text-clay-500">Tennis Team</p>
        <p className="mt-2 text-sm text-night-700/80">
          Members only. Enter your email and we will send you a sign-in link.
        </p>
      </header>

      {linkFailed ? (
        <div role="alert" className="rounded-card bg-clay-50 p-3 text-sm text-night-900">
          That link has expired or has already been used. Request a fresh one below.
        </div>
      ) : null}

      <Card>
        {requestLink.isSuccess ? (
          <p role="status" className="text-sm">
            Check your inbox. If that address is on the team, a sign-in link is on its way. The link works
            once and expires in 15 minutes.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={handleSubmit((values) => requestLink.mutate(values))}
            noValidate
          >
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              error={errors.email ? 'Enter a valid email address' : undefined}
              {...register('email')}
            />
            <Button type="submit" disabled={requestLink.isPending}>
              {requestLink.isPending ? 'Sending…' : 'Send me a link'}
            </Button>
            {requestLink.isError ? (
              <p role="alert" className="text-xs text-clay-600">
                Could not send the link just now. Please try again in a moment.
              </p>
            ) : null}
          </form>
        )}
      </Card>
    </main>
  )
}
