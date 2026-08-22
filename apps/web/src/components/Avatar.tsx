const PALETTE = ['bg-clay-500', 'bg-court-500', 'bg-night-700', 'bg-clay-600', 'bg-court-700']

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function Avatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    )
  }
  // Stable colour per name, so a teammate looks the same on every screen.
  const tone = PALETTE[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]!
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-display text-chalk ${tone}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  )
}
