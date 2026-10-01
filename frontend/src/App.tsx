import { useRegisterSW } from 'virtual:pwa-register/react'
import { isInstalled, useAppCached, useServerStatus, useStoragePersisted } from './status.ts'
import { StorageCheck } from './storage-check/StorageCheck.tsx'

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

function App() {
  const [server, checkServer] = useServerStatus()
  const cached = useAppCached()
  const persisted = useStoragePersisted()
  const installed = isInstalled()

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          registration?.update().catch(() => {})
        }
      })
    },
  })

  const serverText = { checking: 'проверяю…', reachable: 'есть', unreachable: 'нет' }[server]

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <h1 className="text-2xl font-bold">Rocket Hunter</h1>

      {needRefresh && (
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-black active:opacity-70"
        >
          Доступно обновление — установить
        </button>
      )}

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
          onClick={checkServer}
          className="mt-3 w-full rounded-xl bg-white/10 px-4 py-3 active:opacity-70"
        >
          Проверить связь
        </button>
      </section>

      <StorageCheck />

      <p className="mt-auto text-center text-xs text-white/40">Сборка {__BUILD_ID__}</p>
    </main>
  )
}

export default App
