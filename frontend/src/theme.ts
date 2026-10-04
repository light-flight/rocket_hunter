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
// The ground of each look: what a phone paints around the app (theme-color), and the same dimmed as
// under a sheet (--color-scrim), so that the status bar of an Android phone dims with the screen.
const GROUND = { dark: '#060607', light: '#f2f2f5' }
const DIMMED = { dark: '#020203', light: '#a5a5a7' }

const listeners = new Set<() => void>()
let chosen: Theme = stored()
// How many sheets are open now.
let dims = 0

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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', (dims > 0 ? DIMMED : GROUND)[look])
}

// A sheet opened over the screen, or closed.
export function dimStatusBar(on: boolean) {
  dims = Math.max(0, dims + (on ? 1 : -1))
  apply()
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
