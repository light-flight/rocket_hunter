import { useEffect, useRef, useState } from 'react'
import { api } from './api.ts'
import { type User, userFrom } from './auth.ts'

type Attempt = { telegramUrl: string; expiresAt: number }

const ATTEMPT_KEY = 'rocket-hunter.sign-in'

const INSTALL_HINT =
  'Сначала установите приложение. iPhone: откройте эту страницу в Safari, «Поделиться» → ' +
  '«На экран „Домой“». Android: откройте в Chrome, меню → «Установить приложение». Если страница ' +
  'открылась внутри Telegram, выберите «Открыть в браузере». Потом откройте Rocket Hunter с иконки ' +
  'и войдите там: на iPhone вход в браузере в приложение не переносится.'
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

type SignInProps = { onSignedIn: (user: User) => void; installHint?: boolean }

// Used by the sign-in screen and by the "sign in again" banner.
export function SignIn({ onSignedIn, installHint = false }: SignInProps) {
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

  if (!attempt) {
    return (
      <div className="flex flex-col gap-3">
        {installHint && <p className="text-white/80">{INSTALL_HINT}</p>}
        {notice && <p className="text-amber-400">{notice}</p>}
        <button
          type="button"
          onClick={start}
          disabled={starting}
          className="rounded-xl bg-white px-4 py-3 font-semibold text-black active:opacity-70 disabled:opacity-50"
        >
          Войти через Telegram
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="whitespace-pre-line">{STEPS}</p>
      {/* A real link tapped by the manager: only that hands over to the Telegram app.
          target="_blank" keeps this page alive behind it. */}
      <a
        href={attempt.telegramUrl}
        target="_blank"
        rel="noopener"
        className="rounded-xl bg-white px-4 py-3 text-center font-semibold text-black active:opacity-70"
      >
        Открыть Telegram
      </a>
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
