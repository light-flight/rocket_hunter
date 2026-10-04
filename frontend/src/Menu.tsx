import { useState } from 'react'
import type { Auth, User } from './auth.ts'
import { Invite } from './Invite.tsx'
import { Sheet } from './Sheet.tsx'
import { useAppCached } from './status.ts'

type MenuProps = { user: User; auth: Auth; onClose: () => void }

// The manager's own things, in a sheet over the list of races: who is signed in, whether the
// app is ready to work without a network, inviting another manager, signing out.
export function Menu({ user, auth, onClose }: MenuProps) {
  const cached = useAppCached()
  const [signOutFailed, setSignOutFailed] = useState(false)

  async function signOut() {
    if (!window.confirm('Выйти из приложения? Чтобы войти снова, понадобятся сеть и Telegram.')) return

    setSignOutFailed(false)
    setSignOutFailed(!(await auth.signOut()))
  }

  return (
    <Sheet label="Меню менеджера" caption="Менеджер" onClose={onClose}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-col gap-0.5 pb-3">
          <p data-testid="current-user" className="text-[1.375rem]/7 font-bold break-words">
            {user.name}
          </p>
          <p className="text-sm text-fg-3">
            Работа без сети: <span data-testid="offline-ready">{cached ? 'готово' : 'не готово'}</span>
            {` · сборка ${__BUILD_ID__}`}
          </p>
        </div>
        <Invite onSessionExpired={auth.markExpired} />
        <button
          type="button"
          onClick={signOut}
          className="h-14 rounded-lg text-body text-fg-2 active:opacity-70"
        >
          Выйти
        </button>
        {signOutFailed && (
          <p role="alert" className="text-center text-sm text-amber-400">Нет связи с сервером. Выйти можно, когда появится сеть.</p>
        )}
      </div>
    </Sheet>
  )
}
