import { useSyncExternalStore } from 'react'

// The look of the app: dark, as it was made, light, or whichever the phone is in. Chosen in the
// manager's menu and kept on this phone. index.html applies the choice before the first paint, the
// same way as here, so the app never opens in the other look first.

export type Theme = 'dark' | 'light' | 'system'

export const THEMES: { theme: Theme; label: string }[] = [
  { theme: 'dark', label: 'Тёмное' },
  { theme: 'light', label: 'Светлое' },
  { theme: 'system', label: 'Как в телефоне' },
]

const KEY = 'rocket-hunter.theme'
// The ground of each look: what a phone paints around the app (theme-color).
const GROUND = { dark: '#060607', light: '#f2f2f5' }

const listeners = new Set<() => void>()
let chosen: Theme = stored()

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'system' ? value : 'dark'
  } catch {
    // Storage is unavailable: the app looks as it was made.
    return 'dark'
  }
}

const phoneIsLight = () => window.matchMedia('(prefers-color-scheme: light)').matches

function apply() {
  const look = chosen === 'system' ? (phoneIsLight() ? 'light' : 'dark') : chosen
  document.documentElement.dataset.theme = look
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', GROUND[look])
}

export function chooseTheme(theme: Theme) {
  chosen = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Without storage the choice lasts until the app is closed.
  }
  apply()
  listeners.forEach((listener) => listener())
}

// Follows the phone while the look is the phone's.
export function watchTheme() {
  apply()
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => chosen === 'system' && apply())
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => chosen,
  )
}
