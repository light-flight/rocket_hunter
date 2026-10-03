import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PitLog, type PitMove } from './db.ts'

export type { PitMove }

// The pits of a race. Before the start the manager puts unknown karts into the corridors; in the
// race, a kart that comes in is dropped into its corridor: it joins the end of the queue and the
// kart at the front goes out to the track. The phone keeps every move, so any of them can be
// undone back to the very first, and done again.

// The pit log of a race. undefined until the database has answered, null if it cannot be read.
export function usePitLog(raceId: string): PitLog | null | undefined {
  return useLiveQuery(
    () =>
      db.pits
        .get(raceId)
        .then((log) => log ?? { raceId, moves: [], count: 0 })
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
    await db.pits.put({ raceId, moves, count: moves.length })
  })
}

export async function undoMove(raceId: string): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = await db.pits.get(raceId)
    if (log && log.count > 0) await db.pits.update(raceId, { count: log.count - 1 })
  })
}

export async function redoMove(raceId: string): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = await db.pits.get(raceId)
    if (log && log.count < log.moves.length) await db.pits.update(raceId, { count: log.count + 1 })
  })
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
