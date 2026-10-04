import { type KeyboardEvent, useId, useState } from 'react'
import type { Auth, User } from './auth.ts'
import { Invite } from './Invite.tsx'
import { Sheet } from './Sheet.tsx'
import { useAppCached } from './status.ts'
import { chooseTheme, THEMES, useTheme } from './theme.ts'

type MenuProps = { user: User; auth: Auth; onClose: () => void }

// The manager's own things, in a sheet over the list of races: who is signed in, whether the
// app is ready to work without a network, the look of the app, inviting another manager, signing out.
export function Menu({ user, auth, onClose }: MenuProps) {
  const cached = useAppCached()
  const [signOutFailed, setSignOutFailed] = useState(false)

  async function signOut() {
    if (!window.confirm('Выйти из приложения? Чтобы войти снова, понадобятся сеть и Telegram.')) return

    setSignOutFailed(false)
    setSignOutFailed(!(await auth.signOut()))
  }

  return (
    <Sheet label="Меню менеджера" onClose={onClose}>
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
        <ThemePicker />
        <Invite onSessionExpired={auth.markExpired} />
        <button
          type="button"
          onClick={signOut}
          className="h-14 rounded-lg text-body text-fg-2 active:opacity-70"
        >
          Выйти
        </button>
        {signOutFailed && (
          <p role="alert" className="text-center text-sm text-warn">Нет связи с сервером. Выйти можно, когда появится сеть.</p>
        )}
      </div>
    </Sheet>
  )
}

// The look of the app on this phone: three parts of one key, the chosen one raised.
function ThemePicker() {
  const theme = useTheme()
  const label = useId()

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = THEMES.findIndex((option) => option.theme === theme)
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    const next = (at + step + THEMES.length) % THEMES.length
    chooseTheme(THEMES[next].theme)
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-2 pb-2">
      <p id={label} className="text-sm text-fg-3">
        Оформление
      </p>
      <div
        role="radiogroup"
        aria-labelledby={label}
        onKeyDown={onKeyDown}
        className="grid h-12 grid-cols-3 gap-1 rounded-lg bg-well p-1 ring-1 ring-control ring-inset"
      >
        {THEMES.map((option) => {
          const chosen = option.theme === theme
          return (
            <button
              key={option.theme}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen ? 0 : -1}
              onClick={() => chooseTheme(option.theme)}
              className={`rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-inset ${
                chosen ? 'bg-thumb font-semibold text-fg shadow-[var(--shadow-thumb)]' : 'text-fg-3 active:opacity-70'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
