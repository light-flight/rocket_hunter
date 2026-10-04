import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.ts'

// avatar: the address of the manager's Telegram profile photo, or null when there is none.
export type User = { name: string; avatar: string | null }

export type Auth = ReturnType<typeof useAuth>

const USER_KEY = 'rocket-hunter.user'

// The session itself lives in an HttpOnly cookie that scripts cannot see. The name is kept
// here so the app knows on the first paint, with or without a network, that it is signed in.
function storedUser(): User | null {
  try {
    return toUser(JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'))
  } catch {
    // Storage is unavailable or holds something else.
    return null
  }
}

function toUser(value: unknown): User | null {
  const { name, avatar } = (value ?? {}) as { name?: unknown; avatar?: unknown }
  if (typeof name !== 'string') return null
  return { name, avatar: typeof avatar === 'string' && avatar.startsWith('/api/avatar?') ? avatar : null }
}

// Reads the {"user":{"name":"…","avatar":"/api/avatar?v=…"}} body of a session response.
export async function userFrom(response: Response): Promise<User | null> {
  const body: { user?: unknown } | null = await response.json().catch(() => null)
  return toUser(body?.user)
}

export function useAuth() {
  const [user, setUser] = useState(storedUser)
  const [expired, setExpired] = useState(false)
  const latestCheck = useRef(0)

  const remember = useCallback((user: User) => {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user))
    } catch {
      // Without storage the name lasts until the app is closed.
    }
    setUser(user)
    setExpired(false)
  }, [])

  // Only a 401 means "signed out"; no answer or a server error says nothing about the session.
  // Even then the remembered user stays and the app shows a banner, not the sign-in screen:
  // a manager at the track must be able to keep entering data, with or without a session.
  const check = useCallback(async () => {
    // Checks can overlap, and a sign-in or sign-out can finish while one is on its way;
    // only the most recent result counts.
    const id = ++latestCheck.current
    const response = await api('GET', '/session')
    const user = response?.status === 200 ? await userFrom(response) : null
    if (id !== latestCheck.current) return

    if (user) remember(user)
    else if (response?.status === 401) setExpired(true)
  }, [remember])

  const signedIn = useCallback(
    (user: User) => {
      latestCheck.current++
      remember(user)
    },
    [remember],
  )

  const markExpired = useCallback(() => setExpired(true), [])

  // Resolves to false when the server could not be asked: the session cookie cannot be
  // removed from here, so the app stays signed in. Local data is never wiped.
  const signOut = useCallback(async () => {
    const response = await api('DELETE', '/session')
    if (response?.status !== 204 && response?.status !== 401) return false

    latestCheck.current++
    try {
      localStorage.removeItem(USER_KEY)
    } catch {
      // Nothing was stored in the first place.
    }
    setUser(null)
    setExpired(false)
    return true
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    // oxlint-disable-next-line react/set-state-in-effect -- state changes only after the request settles
    check()
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check])

  return { user, expired, check, signedIn, markExpired, signOut }
}
