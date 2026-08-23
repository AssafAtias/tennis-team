import { Type, type Static } from '@sinclair/typebox'

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const PresignBody = Type.Object(
  {
    contentType: Type.Union([
      Type.Literal('image/jpeg'),
      Type.Literal('image/png'),
      Type.Literal('image/webp'),
    ]),
    sizeBytes: Type.Integer({ minimum: 1, maximum: PHOTO_MAX_BYTES }),
  },
  { additionalProperties: false },
)
export type PresignBody = Static<typeof PresignBody>

export const PresignResponse = Type.Object({
  uploadUrl: Type.String(),
  key: Type.String(),
  maxBytes: Type.Integer(),
})
export type PresignResponse = Static<typeof PresignResponse>

export const ConfirmPhotoBody = Type.Object(
  { key: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
)
export type ConfirmPhotoBody = Static<typeof ConfirmPhotoBody>
