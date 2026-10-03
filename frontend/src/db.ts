import Dexie, { type EntityTable } from 'dexie'
import type { PitMove } from './pitlane.ts'

// What the phone keeps. Writes are flushed to disk before they count as done: a record must
// survive the phone being switched off right after it was entered.

export type Race = {
  id: string
  name: string
  // Corridors in the pit lane, 1 to 3.
  lanes: number
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

// Everything done in the pits of a race, in order. count is how much of it stands: undoing moves
// it back, and the moves after it can be done again until something new is done.
export type PitLog = {
  raceId: string
  moves: PitMove[]
  count: number
  // 1 while a change made on this phone has not reached the server.
  pending: 0 | 1
  // The log as the server last had it, with its version there: the changes made on this phone
  // since are made on top of it, and the server takes them only from that version. null until
  // this phone has had the server's log.
  server: { moves: PitMove[]; count: number; version: number } | null
  // The log sent to the server that has had no answer yet, under the id of that send. The server
  // may have taken it all the same, so it goes again as it was, before anything newer: the
  // server knows its sends by the id and answers whether it took it. null when nothing is on its
  // way.
  sent: { id: string; moves: PitMove[]; count: number } | null
}

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
      .modify((race: Partial<Race>) => {
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
      .modify((log: Partial<PitLog>) => {
        log.pending = log.moves?.length ? 1 : 0
      }),
  )
// Logs kept before the server counted its versions. One with nothing waiting is a log the server
// had (this phone sent it or took it), so a change made on it is merged from it: as version 0 it
// is older than any log the server keeps, so the change is still merged with the server's first.
// Which log a change still waiting here was made on is not known: it is merged with the server's
// from the moves both start with.
db.version(6)
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
      .modify((log: Partial<PitLog>) => {
        log.server = log.pending ? null : { moves: log.moves ?? [], count: log.count ?? 0, version: 0 }
        log.sent = null
      }),
  )
