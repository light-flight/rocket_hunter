import { useCallback, useEffect, useRef, useState } from 'react'

export type ServerStatus = 'checking' | 'reachable' | 'unreachable'

// navigator.onLine is only a hint, so reachability is decided by a real request.
export function useServerStatus(): [ServerStatus, () => void] {
  const [status, setStatus] = useState<ServerStatus>('checking')
  const latestCheck = useRef(0)

  const check = useCallback(async () => {
    // Checks can overlap; only the most recent one may set the status.
    const id = ++latestCheck.current
    let reachable = false
    try {
      const response = await fetch('/api/health', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      })
      reachable = response.ok
    } catch {
      // No network or no answer in time.
    }
    if (id === latestCheck.current) setStatus(reachable ? 'reachable' : 'unreachable')
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    // oxlint-disable-next-line react/set-state-in-effect -- state changes only after the request settles
    check()
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check])

  return [status, check]
}

// True once a service worker is active, which means the app shell is fully precached.
export function useAppCached(): boolean {
  const [cached, setCached] = useState(false)

  useEffect(() => {
    navigator.serviceWorker?.ready.then(() => setCached(true))
  }, [])

  return cached
}

// Asks the browser not to evict local data under storage pressure.
export function useStoragePersisted(): boolean | null {
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    // navigator.storage is missing outside a secure context (plain http on a LAN address).
    const request = navigator.storage?.persist() ?? Promise.resolve(false)
    request.then(setPersisted, () => setPersisted(false))
  }, [])

  return persisted
}

// On iPhone only the Home Screen app keeps its data; a Safari tab can be wiped after 7 days.
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}
