import { useLiveQuery } from 'dexie-react-hooks'
import { api } from './api.ts'
import { db, emptyPitLog, type PitLog } from './db.ts'
import { newId } from './id.ts'
import { CORRIDORS, type PitMove, isOld, lastMove, nextTime, replaces, standing, union } from './pitlane.ts'
import { watchedRaces } from './watch.ts'

export type { PitMove }

// The pits of a race on this phone. A team's number is always on the track: a team that comes in
// leaves its kart at the end of a corridor and goes out on the one at the front, so the karts
// change hands all race long, and pitlane.ts works out from the moves which kart is where. Any
// phone of the team may enter. A move has an id of its own and the time it was entered, and an
// undo is kept as the ids of the moves it took back, so the phones and the server only ever add
// to what they have and put it together with what the others have by taking both. A move sent
// twice, late or out of order is still one move, and a move undone on any phone stays undone.
// The corridors of the pit lane are chosen here too, before the first stop, and stay until the pits
// start over: of two phones' choices the later one wins, but never over corridors something stands
// in. What is done here goes to the server when there is a network, and the phone reads from the
// server only what it has not read yet.

// The pit log of a race. undefined until the database has answered, null if it cannot be read.
export function usePitLog(raceId: string): PitLog | null | undefined {
  return useLiveQuery(
    () =>
      db.pits
        .get(raceId)
        .then((log) => log ?? emptyPitLog(raceId))
        .catch(() => null),
    [raceId],
  )
}

function waiting(unsent: PitLog['unsent']): 0 | 1 {
  return unsent.moves.length + unsent.undone.length > 0 || unsent.lanes ? 1 : 0
}

// The ids of a list and more, each once.
function adding(ids: string[], more: string[]): string[] {
  return [...new Set([...ids, ...more])]
}

// Something done here. It joins the end, after every move that stands, and whatever was undone
// before it cannot be done again any more.
export async function recordMove(raceId: string, { lane, kart }: Pick<PitMove, 'lane' | 'kart'>): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = (await db.pits.get(raceId)) ?? emptyPitLog(raceId)
    const move = { id: newId(), lane, kart, at: nextTime(log, Date.now()) }
    await db.pits.put({
      ...log,
      moves: [...log.moves, move],
      redo: [],
      unsent: { ...log.unsent, moves: [...log.unsent.moves, move.id] },
      pending: 1,
    })
  })
}

// Takes back the last move that stands.
export async function undoMove(raceId: string): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = await db.pits.get(raceId)
    const last = log && lastMove(log)
    if (!log || !last) return
    await db.pits.put({
      ...log,
      undone: adding(log.undone, [last.id]),
      redo: [...log.redo, last],
      unsent: { ...log.unsent, undone: adding(log.unsent.undone, [last.id]) },
      pending: 1,
    })
  })
}

// Enters the move undone last again, where it stood. It is a new move: an undo is for ever.
export async function redoMove(raceId: string): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = await db.pits.get(raceId)
    const undone = log?.redo.at(-1)
    if (!log || !undone) return
    const move = { ...undone, id: newId() }
    await db.pits.put({
      ...log,
      moves: [...log.moves, move],
      redo: log.redo.slice(0, -1),
      unsent: { ...log.unsent, moves: [...log.unsent.moves, move.id] },
      pending: 1,
    })
  })
}

// The corridors of the pit lane, chosen before the first stop. Once anything stands in the pits the
// race is on and they stay as they are: only starting the pits over chooses them again. The pits
// start anew with them: nothing undone before is entered again.
export async function chooseLanes(raceId: string, lanes: number): Promise<void> {
  if (!isLanes(lanes)) return
  await db.transaction('rw', db.pits, async () => {
    const log = (await db.pits.get(raceId)) ?? emptyPitLog(raceId)
    if (standing(log).length > 0) return
    await db.pits.put({
      ...log,
      lanes,
      lanesAt: later(log),
      redo: [],
      unsent: { ...log.unsent, lanes: true },
      pending: 1,
    })
  })
}

// «Сбросить пит-стопы»: every move is undone, on every phone, and the corridors are to be chosen again.
export async function resetPits(raceId: string): Promise<void> {
  await db.transaction('rw', db.pits, async () => {
    const log = (await db.pits.get(raceId)) ?? emptyPitLog(raceId)
    const undone = new Set(log.undone)
    const ids = log.moves.filter((move) => !undone.has(move.id)).map((move) => move.id)
    await db.pits.put({
      ...log,
      undone: [...log.undone, ...ids],
      redo: [],
      lanes: null,
      lanesAt: later(log),
      unsent: { moves: log.unsent.moves, undone: adding(log.unsent.undone, ids), lanes: true },
      pending: 1,
    })
  })
}

// When the corridors change here: now, or just after the change this phone knows of if the clock of
// the phone that made it runs ahead, so that this one still wins over it.
function later(log: PitLog): number {
  return Math.max(Date.now(), log.lanesAt + 1)
}

// The same rules as the server's (app/models/pit_log.rb).
const KART = /^\d{1,3}[A-Z]?$/
const ID = /^[A-Za-z0-9-]{1,64}$/

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function isLanes(value: unknown): value is number {
  return isWhole(value) && value >= 1 && value <= CORRIDORS
}

function isMove(value: unknown): value is PitMove {
  if (typeof value !== 'object' || value === null) return false
  const { id, lane, kart, at } = value as Record<string, unknown>
  return (
    isId(id) &&
    isWhole(lane) &&
    lane < CORRIDORS &&
    (kart === null || (typeof kart === 'string' && KART.test(kart))) &&
    isWhole(at)
  )
}

type Lists = { moves: number; undone: number }

function isLists(value: unknown): value is Lists {
  if (typeof value !== 'object' || value === null) return false
  const { moves, undone } = value as Record<string, unknown>
  return isWhole(moves) && isWhole(undone)
}

// What the server has of the pits of a race that this phone had not read: the rest of each of its
// two lists, from where the phone had read it to, or from the start when that is not what the
// server has; how long the lists are there; and its corridors, with when they were chosen.
type Unread = { moves: PitMove[]; undone: string[]; from: Lists; total: Lists; lanes: number | null; lanesAt: number }

// The answer to a read, or null if it is not one.
async function unread(response: Response): Promise<Unread | null> {
  const body: unknown = await response.json().catch(() => null)
  if (typeof body !== 'object' || body === null) return null
  const { moves, undone, from, total, lanes, lanes_at: lanesAt } = body as Record<string, unknown>
  if (!Array.isArray(moves) || !moves.every(isMove) || !Array.isArray(undone) || !undone.every(isId)) return null
  if (!isLists(from) || !isLists(total) || !(lanes === null || isLanes(lanes)) || !isWhole(lanesAt)) return null
  // Each list runs from where it starts to the end of the server's: anything else and what has
  // been read is not known.
  if (from.moves + moves.length !== total.moves || from.undone + undone.length !== total.undone) return null
  return {
    moves: moves.map(({ id, lane, kart, at }) => ({ id, lane, kart, at })),
    undone,
    from: { moves: from.moves, undone: from.undone },
    total: { moves: total.moves, undone: total.undone },
    lanes,
    lanesAt,
  }
}

// What the server has and this phone had not read, put together with what is here.
async function take(raceId: string, there: Unread): Promise<void> {
  const here = (await db.pits.get(raceId)) ?? emptyPitLog(raceId)
  const { moves: all, undone } = union(here, there)
  const unsent = { moves: [...here.unsent.moves], undone: [...here.unsent.undone], lanes: false }
  let dropped = new Set<string>()

  // A list that came whole is all the server has: what is here and not there, it lost or never had,
  // so it goes there again.
  if (there.from.moves === 0) {
    const has = new Set(there.moves.map((move) => move.id))
    const goes = new Set(unsent.moves)
    const lacking = here.moves.filter((move) => !has.has(move.id) && !goes.has(move.id))
    // But not a move of an old log this phone had in step with the server, at the first read: the
    // server lacks it because another phone has taken it back since, the way old logs were changed,
    // by sending the log without it. It goes here too, rather than back there.
    if (here.read.moves === 0) dropped = new Set(lacking.filter(isOld).map((move) => move.id))
    unsent.moves.push(...lacking.filter((move) => !dropped.has(move.id)).map((move) => move.id))
  }
  if (there.from.undone === 0) {
    const has = new Set(there.undone)
    const goes = new Set(unsent.undone)
    unsent.undone.push(...here.undone.filter((id) => !has.has(id) && !goes.has(id)))
  }
  const moves = all.filter((move) => !dropped.has(move.id))

  // The corridors here go there if they take the place of the server's (pitlane.ts): chosen or
  // started over here and not sent yet, or sent and lost there. Else the server's are taken, and
  // corridors chosen here that lost to them are not sent again. What stands there is what stands
  // and is not on its way from here.
  const goes = new Set(unsent.moves)
  const done = new Set(undone)
  const stands = moves.some((move) => !done.has(move.id) && !goes.has(move.id))
  unsent.lanes = replaces({ lanes: here.lanes, at: here.lanesAt }, { lanes: there.lanes, at: there.lanesAt }, stands)
  const lanes = unsent.lanes ? here : there
  // Corridors chosen, or the pits started over, on another phone start the pits anew: what was
  // undone here before is not to be entered again.
  const redo = lanes.lanes === here.lanes && lanes.lanesAt === here.lanesAt ? here.redo : []

  // Read to the end of a list only if it had been read to where this answer starts: another tab of
  // the app may have read further, or less, meanwhile. A move read again changes nothing. The last
  // one read is the last of the answer, or, when it brought nothing new, the one read before.
  const moved = there.from.moves <= here.read.moves
  const undid = there.from.undone <= here.read.undone
  const read = {
    moves: moved ? there.total.moves : here.read.moves,
    undone: undid ? there.total.undone : here.read.undone,
    lastMove: !moved
      ? here.read.lastMove
      : (there.moves.at(-1)?.id ?? (there.total.moves === here.read.moves ? here.read.lastMove : null)),
    lastUndone: !undid
      ? here.read.lastUndone
      : (there.undone.at(-1) ?? (there.total.undone === here.read.undone ? here.read.lastUndone : null)),
  }

  // Both lists and unsent only grow, so a change shows in their lengths.
  const changed =
    dropped.size > 0 ||
    lanes.lanes !== here.lanes ||
    lanes.lanesAt !== here.lanesAt ||
    unsent.lanes !== here.unsent.lanes ||
    redo.length !== here.redo.length ||
    moves.length !== here.moves.length ||
    undone.length !== here.undone.length ||
    unsent.moves.length !== here.unsent.moves.length ||
    unsent.undone.length !== here.unsent.undone.length ||
    read.moves !== here.read.moves ||
    read.undone !== here.read.undone ||
    read.lastMove !== here.read.lastMove ||
    read.lastUndone !== here.read.lastUndone
  if (!changed) return
  await db.pits.put({
    ...here,
    moves,
    undone,
    redo,
    lanes: lanes.lanes,
    lanesAt: lanes.lanesAt,
    unsent,
    read,
    pending: waiting(unsent),
  })
}

// Sends what was done here, then reads what was done on the other phones of the races on screen.
async function exchange(onSignedOut: () => void): Promise<void> {
  for (const log of await db.pits.where('pending').equals(1).toArray()) {
    const sent = { moves: new Set(log.unsent.moves), undone: new Set(log.unsent.undone) }
    const response = await api('PUT', `/races/${log.raceId}/pit_log`, 10_000, {
      pit_log: {
        moves: log.moves.filter((move) => sent.moves.has(move.id)),
        undone: log.unsent.undone,
        // The corridors only when they changed here: the server keeps the later of its own and these.
        ...(log.unsent.lanes && { lanes: log.lanes, lanes_at: log.lanesAt }),
      },
    })
    // No answer, and the rest would get none either. The server may have taken it even so: it goes
    // again, and the same moves taken twice are still the same.
    if (response === null) return
    if (response.status === 401) {
      onSignedOut()
      return
    }
    // Not taken: a race the server does not have yet, or a failure in it. It goes next time, with
    // whatever is done here meanwhile.
    if (!response.ok) continue
    await db.transaction('rw', db.pits, async () => {
      const now = await db.pits.get(log.raceId)
      if (!now) return
      // What was done while it was on its way has yet to go.
      const unsent = {
        moves: now.unsent.moves.filter((id) => !sent.moves.has(id)),
        undone: now.unsent.undone.filter((id) => !sent.undone.has(id)),
        lanes: now.unsent.lanes && !(log.unsent.lanes && now.lanesAt === log.lanesAt),
      }
      await db.pits.update(log.raceId, { unsent, pending: waiting(unsent) })
    })
  }

  for (const raceId of watchedRaces()) {
    const read = (await db.pits.get(raceId))?.read ?? emptyPitLog(raceId).read
    const query = new URLSearchParams({
      moves: String(read.moves),
      moves_last: read.lastMove ?? '',
      undone: String(read.undone),
      undone_last: read.lastUndone ?? '',
    })
    const response = await api('GET', `/races/${raceId}/pit_log?${query}`)
    if (response === null) return
    if (response.status === 401) {
      onSignedOut()
      return
    }
    if (response.status !== 200) continue

    const there = await unread(response)
    if (there) await db.transaction('rw', db.pits, () => take(raceId, there))
  }
}

let running: Promise<void> | null = null
let again = false

// One exchange at a time. Asked for while one is on its way, it runs once more after it. Never
// fails: what was not sent stays pending and goes next time.
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
