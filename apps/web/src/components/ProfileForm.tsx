import { useForm, type Resolver } from 'react-hook-form'
import { typeboxResolver } from '@hookform/resolvers/typebox'
import { ProfileBody, type PlayerDetail, type ProfileBody as Body } from '@tennis/contracts'
import { ApiError } from '../api/client.js'
import { useSaveProfile } from '../api/queries.js'
import { Button } from './Button.js'
import { Field } from './Field.js'

// A native, uncontrolled <select> with no matching defaultValue reads back
// as the DOM's own default -- the first <option>'s value, `''` here -- not
// as `undefined`. That's a harmless value against the nullable *string*
// fields (nickname/phone/racquet/bio/ratingValue: `Type.String({maxLength})`
// accepts `''` outright), but the three enum-backed selects
// (dominantHand/backhand/preferredFormat) are
// `Type.Union([Type.Null(), Type.Literal(...)])`, which `''` satisfies
// neither branch of. Verified directly against the installed
// @sinclair/typebox: `Value.Errors(ProfileBody, { ...valid, dominantHand:
// '', backhand: '', preferredFormat: '' })` reports "Expected union value"
// for all three, which would block every submission where those selects
// were simply left on "Prefer not to say" -- normalizing `''` to `null`
// before typeboxResolver ever sees it (rather than only after validation,
// where the brief's own `onSubmit` does the same substitution) is what
// makes leaving a select unset a first-class, submittable case instead of
// a client-side validation error nobody caused.
//
// The `as unknown as TypeboxResolverArg` / `as unknown as Resolver<Body>`
// casts below are a second, unrelated fix: `@hookform/resolvers` ships no
// `"type": "module"`, so under this repo's `moduleResolution: NodeNext`,
// TypeScript treats its `typebox/dist/index.d.ts` as CommonJS-implied and
// resolves its internal `import { TObject } from '@sinclair/typebox'` via
// the *require* condition (`@sinclair/typebox`'s `build/cjs/...`), while our
// own ESM source resolves the same package via the *import* condition
// (`build/esm/...`). TypeBox brands its schema types with `unique symbol`s
// (`[Kind]` etc.); the cjs and esm builds each declare that symbol
// separately, so an esm-realm `TObject` (e.g. `ProfileBody`'s type) is
// structurally incompatible with the cjs-realm `TObject` the resolver's own
// signature expects -- confirmed directly: TS's diagnostic names both
// `.../build/esm/type/object/object` and `.../build/cjs/type/object/object`
// as the two (semantically identical, nominally distinct) types. Not
// fixable by reshaping `ProfileBody` -- it's a dual-package-hazard bug in
// how the library ships its types (5.9.1 is current latest on npm, no newer
// patch exists), and the runtime behaviour is unaffected (confirmed by the
// passing tests below). `Parameters<typeof typeboxResolver>[0]` pulls the
// resolver's *own* declared parameter type instead of reconstructing an
// esm-realm `TObject` that would mismatch the same way.
type TypeboxResolverArg = Parameters<typeof typeboxResolver>[0]
const validate = typeboxResolver(ProfileBody as unknown as TypeboxResolverArg) as unknown as Resolver<Body>
const resolver: Resolver<Body> = (values, context, options) => {
  const normalized = { ...values } as Record<string, unknown>
  for (const key of ['dominantHand', 'backhand', 'preferredFormat']) {
    if (normalized[key] === '') normalized[key] = null
  }
  return validate(normalized as Body, context, options)
}

const HANDS = [
  ['', 'Prefer not to say'],
  ['right', 'Right-handed'],
  ['left', 'Left-handed'],
] as const
const BACKHANDS = [
  ['', 'Prefer not to say'],
  ['one', 'One-handed'],
  ['two', 'Two-handed'],
] as const
const FORMATS = [
  ['', 'No preference'],
  ['singles', 'Singles'],
  ['doubles', 'Doubles'],
  ['both', 'Either'],
] as const
const SYSTEMS = [
  ['none', 'No rating'],
  ['utr', 'UTR'],
  ['ntrp', 'NTRP'],
  ['club', 'Club level'],
] as const

function Select({
  label,
  options,
  ...rest
}: { label: string; options: readonly (readonly [string, string])[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const id = `sel-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-night-700">
        {label}
      </label>
      <select
        {...rest}
        id={id}
        className="tap-target rounded-card border border-line bg-white px-3 text-base"
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
}

interface Props {
  mode: 'create' | 'update'
  defaultValues?: Partial<Body>
  submitLabel: string
  onSaved: (profile: PlayerDetail) => void
}

export function ProfileForm({ mode, defaultValues, submitLabel, onSaved }: Props) {
  const save = useSaveProfile(mode)
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<Body>({
    resolver,
    defaultValues: { ratingSystem: 'none', ...defaultValues },
  })

  const ratingSystem = watch('ratingSystem')

  const onSubmit = handleSubmit(async (values) => {
    // Empty strings from <select> mean "unset", which the API models as null.
    const cleaned = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]),
    ) as Body
    if (cleaned.ratingSystem === 'none') cleaned.ratingValue = null

    try {
      onSaved(await save.mutateAsync(cleaned))
    } catch (err) {
      if (err instanceof ApiError) {
        for (const [field, message] of Object.entries(err.fields)) {
          // `type: 'server'` is deliberate, not decorative: react-hook-form's
          // `setError` does not default `type` when the caller omits it (it
          // merges the given `ErrorOption` object as-is), while every
          // typeboxResolver-produced error always carries its schema error's
          // stringified numeric `type` (e.g. "52"). Marking this explicitly
          // is what the Display name field below uses to show this exact
          // server message instead of being shadowed by its own
          // client-validation fallback copy.
          setError(field as keyof Body, { message, type: 'server' })
        }
        if (Object.keys(err.fields).length === 0) {
          setError('root', { message: err.message })
        }
      } else {
        setError('root', { message: 'Could not save. Check your connection and try again.' })
      }
    }
  })

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      <Field
        label="Display name"
        autoComplete="name"
        error={
          errors.displayName
            ? // `type: 'server'` (set alongside `setError` above) marks a
              // message that came verbatim from the API and must be shown
              // as-is. Anything else here is a typeboxResolver rejection,
              // which always has its own truthy `.message` too (e.g.
              // "Expected string length greater or equal to 1" for the
              // empty-value case this field exists to catch) -- so falling
              // back only when a message is *missing* would never fire, and
              // the friendly copy below would always be shadowed by that
              // raw schema text without this check.
              errors.displayName.type === 'server'
              ? errors.displayName.message
              : 'Enter the name your teammates know you by'
            : undefined
        }
        {...register('displayName')}
      />
      <Field label="Nickname" error={errors.nickname?.message} {...register('nickname')} />
      <Field
        label="Phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        hint="Only visible to teammates."
        error={errors.phone?.message}
        {...register('phone')}
      />

      <Select label="Dominant hand" options={HANDS} {...register('dominantHand')} />
      <Select label="Backhand" options={BACKHANDS} {...register('backhand')} />
      <Select label="Preferred format" options={FORMATS} {...register('preferredFormat')} />
      <Select label="Rating system" options={SYSTEMS} {...register('ratingSystem')} />

      {ratingSystem && ratingSystem !== 'none' ? (
        <Field
          label="Rating value"
          hint="For example 4.0, or 7.5 for UTR."
          error={errors.ratingValue?.message}
          {...register('ratingValue')}
        />
      ) : null}

      <Field label="Racquet" error={errors.racquet?.message} {...register('racquet')} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bio" className="text-sm font-medium text-night-700">
          About you
        </label>
        <textarea
          id="bio"
          rows={3}
          maxLength={500}
          className="rounded-card border border-line bg-white p-3 text-base"
          {...register('bio')}
        />
      </div>

      {errors.root ? (
        <p role="alert" className="text-xs font-medium text-clay-600">
          {errors.root.message}
        </p>
      ) : null}

      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}
