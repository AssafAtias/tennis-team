export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Form-field name → message, ready to hand to react-hook-form setError. */
    readonly fields: Record<string, string> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface Envelope {
  error?: { code?: string; message?: string; details?: { fields?: { path?: string; message?: string }[] } }
}

function toFieldMap(env: Envelope): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of env.error?.details?.fields ?? []) {
    // '/displayName' → 'displayName'; nested paths keep their dots.
    const name = (f.path ?? '').replace(/^\//, '').replace(/\//g, '.')
    if (name && f.message) out[name] = f.message
  }
  return out
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    if (!res.ok) throw new ApiError(res.status, 'error', 'Request failed')
    return undefined as T
  }

  const body = (await res.json().catch(() => ({}))) as Envelope & T
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error?.code ?? 'error',
      body.error?.message ?? 'Something went wrong.',
      toFieldMap(body),
    )
  }
  return body as T
}
