import { useLiveQuery } from 'dexie-react-hooks'
import { api } from './api.ts'
import { db, type PitLog } from './db.ts'
import { newId } from './id.ts'
import { CORRIDORS, type Moves, type PitMove, merge, standing } from './pitlane.ts'
import { watchedRaces } from './watch.ts'

export type { PitMove }

// The pits of a race on this phone. A team's number is always on the track: a team that comes in
// leaves its kart at the end of a corridor and goes out on the one at the front, so the karts
// change hands all race long, and pitlane.ts works out from the moves which kart is where. The
// phone keeps every move, so any of them can be undone back to the very first, and done again.
// The log goes to the server after every change when there is a network, and the other phones of
// the team take it from there. Any phone may enter. The server numbers the versions of its log
// and refuses a log made from an older version than it has: the phone then merges its changes
// with the ones made on the other phones and sends the result, so a phone that lagged behind
// never wipes out what another one entered. A send whose answer was lost goes again as it was,
// and the server tells whether it took it: so what was undone after it is merged as undone.

// The pit log of a race. undefined until the database has answered, null if it cannot be read.
export function usePitLog(raceId: string): PitLog | null | undefined {
  return useLiveQuery(
    () =>
      db.pits
        .get(raceId)
        .then((log) => log ?? { raceId, moves: [], count: 0, pending: 0 as const, server: null, sent: null })
        .catch(() => null),
    [raceId],
  )
}

// Something done: whatever was undone before it cannot be done again any more. It is written
// down with the time, so that a merge with the moves of another phone keeps the order they came in.
export async function recordMove(raceId: string, move: PitMove): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = (await db.pits.get(raceId)) ?? { raceId, moves: [], count: 0, server: null, sent: null }
    const moves = [...log.moves.slice(0, log.count), { ...move, at: Date.now() }]
    await db.pits.put({ raceId, moves, count: moves.length, pending: 1, server: log.server, sent: log.sent ?? null })
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
  const at = move?.at
  return (
    typeof move?.lane === 'number' &&
    Number.isInteger(move.lane) &&
    move.lane >= 0 &&
    move.lane < CORRIDORS &&
    (kart === null || (typeof kart === 'string' && KART.test(kart))) &&
    (at === undefined || (Number.isInteger(at) && at >= 0))
  )
}

type ServerLog = NonNullable<PitLog['server']>
type Sent = NonNullable<PitLog['sent']>

function isServerLog(value: unknown): value is ServerLog {
  const log = value as Partial<ServerLog> | null
  const count = log?.count
  const version = log?.version
  return (
    Array.isArray(log?.moves) &&
    log.moves.every(isMove) &&
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= 0 &&
    count <= log.moves.length &&
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= 0
  )
}

// The server's log in an answer, as the phone keeps it. null if the answer has none.
async function serverLog(response: Response): Promise<ServerLog | null> {
  const body: unknown = await response.json().catch(() => null)
  return isServerLog(body) ? { moves: body.moves, count: body.count, version: body.version } : null
}

// The same moves stand in both logs.
function alike(a: Moves, b: Moves): boolean {
  const key = (log: Moves) => JSON.stringify(standing(log).map((move) => [move.lane, move.kart, move.at]))
  return key(a) === key(b)
}

// Sends the logs changed on this phone, then takes the logs of the races on screen. true when a
// log here has yet to go: merged with the server's, or changed since the log the server took.
async function exchange(onSignedOut: () => void): Promise<boolean> {
  let more = false

  for (const log of await db.pits.where('pending').equals(1).toArray()) {
    // A send with no answer goes again as it was, before anything newer: the server may have taken
    // it, and only a send of the same id learns so.
    const sent = log.sent ?? { id: newId(), moves: log.moves, count: log.count }
    if (!log.sent) await db.pits.update(log.raceId, { sent })
    const response = await api('PUT', `/races/${log.raceId}/pit_log`, 10_000, {
      pit_log: { moves: sent.moves, count: sent.count, version: log.server?.version ?? 0, send: sent.id },
    })
    // No answer, and the rest would get none either. The log may have reached the server even so.
    if (response === null) return false
    if (response.status === 401) {
      onSignedOut()
      return false
    }
    if (response.status !== 200 && response.status !== 409) {
      // Not taken (a race the server does not have yet, a log it refuses, a failure in it): it
      // goes next time, as it is then. The proxy in front of the server may give up on it after it
      // took the log (502–504): that send goes again.
      if (response.status <= 500) await db.transaction('rw', db.pits, () => answered(log.raceId, sent))
      continue
    }
    // The server's log: the one just sent, or as it is now if another phone has changed it.
    const server = await serverLog(response)
    if (!server) continue

    const unsent =
      response.status === 200 ? await taken(log.raceId, sent, server.version) : await refused(log.raceId, sent, server)
    if (unsent) more = true
  }

  for (const raceId of watchedRaces()) {
    const response = await api('GET', `/races/${raceId}/pit_log`)
    if (response === null) return false
    if (response.status === 401) {
      onSignedOut()
      return false
    }
    if (response.status !== 200) continue

    const server = await serverLog(response)
    if (!server) continue
    await db.transaction('rw', db.pits, async () => {
      const here = await db.pits.get(raceId)
      // A change made here and not sent yet: it is merged with the server's log when it is sent.
      if (here?.pending === 1) return
      // An answer older than a log this phone has had from the server since.
      if (here?.server && here.server.version > server.version) return
      await db.pits.put({ raceId, moves: server.moves, count: server.count, pending: 0, server, sent: null })
    })
  }
  return more
}

// The answer to a send: the next one is of the log as it is then. false when the answer is to a
// send that is not on its way any more (another tab of the app had it first).
async function answered(raceId: string, sent: Sent): Promise<boolean> {
  const now = await db.pits.get(raceId)
  if (now?.sent?.id !== sent.id) return false
  await db.pits.update(raceId, { sent: null })
  return true
}

// The server has taken the log sent, under a new version or, when it had the same log, the one
// it had; or it took it before and the answer was lost, under the version it made then. true
// when the log here has changed since, and the change has yet to go.
async function taken(raceId: string, sent: Sent, version: number): Promise<boolean> {
  return db.transaction('rw', db.pits, async () => {
    if (!(await answered(raceId, sent))) return false
    const now = (await db.pits.get(raceId))!
    const server = { moves: sent.moves, count: sent.count, version }
    const changed = JSON.stringify([now.moves, now.count]) !== JSON.stringify([sent.moves, sent.count])
    await db.pits.update(raceId, changed ? { server } : { server, pending: 0 })
    return changed
  })
}

// The server has refused the log, and has not taken it before either: another phone has changed
// the pits since this one last had the server's log. What was done here and what was done there
// are merged, so neither is lost. true when the merged log has something the server does not, and
// so has yet to go.
async function refused(raceId: string, sent: Sent, server: ServerLog): Promise<boolean> {
  return db.transaction('rw', db.pits, async () => {
    if (!(await answered(raceId, sent))) return false
    // The log here now: it may have changed again while the refused one was on its way.
    const now = (await db.pits.get(raceId))!
    const merged = merge(now.server, now, server)
    // Nothing done here that the server does not have: its log is the team's.
    if (alike(merged, server)) {
      await db.pits.put({ raceId, moves: server.moves, count: server.count, pending: 0, server, sent: null })
      return false
    }
    await db.pits.put({ raceId, moves: merged.moves, count: merged.count, pending: 1, server, sent: null })
    return true
  })
}

// How many times one sync sends a log again at once, merged or changed while on its way. Two
// phones entering at the same moment can each be refused a few times over; past that the log goes
// with the next sync.
const RESENDS = 3

let running: Promise<void> | null = null
let again = false

// One exchange at a time. Asked for while one is on its way, it runs once more after it, and so it
// does when a log here has yet to go. Never fails: what was not sent stays pending and goes next
// time.
export function syncPits(onSignedOut: () => void): Promise<void> {
  if (running) {
    again = true
    return running
  }

  running = (async () => {
    try {
      let resends = 0
      do {
        again = false
        if ((await exchange(onSignedOut)) && resends < RESENDS) {
          resends++
          again = true
        }
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
