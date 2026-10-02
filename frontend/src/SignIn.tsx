import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { type User, userFrom } from './auth.ts'
import { Masthead, Palm } from './glove.tsx'
import { MainAction, TelegramMark } from './ui.tsx'

// opened: the manager has tapped the link, so a confirmation may be on its way.
type Attempt = { telegramUrl: string; expiresAt: number; opened: boolean }

const ATTEMPT_KEY = 'rocket-hunter.sign-in'

const EXPIRED = 'Время на вход вышло. Нажмите «Войти через Telegram» ещё раз.'

// The attempt is stored because the page may not survive the trip to Telegram: after a
// reload the app goes on waiting for the same confirmation.
function storedAttempt(): Attempt | null {
  try {
    const stored: Partial<Attempt> | null = JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? 'null')
    if (
      typeof stored?.telegramUrl === 'string' &&
      typeof stored.expiresAt === 'number' &&
      Date.now() < stored.expiresAt
    ) {
      return { telegramUrl: stored.telegramUrl, expiresAt: stored.expiresAt, opened: stored.opened === true }
    }
  } catch {
    // Storage is unavailable or holds something else.
  }
  return null
}

function storeAttempt(attempt: Attempt | null) {
  try {
    if (attempt) localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt))
    else localStorage.removeItem(ATTEMPT_KEY)
  } catch {
    // Without storage the attempt lasts as long as the page does.
  }
}

// Reads the {"telegram_url":"…","expires_in":300} body of a new attempt.
async function attemptFrom(response: Response): Promise<Attempt | null> {
  const body: { telegram_url?: unknown; expires_in?: unknown } | null = await response
    .json()
    .catch(() => null)
  if (typeof body?.telegram_url !== 'string' || typeof body.expires_in !== 'number') return null
  return { telegramUrl: body.telegram_url, expiresAt: Date.now() + body.expires_in * 1000, opened: false }
}

type SignInProps = {
  onSignedIn: (user: User) => void
  // The sign-in screen itself, not the "sign in again" banner: the icon and the name above,
  // the palm below, the main action at the bottom, under the thumb.
  screen?: boolean
}

// Used by the sign-in screen and by the "sign in again" banner.
export function SignIn({ onSignedIn, screen = false }: SignInProps) {
  const [attempt, setAttempt] = useState(storedAttempt)
  const [notice, setNotice] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState(false)

  // The attempt is started before the tap, so that the key is a link straight to Telegram:
  // only a real link tapped by the manager hands over to the Telegram app.
  useEffect(() => {
    if (attempt) {
      const timer = setTimeout(() => {
        storeAttempt(null)
        setAttempt(null)
        if (attempt.opened) setNotice(EXPIRED)
      }, attempt.expiresAt - Date.now())
      return () => clearTimeout(timer)
    }

    let active = true
    const start = async () => {
      const response = await api('POST', '/sign_in_attempt')
      const started = response?.status === 201 ? await attemptFrom(response) : null
      if (!active) return

      if (started) {
        storeAttempt(started)
        setAttempt(started)
      } else if (response === null) {
        setNotice('Нет связи с сервером.')
      } else {
        setNotice('Не удалось начать вход. Попробуйте через несколько минут.')
      }
    }

    start()
    window.addEventListener('online', start)
    return () => {
      active = false
      window.removeEventListener('online', start)
    }
  }, [attempt])

  // Asks the server whether the attempt was confirmed in the bot: one request at a time,
  // and only while the app is on screen.
  useEffect(() => {
    if (!attempt?.opened) return

    let active = true
    let busy = false
    let timer: number | undefined

    const schedule = (delay: number) => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') timer = window.setTimeout(poll, delay)
    }

    const poll = async () => {
      // The request on its way schedules the next one when it settles.
      if (busy) return

      busy = true
      const response = await api('POST', '/session', 5000)
      const user = response?.status === 201 ? await userFrom(response) : null
      busy = false
      if (!active) return

      if (user) {
        storeAttempt(null)
        onSignedIn(user)
      } else if (response?.status === 410) {
        storeAttempt(null)
        setAttempt(null)
        setNotice(EXPIRED)
      } else {
        setUnreachable(response?.status !== 202 && response?.status !== 429)
        schedule(response?.status === 429 ? 10_000 : 3000)
      }
    }

    const onVisibility = () => {
      // Not at once: on iOS a request fired right at this event can hang.
      if (document.visibilityState === 'visible') schedule(500)
      else clearTimeout(timer)
    }
    const onOnline = () => schedule(0)

    schedule(0)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    return () => {
      active = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [attempt, onSignedIn])

  function opened() {
    if (!attempt || attempt.opened) return
    const waiting = { ...attempt, opened: true }
    storeAttempt(waiting)
    setAttempt(waiting)
    setNotice(null)
  }

  return (
    <div className={`flex flex-col gap-3 ${screen ? 'flex-1' : ''}`}>
      {screen && <Palm />}
      {screen && <Masthead />}
      {notice && <p className="text-amber-400">{notice}</p>}
      <div className="mt-auto flex flex-col gap-3">
        {attempt?.opened && (
          <p role="status" className={`text-center text-sm ${unreachable ? 'text-amber-400' : 'text-fg-2'}`}>
            {unreachable ? 'Нет связи с сервером, пробуем снова…' : 'Ждём подтверждения в Telegram…'}
          </p>
        )}
        {/* A new tab keeps this page alive behind Telegram. */}
        <MainAction href={attempt?.telegramUrl} newTab onClick={opened} disabled={!attempt}>
          <TelegramMark />
          Войти через Telegram
        </MainAction>
      </div>
    </div>
  )
}
