import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.ts'
import { db, type Race } from './db.ts'
import { newId } from './id.ts'
import { syncFiles } from './qualification.ts'

export type { Race }

// Races are made on the phone and sent to the server when there is a network. The phone
// picks the id, so sending a race again never makes a second one. The server's list is the
// team's: races made on other phones arrive here, races removed on the server leave.

// The same rules as the server's (app/models/race.rb), so that a race made here is never refused.
export const NAME_LIMIT = 100
export const LANES = [1, 2, 3] as const

export function lanesLabel(lanes: number): string {
  return lanes === 1 ? '1 коридор' : `${lanes} коридора`
}

export function cleanName(name: string): string {
  return name.replace(/[\s\p{Cc}]+/gu, ' ').trim()
}

// All races on this phone, newest first. undefined until the database has answered, null if
// it cannot be read.
export function useRaces(): Race[] | null | undefined {
  return useLiveQuery(() =>
    db.races
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .catch(() => null),
  )
}

export async function createRace(name: string, lanes: number): Promise<string> {
  const race: Race = { id: newId(), name: cleanName(name), lanes, createdAt: Date.now(), pending: 1 }
  await db.races.add(race)
  return race.id
}

export async function updateRace(id: string, name: string, lanes: number): Promise<void> {
  await db.races.update(id, { name: cleanName(name), lanes, pending: 1 })
}

type ServerRace = { id: string; name: string; lanes: number; created_at: string }

function isServerRace(value: unknown): value is ServerRace {
  const race = value as Partial<ServerRace> | null
  return (
    typeof race?.id === 'string' &&
    typeof race.name === 'string' &&
    typeof race.lanes === 'number' &&
    typeof race.created_at === 'string'
  )
}

// Sends what changed on this phone, then takes the team's list.
async function exchange(onSignedOut: () => void): Promise<void> {
  for (const race of await db.races.where('pending').equals(1).toArray()) {
    const response = await api('PUT', `/races/${race.id}`, 10_000, {
      race: { name: race.name, lanes: race.lanes, created_at: new Date(race.createdAt).toISOString() },
    })
    // No network: the rest would fail the same way.
    if (response === null) return
    if (response.status === 401) return onSignedOut()

    if (response.ok) {
      await db.transaction('rw', db.races, async () => {
        // Changed again while on its way: the new version has yet to go.
        const now = await db.races.get(race.id)
        if (now?.name === race.name && now.lanes === race.lanes) await db.races.update(race.id, { pending: 0 })
      })
    }
  }

  const response = await api('GET', '/races')
  if (response?.status === 401) return onSignedOut()
  if (response?.status !== 200) return

  const body: { races?: unknown } | null = await response.json().catch(() => null)
  if (!Array.isArray(body?.races) || !body.races.every(isServerRace)) return
  const team = body.races

  await db.transaction('rw', [db.races, db.files, db.uploads, db.rankings, db.pits], async () => {
    const here = new Map((await db.races.toArray()).map((race) => [race.id, race]))
    const there = new Set(team.map((race) => race.id))

    await db.races.bulkPut(
      team
        // A change made here and not sent yet wins over what the server has.
        .filter((race) => here.get(race.id)?.pending !== 1)
        .map((race) => ({
          id: race.id,
          name: race.name,
          lanes: race.lanes,
          createdAt: Date.parse(race.created_at),
          pending: 0 as const,
        })),
    )
    // Removed on the server, with its files. A race that has never reached it is not among them.
    const removed = [...here.values()].filter((race) => race.pending === 0 && !there.has(race.id)).map((race) => race.id)
    await db.races.bulkDelete(removed)
    const files = await db.files.where('raceId').anyOf(removed).primaryKeys()
    await db.files.bulkDelete(files)
    await db.uploads.bulkDelete(files)
    await db.rankings.bulkDelete(removed)
    await db.pits.bulkDelete(removed)
  })
}

// How often a change that has not reached the server is sent again while the app is on screen:
// in the pits the network can come back without the phone ever noticing it was gone.
const RETRY_MS = 30_000

let running: Promise<void> | null = null
let again = false

// One exchange at a time. Asked for while one is on its way, it runs once more after it.
// Never fails: what was not sent stays pending and goes next time.
function syncRaces(onSignedOut: () => void): Promise<void> {
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
      // The files go after the races they belong to, on their own: they may take a while.
      void syncFiles(onSignedOut)
    } catch {
      // The database or the network failed halfway: the next exchange starts over.
    } finally {
      running = null
    }
  })()
  return running
}

// Keeps this phone and the server in step: at launch, when the network comes back, when the
// app returns to the screen, after signing in again, after every change made here (call sync),
// and every half a minute while a change is still waiting. synced turns true once the first
// exchange has finished, whether or not the server answered. A 401 is checked by onSignedOut:
// an answer to a request sent before signing in again says nothing about the new session.
export function useRaceSync(onSignedOut: () => void, expired: boolean) {
  const [synced, setSynced] = useState(false)
  const sync = useCallback(() => syncRaces(onSignedOut), [onSignedOut])
  const wasExpired = useRef(expired)

  useEffect(() => {
    if (wasExpired.current && !expired) sync()
    wasExpired.current = expired
  }, [expired, sync])

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const races = await db.races.where('pending').equals(1).count().catch(() => 0)
      const files = await db.files.where('pending').equals(1).count().catch(() => 0)
      if (races + files > 0) sync()
    }, RETRY_MS)
    return () => clearInterval(timer)
  }, [sync])

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const onVisible = () => {
      clearTimeout(timer)
      // Not at once: on iOS a request fired right at this event can hang.
      if (document.visibilityState === 'visible') timer = window.setTimeout(sync, 500)
    }

    sync().then(() => {
      if (active) setSynced(true)
    })
    window.addEventListener('online', sync)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      clearTimeout(timer)
      window.removeEventListener('online', sync)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sync])

  return { sync, synced }
}
