import { useRef, useState } from 'react'
import { PHOTO_CONTENT_TYPES, PHOTO_MAX_BYTES } from '@tennis/contracts'
import { useUploadPhoto } from '../api/queries.js'
import { Avatar } from './Avatar.js'
import { Button } from './Button.js'

const ACCEPT = PHOTO_CONTENT_TYPES.join(',')

export function PhotoPicker({ name, currentUrl }: { name: string; currentUrl: string | null }) {
  const input = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const upload = useUploadPhoto()

  function onPick(file: File | undefined) {
    setLocalError(null)
    // Reset the input's value on every path, including a local rejection --
    // not just in `onSettled` below. Browsers suppress `change` when the
    // identical file is reselected without clearing `value` first, so
    // without this, re-picking the same rejected file after reading the
    // error would silently do nothing at all.
    if (input.current) input.current.value = ''
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
    // No `onSettled` reset needed here: the unconditional reset at the top
    // of `onPick` already clears the input before this dispatch even starts,
    // so it is already empty by the time this mutation settles.
    upload.mutate(file)
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
          // `accept` narrows the native picker to just images -- without it,
          // a teammate picking a photo on their phone gets a file browser
          // showing every file on the device, not just images. The JS check
          // below is still the real enforcement (a picker's `accept` is only
          // ever a hint the OS may ignore), but this is real, load-bearing
          // UX, not redundant with it.
          accept={ACCEPT}
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
