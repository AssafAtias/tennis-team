import { Type, type Static } from '@sinclair/typebox'
import { Id } from './common.js'

export const Email = Type.String({ format: 'email', minLength: 3, maxLength: 254 })

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
