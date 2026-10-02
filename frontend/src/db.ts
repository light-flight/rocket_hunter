import Dexie, { type EntityTable } from 'dexie'

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

export const db = new Dexie('rocket-hunter', { chromeTransactionDurability: 'strict' }) as Dexie & {
  races: EntityTable<Race, 'id'>
}

db.version(1).stores({ races: 'id, createdAt, pending' })
