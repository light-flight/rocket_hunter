import type { PitMove } from './pitlane.ts'

// The finals of a race (PITS_AUDIT.md, «Финалы, обязательные смены и окно пит-стопов»). They run one
// after another on the same karts, and the pits go on from one to the next as they are. In a final
// every pilot must change karts a number of times, mostly once. The pit lane is open from the start
// to some minutes before the end: a pilot must be in it before it closes, and may then wait there as
// long as it takes. Some pit lanes have lights on every corridor: a pilot who came in presses a
// button, the light turns red for the time a change takes, and the next one waits behind him till it
// is over. So once the changes left need more time than the window has, somebody is bound to wait
// under the red, and the manager wants to see that coming. Nothing here touches the phone's
// database: it is the same on every phone and in the tests (npm test).

// A final as the manager set it up (PitLog::FINAL in app/models/pit_log.rb): how many pilots race in
// it, the stops each must make, how many minutes it goes, how many minutes before its end the pit
// lane closes, whether the corridors have lights and how many seconds a change takes under them, and
// when it started, by the clock of the phone that started it: null before the start.
export type Final = {
  pilots: number
  stops: number
  minutes: number
  closes: number
  lights: boolean
  change: number
  start: number | null
}

// The same ranges as the server's.
export const LIMITS = {
  pilots: [1, 99],
  stops: [0, 9],
  minutes: [1, 1440],
  closes: [0, 1439],
  change: [1, 600],
} as const satisfies Record<string, readonly [number, number]>

// What the first final of a race is set up with, but for the pilots: those are typed in before every
// final. The next final takes what the last one had.
export const FIRST: Omit<Final, 'pilots' | 'start'> = { stops: 1, minutes: 25, closes: 5, lights: false, change: 40 }

// How long before the queue under the red is bound to come the manager is told to call his pilot in:
// a lap and a change, give or take.
export const SOON = 2 * 60_000

const MINUTE = 60_000
const SECOND = 1000

// Whether it is a final a phone or the server would keep.
export function isFinal(value: unknown): value is Final {
  if (typeof value !== 'object' || value === null) return false
  const final = value as Record<string, unknown>
  const keys = Object.keys(final).sort().join()
  if (keys !== 'change,closes,lights,minutes,pilots,start,stops') return false
  const within = (key: keyof typeof LIMITS) => {
    const number = final[key]
    return typeof number === 'number' && Number.isInteger(number) && number >= LIMITS[key][0] && number <= LIMITS[key][1]
  }
  return (
    within('pilots') &&
    within('stops') &&
    within('minutes') &&
    within('closes') &&
    (final.closes as number) < (final.minutes as number) &&
    typeof final.lights === 'boolean' &&
    within('change') &&
    (final.start === null || (typeof final.start === 'number' && Number.isInteger(final.start) && final.start >= 0))
  )
}

// When the pit lane closes and when the final ends, by the clock of the phone that started it.
export function closesAt(final: Final & { start: number }): number {
  return final.start + (final.minutes - final.closes) * MINUTE
}

export function endsAt(final: Final & { start: number }): number {
  return final.start + final.minutes * MINUTE
}

// The stops each team made in the final: the moves of a team that stand, entered from the start to
// the end. A stop entered after the pit lane closed counts: the pilot came in before and waited. A
// spare put in by hand is not a stop.
export function stopsIn(final: Final, moves: readonly PitMove[]): Map<string, number> {
  const stops = new Map<string, number>()
  if (final.start === null) return stops
  const end = endsAt({ ...final, start: final.start })
  for (const move of moves) {
    if (move.kart === null || move.at < final.start || move.at >= end) continue
    stops.set(move.kart, (stops.get(move.kart) ?? 0) + 1)
  }
  return stops
}

// The stops a pilot must still make keep the manager's eye: the ones made beyond them count for nothing.
export type Count = { done: number; needed: number }

export function countOf(final: Final, stops: ReadonlyMap<string, number>): Count {
  let done = 0
  for (const made of stops.values()) done += Math.min(made, final.stops)
  const needed = final.pilots * final.stops
  return { done: Math.min(done, needed), needed }
}

// calm: nothing to hurry for. soon: the queue under the red comes in less than SOON, or, with no
// lights, the pit lane closes in less than that with stops still to make. late: somebody is bound to
// wait under the red.
export type Alarm = 'calm' | 'soon' | 'late'

export type Progress =
  | { kind: 'waiting' }
  | (Count & {
      kind: 'open'
      closesIn: number
      left: number
      // With lights only, else null. busy: how long from now the corridors are red with the stops left
      // if they go one after another with no break. spare: how long from now till the moment after
      // which the last of them could no longer start before the pit lane closes: below 0, the last
      // one waits that long at least.
      busy: number | null
      spare: number | null
      alarm: Alarm
    })
  | (Count & { kind: 'closed'; endsIn: number })
  | (Count & { kind: 'over' })

// Where the final is at now, with lanes corridors in the pit lane.
export function progressOf(final: Final, moves: readonly PitMove[], lanes: number, now: number): Progress {
  if (final.start === null) return { kind: 'waiting' }
  const started = { ...final, start: final.start }
  const count = countOf(final, stopsIn(final, moves))
  if (now >= endsAt(started)) return { kind: 'over', ...count }
  const closes = closesAt(started)
  if (now >= closes) return { kind: 'closed', ...count, endsIn: endsAt(started) - now }

  const closesIn = closes - now
  const left = count.needed - count.done
  if (!final.lights) {
    const alarm = left > 0 && closesIn <= SOON ? 'soon' : 'calm'
    return { kind: 'open', ...count, closesIn, left, busy: null, spare: null, alarm }
  }

  const change = final.change * SECOND
  // A corridor is red till the time of the change entered last in it is over.
  const free = Array.from({ length: Math.max(1, lanes) }, () => now)
  for (const move of moves) {
    if (move.kart !== null && move.lane < free.length) free[move.lane] = Math.max(free[move.lane], move.at + change)
  }
  // The stops left go one after another, each into the corridor that is green first.
  let last = now
  for (let stop = 0; stop < left; stop++) {
    const lane = free.indexOf(Math.min(...free))
    last = free[lane]
    free[lane] += change
  }
  const busy = left > 0 ? last + change - now : 0
  const spare = left > 0 ? closes - last : closesIn
  const alarm = left === 0 || spare > SOON ? 'calm' : spare >= 0 ? 'soon' : 'late'
  return { kind: 'open', ...count, closesIn, left, busy, spare, alarm }
}

// A stretch of time as a clock shows it, to the second up: «6:42», «0:05», «1:02:03».
export function clock(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / SECOND)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}
