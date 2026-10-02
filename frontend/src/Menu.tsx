import { useEffect, useRef, useState } from 'react'
import type { Auth, User } from './auth.ts'
import { Invite } from './Invite.tsx'
import { useAppCached } from './status.ts'

type MenuProps = { user: User; auth: Auth; onClose: () => void }

// The manager's own things, in a sheet over the list of races: who is signed in, whether the
// app is ready to work without a network, inviting another manager, signing out.
export function Menu({ user, auth, onClose }: MenuProps) {
  const sheet = useRef<HTMLDialogElement>(null)
  const cached = useAppCached()
  const [signOutFailed, setSignOutFailed] = useState(false)

  useEffect(() => {
    sheet.current?.showModal()
  }, [])

  async function signOut() {
    if (!window.confirm('Выйти из приложения? Чтобы войти снова, понадобятся сеть и Telegram.')) return

    setSignOutFailed(false)
    setSignOutFailed(!(await auth.signOut()))
  }

  return (
    <dialog
      ref={sheet}
      onClose={onClose}
      // A tap on the dimmed screen around the sheet closes it.
      onClick={(event) => event.target === sheet.current && sheet.current.close()}
      aria-label="Меню менеджера"
      className="mx-auto mt-auto mb-0 w-full max-w-md rounded-t-2xl bg-sheet text-fg ring-1 ring-line backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-1 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div aria-hidden="true" className="mb-3 h-1.25 w-9 self-center rounded-full bg-cap-edge" />
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
          <p className="text-center text-sm text-amber-400">Нет связи с сервером. Выйти можно, когда появится сеть.</p>
        )}
      </div>
    </dialog>
  )
}
