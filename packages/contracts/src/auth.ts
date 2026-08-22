import { FormatRegistry, Type, type Static } from '@sinclair/typebox'
import { Id } from './common.js'

export const Email = Type.String({ format: 'email', minLength: 3, maxLength: 254 })

// TypeBox's `format` keyword only fires once a checker is registered for
// it: `Value.Check`/`Value.Errors` treat an *unregistered* format as an
// unconditional failure, not as "unchecked" — verified directly: without
// this, `Value.Check(Email, 'a@b.com')` returns false for a plainly valid
// address. Registered here, next to `Email` itself, rather than by each
// consumer separately: the schema and its format checker must ship
// together, or two call sites can silently drift (one accepting an address
// the other rejects) with nothing failing to catch it. A module-level side
// effect — not an exported `registerEmailFormat()` the caller has to
// remember to invoke — because every consumer of `Email` needs the checker
// present to get correct behaviour, and importing `Email` already forces
// this module (and this line) to evaluate; there is no way to import the
// schema without also getting the registration, so it can't be forgotten.
// Same regex in both current consumers before this move
// (`apps/api/src/db/bootstrap.ts`'s CLI-only check and
// `apps/web/src/screens/Login.tsx`'s client-side check) — copied from
// ajv-formats' `fullFormats.email`, the mode `@fastify/ajv-compiler`
// defaults to, so this can never disagree with what
// `POST /api/auth/request-link` accepts on the server. The `Has` guard
// keeps a double registration (e.g. two packages importing this module)
// harmless.
if (!FormatRegistry.Has('email')) {
  FormatRegistry.Set(
    'email',
    (value: string) =>
      /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
        value,
      ),
  )
}

export const RequestLinkBody = Type.Object({ email: Email }, { additionalProperties: false })
export type RequestLinkBody = Static<typeof RequestLinkBody>

export const CallbackQuery = Type.Object({ token: Type.String({ minLength: 20, maxLength: 200 }) })
export type CallbackQuery = Static<typeof CallbackQuery>

export const MeResponse = Type.Object({
  id: Id,
  email: Email,
  role: Type.Union([Type.Literal('admin'), Type.Literal('player')]),
  hasProfile: Type.Boolean(),
})
export type MeResponse = Static<typeof MeResponse>
