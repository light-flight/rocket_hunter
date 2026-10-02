import { useState } from 'react'
import type { Auth, User } from './auth.ts'
import { Invite } from './Invite.tsx'
import { isInstalled, useAppCached, useServerStatus, useStoragePersisted } from './status.ts'

type RowProps = { label: string; ok: boolean | null; value: string; testId?: string }

function Row({ label, ok, value, testId }: RowProps) {
  const color = ok === null ? 'text-white/60' : ok ? 'text-emerald-400' : 'text-amber-400'
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-white/60">{label}</span>
      <span data-testid={testId} className={`font-semibold ${color}`}>
        {value}
      </span>
    </li>
  )
}

type HomeProps = { user: User; auth: Auth }

export function Home({ user, auth }: HomeProps) {
  const [server, checkServer] = useServerStatus()
  const cached = useAppCached()
  const persisted = useStoragePersisted()
  const installed = isInstalled()
  const [signOutFailed, setSignOutFailed] = useState(false)

  const serverText = { checking: 'проверяю…', reachable: 'есть', unreachable: 'нет' }[server]

  function checkConnection() {
    checkServer()
    auth.check()
  }

  async function signOut() {
    if (!window.confirm('Выйти из приложения? Чтобы войти снова, понадобятся сеть и Telegram.')) return

    setSignOutFailed(false)
    setSignOutFailed(!(await auth.signOut()))
  }

  return (
    <>
      <section className="rounded-2xl bg-white/5 p-4">
        <ul className="divide-y divide-white/10">
          <Row
            label="Связь с сервером"
            ok={server === 'checking' ? null : server === 'reachable'}
            value={serverText}
            testId="server-status"
          />
          <Row
            label="Работа без сети"
            ok={cached}
            value={cached ? 'готово' : 'не готово'}
            testId="offline-ready"
          />
          <Row
            label="Установлено на телефон"
            ok={installed}
            value={installed ? 'да' : 'нет'}
          />
          <Row
            label="Данные защищены от очистки"
            ok={persisted}
            value={persisted === null ? 'проверяю…' : persisted ? 'да' : 'нет'}
          />
        </ul>
        <button
          type="button"
          onClick={checkConnection}
          className="mt-3 w-full rounded-xl bg-white/10 px-4 py-3 active:opacity-70"
        >
          Проверить связь
        </button>
      </section>

      <section className="rounded-2xl bg-white/5 p-4">
        <div className="flex items-center justify-between gap-4">
          <p className="flex min-w-0 flex-col">
            <span className="text-white/60">Менеджер</span>
            <span data-testid="current-user" className="truncate font-semibold">
              {user.name}
            </span>
          </p>
          <button
            type="button"
            onClick={signOut}
            className="rounded-xl bg-white/10 px-4 py-3 active:opacity-70"
          >
            Выйти
          </button>
        </div>
        {signOutFailed && (
          <p className="mt-3 text-amber-400">
            Нет связи с сервером. Выйти можно, когда появится сеть.
          </p>
        )}
      </section>

      <Invite onSessionExpired={auth.markExpired} />
    </>
  )
}
