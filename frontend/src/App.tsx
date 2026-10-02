import { useRegisterSW } from 'virtual:pwa-register/react'
import { useAuth } from './auth.ts'
import { Home } from './Home.tsx'
import { SignIn } from './SignIn.tsx'
import { isInstalled } from './status.ts'

function App() {
  const auth = useAuth()

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

  // A page opened before any service worker existed (every first launch) is not controlled
  // by one. The new worker is already active there, so a reload is all it takes; the
  // plugin's own path would do nothing.
  function applyUpdate() {
    if (navigator.serviceWorker.controller) updateServiceWorker()
    else window.location.reload()
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <h1 className="text-2xl font-bold">Rocket Hunter</h1>

      {needRefresh && (
        <button
          type="button"
          onClick={applyUpdate}
          className="rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-black active:opacity-70"
        >
          Доступно обновление — установить
        </button>
      )}

      {auth.user === null ? (
        <section className="rounded-2xl bg-white/5 p-4">
          <SignIn onSignedIn={auth.signedIn} installHint={!isInstalled()} />
        </section>
      ) : (
        <>
          {/* A lost session never hides the app: it only asks to sign in again. */}
          {auth.expired && (
            <section
              data-testid="session-expired"
              className="flex flex-col gap-3 rounded-2xl bg-amber-400/10 p-4"
            >
              <p>Нужно войти снова. Работать можно: записи сохраняются на телефоне.</p>
              <SignIn onSignedIn={auth.signedIn} />
            </section>
          )}
          <Home user={auth.user} auth={auth} />
        </>
      )}

      <p className="mt-auto text-center text-xs text-white/40">Сборка {__BUILD_ID__}</p>
    </main>
  )
}

export default App
