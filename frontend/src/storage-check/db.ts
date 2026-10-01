import Dexie, { type EntityTable } from 'dexie'

// Temporary: its own database, so the real schema starts clean when this folder is deleted.
export interface StorageCheck {
  id: string
  createdAt: string
}

export const storageCheckDb = new Dexie('rocket-hunter-storage-check', {
  chromeTransactionDurability: 'strict',
}) as Dexie & {
  checks: EntityTable<StorageCheck, 'id'>
}

storageCheckDb.version(1).stores({ checks: 'id' })
