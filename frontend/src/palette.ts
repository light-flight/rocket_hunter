import { useSyncExternalStore } from 'react'

// The three colours a kart's pace is mixed from: the fastest, the middle, the slowest. Chosen
// in the manager's menu and kept on this phone, as the look of the app is.

export type Palette = [string, string, string]

const FAST = '#9243da'
const MID = '#525258'
const SLOW = '#461f00'

export const DEFAULT_PALETTE: Palette = [FAST, MID, SLOW]

// A tile that has a colour wears a thin light edge: a dark one would melt into the ground.
// One that has none wears a bold dashed edge, the same one an unknown kart wears.
export const KNOWN_EDGE = 'ring-1 ring-tile-edge ring-inset'
export const BARE_EDGE = 'outline-2 -outline-offset-2 outline-dashed outline-fg-3'

const KEY = 'rocket-hunter.palette'
const HEX = /^#[0-9a-f]{6}$/

const listeners = new Set<() => void>()
let chosen: Palette = stored()

function colour(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const lower = value.toLowerCase()
  return HEX.test(lower) ? lower : undefined
}

function stored(): Palette {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return DEFAULT_PALETTE
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== 3) return DEFAULT_PALETTE
    const colours = [colour(parsed[0]), colour(parsed[1]), colour(parsed[2])]
    if (colours.some((step) => step === undefined)) return DEFAULT_PALETTE
    return colours as Palette
  } catch {
    // Storage is unavailable, or what it holds is not a palette: the karts look as they were made.
    return DEFAULT_PALETTE
  }
}

export function choosePalette(palette: Palette) {
  chosen = [
    colour(palette[0]) ?? chosen[0],
    colour(palette[1]) ?? chosen[1],
    colour(palette[2]) ?? chosen[2],
  ]
  try {
    localStorage.setItem(KEY, JSON.stringify(chosen))
  } catch {
    // Without storage the choice lasts until the app is closed.
  }
  listeners.forEach((listener) => listener())
}

export function usePalette(): Palette {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => chosen,
  )
}

// The colour of a kart by its pace, from 0 (the fastest) to 1 (the slowest). Mixed in OKLCH
// between the three anchors, so every step looks as far from the next one as any other.
export function paceColour(pace: number, palette: Palette): string {
  const p = Math.min(1, Math.max(0, pace))
  const [fast, mid, slow] = palette
  return p <= 0.5
    ? `color-mix(in oklch, ${fast}, ${mid} ${(p * 200).toFixed(1)}%)`
    : `color-mix(in oklch, ${mid}, ${slow} ${((p - 0.5) * 200).toFixed(1)}%)`
}

// Light numbers disappear once a tile is about this light. The number goes dark instead.
const LIGHT_TILE = 0.3

// Whether the number on this pace should be dark: the tile is a light colour.
export function paceIsLight(pace: number, palette: Palette): boolean {
  const p = Math.min(1, Math.max(0, pace))
  const [fast, mid, slow] = palette
  const left = p <= 0.5 ? fast : mid
  const right = p <= 0.5 ? mid : slow
  const t = p <= 0.5 ? p * 2 : (p - 0.5) * 2
  return luminance(left) * (1 - t) + luminance(right) * t > LIGHT_TILE
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const channel = (value: number) => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}
