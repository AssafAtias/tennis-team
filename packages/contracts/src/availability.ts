import { Type, type Static } from '@sinclair/typebox'
import { Id } from './common.js'

export const Weekday = Type.Integer({ minimum: 0, maximum: 6 })
export const Block = Type.Union([
  Type.Literal('morning'),
  Type.Literal('afternoon'),
  Type.Literal('evening'),
])
export const BLOCKS = ['morning', 'afternoon', 'evening'] as const
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const Slot = Type.Object({ weekday: Weekday, block: Block }, { additionalProperties: false })
export type Slot = Static<typeof Slot>

/** 7 days x 3 blocks, so 21 is the whole grid. */
export const AvailabilityGrid = Type.Array(Slot, { maxItems: 21 })
export type AvailabilityGrid = Static<typeof AvailabilityGrid>

export const ReplaceAvailabilityBody = Type.Object(
  { slots: AvailabilityGrid },
  { additionalProperties: false },
)
export type ReplaceAvailabilityBody = Static<typeof ReplaceAvailabilityBody>

export const WhoIsFreeQuery = Type.Object({ weekday: Weekday, block: Block })
export type WhoIsFreeQuery = Static<typeof WhoIsFreeQuery>

export const WhoIsFreeResponse = Type.Array(
  Type.Object({ id: Id, displayName: Type.String(), photoUrl: Type.Union([Type.String(), Type.Null()]) }),
)
export type WhoIsFreeResponse = Static<typeof WhoIsFreeResponse>
