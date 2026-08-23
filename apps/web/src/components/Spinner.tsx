export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-8 text-sm text-night-700/70">
      <span className="size-4 motion-safe:animate-spin rounded-full border-2 border-line border-t-clay-500" />
      {label}
    </div>
  )
}
