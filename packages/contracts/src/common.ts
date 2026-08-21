import { Type, type Static } from '@sinclair/typebox'

export const Id = Type.Integer({ minimum: 1 })
export const IsoDate = Type.String({ format: 'date' })

export const ErrorEnvelope = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
})
export type ErrorEnvelope = Static<typeof ErrorEnvelope>
