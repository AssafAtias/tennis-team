import { FormatRegistry } from '@sinclair/typebox'
import { useForm, type Resolver } from 'react-hook-form'
import { typeboxResolver } from '@hookform/resolvers/typebox'
import { useSearchParams } from 'react-router'
import { RequestLinkBody, type RequestLinkBody as Body } from '@tennis/contracts'
import { useRequestLink } from '../api/queries.js'
import { Button } from '../components/Button.js'
import { Card } from '../components/Card.js'
import { Field } from '../components/Field.js'

// `@hookform/resolvers` ships no `"type": "module"`, so under this repo's
// `moduleResolution: NodeNext`, TypeScript treats its `typebox/dist/index.d.ts`
// as CommonJS-implied and resolves its internal `import { TObject } from
// '@sinclair/typebox'` via the *require* condition
// (`@sinclair/typebox`'s `build/cjs/...`), while our own ESM source resolves
// the same package via the *import* condition (`build/esm/...`). TypeBox
// brands its schema types with `unique symbol`s (`[Kind]` etc.); the cjs and
// esm builds each declare that symbol separately, so TypeScript treats an
// esm-realm `TObject` as structurally incompatible with the cjs-realm
// `TObject` the resolver's own signature expects -- confirmed directly: TS's
// diagnostic names both `.../build/esm/type/object/object` and
// `.../build/cjs/type/object/object` as the two (semantically identical,
// nominally distinct) types. Not fixable by reshaping our schema -- it's a
// dual-package-hazard bug in how the library ships its types, and 5.9.1 is
// current latest on npm (no newer patch exists). The runtime behaviour is
// unaffected (confirmed by the passing tests): `Parameters<typeof
// typeboxResolver>[0]` pulls the resolver's *own* declared parameter type
// (whichever realm it lives in) so the cast lines up with what it actually
// expects, rather than reconstructing an esm-realm `TObject` that would
// mismatch the same way.
type TypeboxResolverArg = Parameters<typeof typeboxResolver>[0]

// TypeBox's `format` keyword only fires once a checker is registered for it:
// `Value.Check`/`Value.Errors` treat an *unregistered* format as an
// unconditional failure for every value (verified directly against the
// installed @sinclair/typebox: `Value.Errors(RequestLinkBody, { email:
// 'a@b.com' })` reports `StringFormatUnknown` for a plainly valid address),
// not as "unchecked." The server gets `email` for free from
// `@fastify/ajv-compiler`'s bundled ajv-formats; this client bundle has no
// such wiring, so `RequestLinkBody`'s `Email` schema would reject every
// address, valid or not, without this. Same regex as
// `apps/api/src/db/bootstrap.ts` (copied from ajv-formats' "full" email
// format) so the client can never disagree with what
// `POST /api/auth/request-link` accepts.
if (!FormatRegistry.Has('email')) {
  FormatRegistry.Set(
    'email',
    (value: string) =>
      /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
        value,
      ),
  )
}

export function Component() {
  const [params] = useSearchParams()
  const linkFailed = params.get('error') === 'link_invalid'
  const requestLink = useRequestLink()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Body>({
    resolver: typeboxResolver(RequestLinkBody as unknown as TypeboxResolverArg) as unknown as Resolver<Body>,
  })

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
