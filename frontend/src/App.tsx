import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useAuth } from './auth.ts'
import { Install } from './Install.tsx'
import { situation } from './install.ts'
import { Races } from './Races.tsx'
import { SignIn } from './SignIn.tsx'
import { persistStorage } from './status.ts'
import { Trouble } from './Trouble.tsx'

function App() {
  const auth = useAuth()
  const [before] = useState(situation)
  const signedIn = auth.user !== null

  // The races entered on this phone must outlive any clean-up of the browser's storage.
  useEffect(() => {
    if (signedIn) persistStorage()
  }, [signedIn])

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
    // No screen has a header. Positioned and isolated for the background a screen lays under itself.
    // The top starts right under the status bar, which the iPhone draws over the app: the way back
    // and the title have room enough around them of their own.
    <main className="relative isolate mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-[max(env(safe-area-inset-top),0.5rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      {/* An iPhone app draws its status bar white over the app: in the light look it stands on a dark
          strip, or it could not be read. Elsewhere the strip has no height. */}
      <div aria-hidden="true" className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-status-bar" />
      {needRefresh && (
        <button
          type="button"
          onClick={applyUpdate}
          className="rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-black active:opacity-70"
        >
          Доступно обновление — установить
        </button>
      )}

      {auth.user !== null ? (
        <>
          {/* A lost session never hides the app: it only asks to sign in again. */}
          {auth.expired && (
            <section
              data-testid="session-expired"
              className="flex flex-col gap-3 rounded-2xl bg-warn/10 p-4"
            >
              <p>Нужно войти снова. Работать можно: записи сохраняются на телефоне.</p>
              <SignIn onSignedIn={auth.signedIn} />
            </section>
          )}
          <Trouble>
            <Races user={auth.user} auth={auth} />
          </Trouble>
        </>
      ) : before.step === 'none' ? (
        <SignIn onSignedIn={auth.signedIn} screen />
      ) : (
        // A phone signs in inside the installed app only.
        <Install situation={before} />
      )}
    </main>
  )
}

export default App
