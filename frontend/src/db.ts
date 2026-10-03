import Dexie, { type EntityTable } from 'dexie'

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

// One thing done in the pits: a kart dropped into a corridor, or an unknown kart (null) put there
// by hand before the race.
export type PitMove = { lane: number; kart: string | null }

// Everything done in the pits of a race, in order. count is how much of it stands: undoing moves
// it back, and the moves after it can be done again until something new is done.
export type PitLog = { raceId: string; moves: PitMove[]; count: number }

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
