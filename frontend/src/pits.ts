import { useLiveQuery } from 'dexie-react-hooks'
import { api } from './api.ts'
import { db, type PitLog, type PitMove } from './db.ts'
import { watchedRaces } from './watch.ts'

export type { PitMove }

// The pits of a race. Before the start the manager puts unknown karts into the corridors; in the
// race, a kart that comes in is dropped into its corridor: it joins the end of the queue and the
// kart at the front goes out to the track. The phone keeps every move, so any of them can be
// undone back to the very first, and done again. The log goes to the server after every change
// when there is a network, and the other phones of the team take it from there.

// The pit log of a race. undefined until the database has answered, null if it cannot be read.
export function usePitLog(raceId: string): PitLog | null | undefined {
  return useLiveQuery(
    () =>
      db.pits
        .get(raceId)
        .then((log) => log ?? { raceId, moves: [], count: 0, pending: 0 as const })
        .catch(() => null),
    [raceId],
  )
}

// What stands in each corridor, front (the exit) first. null is a kart nobody knows.
export function corridors(log: PitLog, lanes: number): (string | null)[][] {
  const queues: (string | null)[][] = Array.from({ length: lanes }, () => [])

  for (const move of log.moves.slice(0, log.count)) {
    const queue = queues[move.lane]
    // A corridor taken away when the race was changed.
    if (!queue) continue
    if (move.kart === null) {
      queue.push(null)
      continue
    }
    // A kart is in one place only, whatever the corridors were before.
    for (const other of queues) {
      const at = other.indexOf(move.kart)
      if (at >= 0) other.splice(at, 1)
    }
    const waiting = queue.length
    queue.push(move.kart)
    if (waiting > 0) queue.shift()
  }
  return queues
}

// Something done: whatever was undone before it cannot be done again any more.
export async function recordMove(raceId: string, move: PitMove): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = (await db.pits.get(raceId)) ?? { raceId, moves: [], count: 0 }
    const moves = [...log.moves.slice(0, log.count), move]
    await db.pits.put({ raceId, moves, count: moves.length, pending: 1 })
  })
}

export async function undoMove(raceId: string): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = await db.pits.get(raceId)
    if (log && log.count > 0) await db.pits.update(raceId, { count: log.count - 1, pending: 1 })
  })
}

export async function redoMove(raceId: string): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = await db.pits.get(raceId)
    if (log && log.count < log.moves.length) await db.pits.update(raceId, { count: log.count + 1, pending: 1 })
  })
}

// The same rules as the server's (app/models/pit_log.rb).
const KART = /^\d{1,3}[A-Z]?$/

function isMove(value: unknown): value is PitMove {
  const move = value as Partial<PitMove> | null
  const kart = move?.kart
  return (
    typeof move?.lane === 'number' &&
    Number.isInteger(move.lane) &&
    move.lane >= 0 &&
    (kart === null || (typeof kart === 'string' && KART.test(kart)))
  )
}

function isServerLog(value: unknown): value is Pick<PitLog, 'moves' | 'count'> {
  const log = value as Partial<PitLog> | null
  const count = log?.count
  return (
    Array.isArray(log?.moves) &&
    log.moves.every(isMove) &&
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= 0 &&
    count <= log.moves.length
  )
}

// Sends the logs changed on this phone, then takes the logs of the races on screen.
async function exchange(onSignedOut: () => void): Promise<void> {
  for (const log of await db.pits.where('pending').equals(1).toArray()) {
    const response = await api('PUT', `/races/${log.raceId}/pit_log`, 10_000, {
      pit_log: { moves: log.moves, count: log.count },
    })
    // No network: the rest would fail the same way.
    if (response === null) return
    if (response.status === 401) return onSignedOut()
    // Not taken (a race the server does not have yet, a failure on its side): it goes next time.
    if (!response.ok) continue

    const sent = JSON.stringify([log.moves, log.count])
    await db.transaction('rw', db.pits, async () => {
      // Changed again while on its way: the new version has yet to go.
      const now = await db.pits.get(log.raceId)
      if (now && JSON.stringify([now.moves, now.count]) === sent) await db.pits.update(log.raceId, { pending: 0 })
    })
  }

  for (const raceId of watchedRaces()) {
    const response = await api('GET', `/races/${raceId}/pit_log`)
    if (response === null) return
    if (response.status === 401) return onSignedOut()
    if (response.status !== 200) continue

    const body: unknown = await response.json().catch(() => null)
    if (!isServerLog(body)) continue
    await db.transaction('rw', db.pits, async () => {
      // A change made here and not sent yet wins over what the server has.
      if ((await db.pits.get(raceId))?.pending === 1) return
      await db.pits.put({ raceId, moves: body.moves, count: body.count, pending: 0 })
    })
  }
}

let running: Promise<void> | null = null
let again = false

// One exchange at a time. Asked for while one is on its way, it runs once more after it.
// Never fails: what was not sent stays pending and goes next time.
export function syncPits(onSignedOut: () => void): Promise<void> {
  if (running) {
    again = true
    return running
  }

  running = (async () => {
    try {
      do {
        again = false
        await exchange(onSignedOut)
      } while (again)
    } catch {
      // The database or the network failed halfway: the next exchange starts over.
    } finally {
      running = null
    }
  })()
  return running
}

// The colour of a kart by its pace: purple the fastest, grey the middle, brown the slowest.
// Mixed in OKLCH, so every step looks as far from the next one as any other.
export function paceColour(pace: number): string {
  const p = Math.min(1, Math.max(0, pace))
  return p <= 0.5
    ? `color-mix(in oklch, #9243da, #525258 ${(p * 200).toFixed(1)}%)`
    : `color-mix(in oklch, #525258, #461f00 ${((p - 0.5) * 200).toFixed(1)}%)`
}

// Kart numbers in the order people count them: 2 before 10, 12 before 12A.
export function byNumber(a: string, b: string): number {
  return a.localeCompare(b, 'ru', { numeric: true })
}
