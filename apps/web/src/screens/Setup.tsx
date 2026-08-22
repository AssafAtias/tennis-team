import { useNavigate } from 'react-router'
import { ProfileForm } from '../components/ProfileForm.js'
import { Card } from '../components/Card.js'

export function Component() {
  const navigate = useNavigate()
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="font-display text-2xl tracking-tight">Set up your profile</h1>
      <p className="mt-2 text-sm text-night-700/80">
        Your name is the only thing we need. Everything else is optional and you can change it any time.
      </p>
      <Card className="mt-6">
        <ProfileForm mode="create" submitLabel="Save profile" onSaved={() => navigate('/', { replace: true })} />
      </Card>
    </main>
  )
}
