import { useRef, useState } from 'react'
import { PHOTO_CONTENT_TYPES, PHOTO_MAX_BYTES } from '@tennis/contracts'
import { useUploadPhoto } from '../api/queries.js'
import { Avatar } from './Avatar.js'
import { Button } from './Button.js'

export function PhotoPicker({ name, currentUrl }: { name: string; currentUrl: string | null }) {
  const input = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const upload = useUploadPhoto()

  function onPick(file: File | undefined) {
    setLocalError(null)
    if (!file) return
    // Check locally first: rejecting a 12 MB file after uploading it is rude,
    // and the size cap is enforced server-side anyway -- this is purely a
    // faster, friendlier answer for the common case.
    if (!PHOTO_CONTENT_TYPES.includes(file.type as (typeof PHOTO_CONTENT_TYPES)[number])) {
      setLocalError('Photos must be JPEG, PNG or WebP.')
      return
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setLocalError('That photo is larger than 5 MB. Try a smaller one.')
      return
    }
    upload.mutate(file, {
      onSettled: () => {
        if (input.current) input.current.value = ''
      },
    })
  }

  const error = localError ?? (upload.isError ? 'Upload failed. Check your connection and try again.' : null)

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} url={upload.data?.photoUrl ?? currentUrl} size={72} />
      <div className="flex flex-col items-start gap-1">
        <label htmlFor="photo" className="text-sm font-medium text-night-700">
          Profile photo
        </label>
        <input
          ref={input}
          id="photo"
          type="file"
          // No native `accept` filter: it's enforced here in JS instead
          // (`PHOTO_CONTENT_TYPES` below), with a friendly message, rather
          // than the browser silently hiding non-matching files from the
          // picker with no explanation of why.
          className="sr-only"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? 'Uploading…' : currentUrl ? 'Change photo' : 'Add a photo'}
        </Button>
        {/* The server re-encodes every uploaded photo to strip EXIF, because
            phone photos carry GPS coordinates and these are pictures of
            identifiable teammates. Saying so here is the point, not filler. */}
        <p className="text-xs text-night-700/60">JPEG, PNG or WebP, up to 5 MB. Location data is removed.</p>
        {error ? (
          <p role="alert" className="text-xs font-medium text-clay-600">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
