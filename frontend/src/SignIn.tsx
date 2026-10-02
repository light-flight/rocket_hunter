import { useEffect, useRef, useState } from 'react'
import { api } from './api.ts'
import { type User, userFrom } from './auth.ts'
import { Masthead, Palm } from './glove.tsx'
import { MainAction, TelegramMark } from './ui.tsx'

type Attempt = { telegramUrl: string; expiresAt: number }

const ATTEMPT_KEY = 'rocket-hunter.sign-in'

const STEPS =
  '1. Откройте Telegram и нажмите «Запустить», затем «Войти».\n' +
  '2. Вернитесь в это приложение — вход выполнится сам.'
const EXPIRED = 'Время на вход вышло. Нажмите «Войти через Telegram» ещё раз.'

// The attempt is stored because the page may not survive the trip to Telegram: after a
// reload the app goes on waiting for the same confirmation, or says that its time ran out.
function storedAttempt(): { attempt: Attempt | null; expired: boolean } {
  try {
    const stored: Partial<Attempt> | null = JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? 'null')
    if (typeof stored?.telegramUrl === 'string' && typeof stored.expiresAt === 'number') {
      if (Date.now() < stored.expiresAt) {
        return {
          attempt: { telegramUrl: stored.telegramUrl, expiresAt: stored.expiresAt },
          expired: false,
        }
      }
      storeAttempt(null)
      return { attempt: null, expired: true }
    }
  } catch {
    // Storage is unavailable or holds something else.
  }
  return { attempt: null, expired: false }
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
  return { telegramUrl: body.telegram_url, expiresAt: Date.now() + body.expires_in * 1000 }
}

type SignInProps = {
  onSignedIn: (user: User) => void
  // The sign-in screen itself, not the "sign in again" banner: the icon and the name above,
  // the palm below, the main action at the bottom, under the thumb.
  screen?: boolean
}

// Used by the sign-in screen and by the "sign in again" banner.
export function SignIn({ onSignedIn, screen = false }: SignInProps) {
  const [stored] = useState(storedAttempt)
  const [attempt, setAttempt] = useState(stored.attempt)
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(stored.expired ? EXPIRED : null)
  const [unreachable, setUnreachable] = useState(false)
  // The attempt found in storage at launch: the only one that is polled right away.
  const resumed = useRef(attempt)

  // Asks the server whether the attempt was confirmed in the bot: one request at a time,
  // and only while the app is on screen.
  useEffect(() => {
    if (!attempt) return

    let active = true
    let busy = false
    let timer: number | undefined

    const schedule = (delay: number) => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') timer = window.setTimeout(poll, delay)
    }

    const expire = () => {
      storeAttempt(null)
      setAttempt(null)
      setNotice(EXPIRED)
    }

    const poll = async () => {
      // The request on its way schedules the next one when it settles.
      if (busy) return
      // Checked before asking, so the attempt runs out without a network too.
      if (Date.now() >= attempt.expiresAt) return expire()

      busy = true
      const response = await api('POST', '/session', 5000)
      const user = response?.status === 201 ? await userFrom(response) : null
      busy = false
      if (!active) return

      if (user) {
        storeAttempt(null)
        onSignedIn(user)
      } else if (response?.status === 410) {
        expire()
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

    schedule(attempt === resumed.current ? 0 : 3000)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    return () => {
      active = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [attempt, onSignedIn])

  async function start() {
    setStarting(true)
    setNotice(null)
    const response = await api('POST', '/sign_in_attempt')
    const started = response?.status === 201 ? await attemptFrom(response) : null
    setStarting(false)

    if (started) {
      storeAttempt(started)
      setAttempt(started)
      setUnreachable(false)
    } else if (response === null) {
      setNotice('Нет связи с сервером. Попробуйте ещё раз.')
    } else {
      setNotice('Не удалось начать вход. Попробуйте через несколько минут.')
    }
  }

  function cancel() {
    storeAttempt(null)
    setAttempt(null)
    setNotice(null)
  }

  const layout = `flex flex-col gap-3 ${screen ? 'flex-1' : ''}`

  if (!attempt) {
    return (
      <div className={layout}>
        {screen && <Palm />}
        {screen && <Masthead />}
        {notice && <p className="text-amber-400">{notice}</p>}
        <div className="mt-auto">
          <MainAction onClick={start} disabled={starting}>
            <TelegramMark />
            Войти через Telegram
          </MainAction>
        </div>
      </div>
    )
  }

  return (
    <div className={layout}>
      {screen && <Palm />}
      {screen && <Masthead compact />}
      <p className="whitespace-pre-line">{STEPS}</p>
      {/* A real link tapped by the manager: only that hands over to the Telegram app.
          A new tab keeps this page alive behind it. */}
      <MainAction href={attempt.telegramUrl} newTab>
        Открыть Telegram
      </MainAction>
      <p role="status" className={unreachable ? 'text-amber-400' : 'text-white/60'}>
        {unreachable ? 'Нет связи с сервером, пробуем снова…' : 'Ждём подтверждения в Telegram…'}
      </p>
      <button
        type="button"
        onClick={cancel}
        className="rounded-xl bg-white/10 px-4 py-3 active:opacity-70"
      >
        Отмена
      </button>
    </div>
  )
}
