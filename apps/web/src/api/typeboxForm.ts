import { typeboxResolver } from '@hookform/resolvers/typebox'
import type { Static, TObject } from '@sinclair/typebox'
import type { Resolver } from 'react-hook-form'

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
// nominally distinct) types. Not fixable by reshaping our schemas -- it's a
// dual-package-hazard bug in how the library ships its types, and 5.9.1 is
// current latest on npm (no newer patch exists). The runtime behaviour is
// unaffected (confirmed by the passing tests): `Parameters<typeof
// typeboxResolver>[0]` pulls the resolver's *own* declared parameter type
// (whichever realm it lives in) so the cast lines up with what it actually
// expects, rather than reconstructing an esm-realm `TObject` that would
// mismatch the same way. Deliberately `as unknown as X`, never `as any` --
// `@typescript-eslint/no-explicit-any` is `error` in this repo's eslint
// config, and `any` would also silently swallow unrelated mistakes at every
// call site instead of just this one known-bad cast.
type TypeboxResolverArg = Parameters<typeof typeboxResolver>[0]

/** typeboxResolver, with the CJS/ESM cast above applied once instead of at every call site. */
export function typeboxFormResolver<T extends TObject>(schema: T): Resolver<Static<T>> {
  return typeboxResolver(schema as unknown as TypeboxResolverArg) as unknown as Resolver<Static<T>>
}
