import Dexie, { type EntityTable } from 'dexie'
import { type PitMove, fromOldLog } from './pitlane.ts'

// What the phone keeps. Writes are flushed to disk before they count as done: a record must
// survive the phone being switched off right after it was entered.

export type Race = {
  id: string
  name: string
  // When the race was made, on whichever phone made it: milliseconds since the epoch.
  createdAt: number
  // 1 while a change made on this phone has not reached the server. A number, because
  // IndexedDB cannot index booleans.
  pending: 0 | 1
}

// A qualification protocol of a race: a PDF, a photo or a screenshot. Its bytes wait in
// uploads until the server has them; what the model read comes back as laps.
export type QualificationFile = {
  id: string
  raceId: string
  name: string
  // When it was picked on this phone, or on whichever phone picked it.
  addedAt: number
  // local: on this phone only. The rest are the server's: waiting and reading for the model,
  // read, or failed with a reason in error.
  status: 'local' | 'waiting' | 'reading' | 'read' | 'failed'
  // Each kart's best laps in this file, in milliseconds.
  laps: Record<string, number[]>
  warnings: string[]
  error: string | null
  // 1 once the server has it. A file the phone refused itself never gets there.
  sent: 0 | 1
  // 1 while the server has yet to hear of it: to be sent or, when deleted, to be deleted.
  pending: 0 | 1
  deleted: 0 | 1
}

// The bytes of a file the server does not have yet, kept apart so that lists never load them.
export type Upload = {
  id: string
  type: string
  data: ArrayBuffer
  // 1 once a photo has been made small enough to send.
  prepared: 0 | 1
}

// A kart of the qualification as the server ranks it: its best laps averaged across the
// protocols, how many there were, and its pace from 0 (the fastest) to 1 (the slowest) by time.
export type Kart = { kart: string; average: number; laps: number; pace: number }

// The karts of a race, fastest first, as the server last sent them.
export type Ranking = { raceId: string; karts: Kart[] }

// One thing done in the pits: a team that came into a corridor, or a spare kart (pitlane.ts).
export type { PitMove }

// Everything done in the pits of a race, as this phone knows it: every move entered on any phone,
// and the ids of the moves undone (pitlane.ts).
export type PitLog = {
  raceId: string
  moves: PitMove[]
  undone: string[]
  // The moves undone on this phone, the last undone last: «Повторить» enters the last one again.
  redo: PitMove[]
  // The corridors of the pit lane, 1 to 3, chosen on the pit screen; null until they are. lanesAt is
  // when they were chosen, by the clock of the phone that chose them: of two choices the later wins.
  // 0 for the corridors a race had before they were chosen in the pits.
  lanes: number | null
  lanesAt: number
  // What was done here that the server has not confirmed yet: the ids of the moves and of the moves
  // undone, and whether the corridors have yet to go.
  unsent: { moves: string[]; undone: string[]; lanes: boolean }
  // How much of the server's two lists this phone has read, and the id of the last one of each it
  // read: it asks for the rest only, and the server can tell it is still the list this phone read.
  read: { moves: number; undone: number; lastMove: string | null; lastUndone: string | null }
  // 1 while anything is unsent. A number, because IndexedDB cannot index booleans.
  pending: 0 | 1
}

// The pits of a race where nothing has been done yet, and no corridors chosen.
export function emptyPitLog(raceId: string): PitLog {
  return {
    raceId,
    moves: [],
    undone: [],
    redo: [],
    lanes: null,
    lanesAt: 0,
    unsent: { moves: [], undone: [], lanes: false },
    read: { moves: 0, undone: 0, lastMove: null, lastUndone: null },
    pending: 0,
  }
}

// A race as it was kept while it had the corridors of its pit lane.
type OldRace = Race & { lanes?: number }

// A pit log as it was kept before moves had ids: the moves in order, and how many of them stood.
type OldPitLog = { raceId: string; moves: { lane: number; kart: string | null }[]; count: number; pending: 0 | 1 }

export const db = new Dexie('rocket-hunter', { chromeTransactionDurability: 'strict' }) as Dexie & {
  races: EntityTable<Race, 'id'>
  files: EntityTable<QualificationFile, 'id'>
  uploads: EntityTable<Upload, 'id'>
  rankings: EntityTable<Ranking, 'raceId'>
  pits: EntityTable<PitLog, 'raceId'>
}

db.version(1).stores({ races: 'id, createdAt, pending' })
// Races made before corridors existed have one.
db.version(2)
  .stores({ races: 'id, createdAt, pending' })
  .upgrade((tx) =>
    tx
      .table('races')
      .toCollection()
      .modify((race: OldRace) => {
        race.lanes ??= 1
      }),
  )
db.version(3).stores({ races: 'id, createdAt, pending', files: 'id, raceId, pending', uploads: 'id' })
db.version(4).stores({
  races: 'id, createdAt, pending',
  files: 'id, raceId, pending',
  uploads: 'id',
  rankings: 'raceId',
  pits: 'raceId',
})
// Logs kept before the server took them go to it.
db.version(5)
  .stores({
    races: 'id, createdAt, pending',
    files: 'id, raceId, pending',
    uploads: 'id',
    rankings: 'raceId',
    pits: 'raceId, pending',
  })
  .upgrade((tx) =>
    tx
      .table('pits')
      .toCollection()
      .modify((log: Partial<OldPitLog>) => {
        log.pending = log.moves?.length ? 1 : 0
      }),
  )
// Logs kept before moves had ids. The moves that stood get the ids and times the server gives the
// same old log, so the two put together do not double. A log the server had is in step with it
// already. One with changes waiting sends them: its moves, and the moves it had undone and could
// still do again, as undone, for the server may still have them standing. A move it undid and
// then entered something else in place of is gone from it, so the server's copy stays and is
// undone again by hand (README, «Выкладка»).
// The corridors move from the race to its pits. A race the server had gets the same from the
// server's migration, chosen at time 0 there and here. A race made or changed here and not sent
// yet never takes them there any more, so its pits send them, as chosen just after that: they
// count, unless stops stand there already in the corridors the server has (replaces, pitlane.ts).
db.version(6)
  .stores({
    races: 'id, createdAt, pending',
    files: 'id, raceId, pending',
    uploads: 'id',
    rankings: 'raceId',
    pits: 'raceId, pending',
  })
  .upgrade(async (tx) => {
    const pits = tx.table('pits')
    await pits.toCollection().modify((old: OldPitLog, ref: { value: PitLog }) => {
      const moves = fromOldLog(old.moves, old.count)
      // The moves undone after them, which could still be done again.
      const undone = fromOldLog(old.moves, old.moves.length).slice(old.count)
      const waiting = (list: PitMove[]) => (old.pending ? list.map((move) => move.id) : [])
      const unsent = { moves: waiting(moves), undone: waiting(undone), lanes: false }
      ref.value = {
        ...emptyPitLog(old.raceId),
        moves,
        undone: unsent.undone,
        redo: undone.reverse(),
        unsent,
        pending: unsent.moves.length + unsent.undone.length > 0 ? 1 : 0,
      }
    })

    const races = tx.table('races')
    for (const race of (await races.toArray()) as OldRace[]) {
      if (race.lanes === undefined) continue
      const log: PitLog = (await pits.get(race.id)) ?? emptyPitLog(race.id)
      const sent = race.pending === 0
      await pits.put({
        ...log,
        lanes: race.lanes,
        lanesAt: sent ? 0 : 1,
        unsent: { ...log.unsent, lanes: !sent },
        pending: sent ? log.pending : 1,
      })
    }
    await races.toCollection().modify((race: OldRace) => {
      delete race.lanes
    })
  })
