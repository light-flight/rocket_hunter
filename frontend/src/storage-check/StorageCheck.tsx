import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { storageCheckDb } from './db.ts'

// Temporary: proves on a real phone that local records survive an app kill and a reboot.
export function StorageCheck() {
  const count = useLiveQuery(() => storageCheckDb.checks.count())
  const [error, setError] = useState<string | null>(null)

  async function addRecord() {
    try {
      await storageCheckDb.checks.add({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      })
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <section className="rounded-2xl bg-white/5 p-4">
      <h2 className="text-sm text-white/60">Проверка хранилища (временно)</h2>
      <p className="mt-2 text-lg">
        Записей на телефоне:{' '}
        <span data-testid="storage-count" className="font-semibold tabular-nums">
          {count ?? '…'}
        </span>
      </p>
      {error && <p className="mt-2 text-red-400">Ошибка записи: {error}</p>}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={addRecord}
          className="flex-1 rounded-xl bg-white px-4 py-3 font-semibold text-black active:opacity-70"
        >
          Записать
        </button>
        <button
          type="button"
          onClick={() => storageCheckDb.checks.clear()}
          className="rounded-xl bg-white/10 px-4 py-3 active:opacity-70"
        >
          Очистить
        </button>
      </div>
    </section>
  )
}
