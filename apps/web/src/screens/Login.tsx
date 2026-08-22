import { Card } from '../components/Card.js'

export function Component() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm text-center">
        <p className="font-display text-lg text-clay-500">Tennis Team</p>
        <p className="mt-2 text-sm text-night-700/70">Sign-in is coming in a later task.</p>
      </Card>
    </div>
  )
}
