import { useEffect, useState } from 'react'

// True once a service worker is active, which means the app shell is fully precached.
export function useAppCached(): boolean {
  const [cached, setCached] = useState(false)

  useEffect(() => {
    navigator.serviceWorker?.ready.then(() => setCached(true))
  }, [])

  return cached
}

// Asks the browser not to evict local data under storage pressure.
export function persistStorage() {
  // navigator.storage is missing outside a secure context (plain http on a LAN address).
  navigator.storage?.persist().catch(() => {})
}

// On iPhone only the Home Screen app keeps its data; a Safari tab can be wiped after 7 days.
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}
