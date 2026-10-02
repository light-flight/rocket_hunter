import { useSyncExternalStore } from 'react'
import { isInstalled } from './status.ts'

// What stands between a person in a browser and the installed app. A phone signs in only
// inside the installed app: on iPhone a sign-in made in a browser tab does not carry over.

// Chromium's offer to install the app. Not in TypeScript's DOM types.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
  interface Navigator {
    getInstalledRelatedApps?: () => Promise<unknown[]>
  }
}

// Where a page that cannot install the app sends the person, and how.
type Leave = { step: 'leave'; to: 'Safari' | 'Chrome'; href: string; fromTelegram: boolean }

export type Situation =
  // Nothing to install: the app is installed, or this is a computer.
  | { step: 'none' }
  | Leave
  // Safari on iPhone installs by hand; the steps depend on its version.
  | { step: 'iphone'; safari: number }
  // A browser on Android may offer to install; if it does not, Chrome can.
  | { step: 'android'; chrome: boolean; toChrome: Leave }

export function situation(): Situation {
  if (isInstalled()) return { step: 'none' }

  const agent = navigator.userAgent
  // Telegram's own browser copies the user agent of Safari or Chrome; these are its marks.
  const fromTelegram = 'TelegramWebviewProxy' in window || 'TelegramWebview' in window
  const address = `${location.host}${location.pathname}${location.search}`

  if (/iPhone|iPod/.test(agent)) {
    // Safari's user agent ends exactly so; every other browser on iPhone adds a word of its own.
    const safari = !fromTelegram && /Version\/[\d.]+ Mobile\/\w+ Safari\/[\d.]+$/.test(agent)
    // Since Safari 26 the system version in the user agent is frozen; Version/ is not.
    if (safari) return { step: 'iphone', safari: Number(/Version\/(\d+)/.exec(agent)?.[1]) }

    return { step: 'leave', to: 'Safari', href: `x-safari-https://${address}`, fromTelegram }
  }

  if (/Android/.test(agent)) {
    const toChrome: Leave = {
      step: 'leave',
      to: 'Chrome',
      href: `intent://${address}#Intent;scheme=https;package=com.android.chrome;end`,
      fromTelegram,
    }
    if (fromTelegram) return toChrome

    // Likewise Chrome's: browsers built on it and WebViews put their own words in or after.
    const chrome = /Gecko\) Chrome\/[\d.]+ (Mobile )?Safari\/[\d.]+$/.test(agent)
    return { step: 'android', chrome, toChrome }
  }

  return { step: 'none' }
}

// The offer arrives once, soon after the page loads, and is lost unless someone is listening:
// so the listeners are set when the module loads, before React draws anything.
type Offer = 'none' | 'offered' | 'accepted'

let offered: BeforeInstallPromptEvent | null = null
let accepted = false
const watchers = new Set<() => void>()

function changed() {
  for (const watcher of watchers) watcher()
}

window.addEventListener('beforeinstallprompt', (event) => {
  // The browser's own banner stays away; the page shows a key instead.
  event.preventDefault()
  offered = event
  changed()
})

window.addEventListener('appinstalled', () => {
  accepted = true
  changed()
})

export function useInstallOffer(): Offer {
  return useSyncExternalStore(
    (watcher) => {
      watchers.add(watcher)
      return () => watchers.delete(watcher)
    },
    () => (accepted ? 'accepted' : offered ? 'offered' : 'none'),
  )
}

// Opens the browser's install dialog. Must be called from a tap.
export async function install() {
  const offer = offered
  if (!offer) return

  const answer = await offer.prompt().catch(() => null)
  // An offer can be used once. After a refusal the browser sends a new one.
  if (offered === offer) offered = null
  if (answer?.outcome === 'accepted') accepted = true
  changed()
}
