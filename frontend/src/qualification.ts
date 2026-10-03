import { useLiveQuery } from 'dexie-react-hooks'
import { api, upload } from './api.ts'
import { db, type Kart, type QualificationFile, type Upload } from './db.ts'
import { newId } from './id.ts'

export type { Kart, QualificationFile }

// Qualification protocols. A file picked on the phone is kept there with its bytes, even
// without a network, and goes to the server when there is one. The server has the model read
// it; what it read comes back as each kart's best laps, and the phone averages them.

// The same limit as the server's (app/models/qualification_file.rb), for what is sent.
const SIZE_LIMIT = 20 * 1024 * 1024
// A photo is made small before it is sent: this only keeps the phone's storage sane.
const PHOTO_LIMIT = 100 * 1024 * 1024
// What the model reads. HEIC is not among them: iOS turns it into JPEG for this list.
export const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'
const READABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
// The model sees no more of a photo than this, so the rest is not worth sending.
const LONG_SIDE = 2576
const PIXELS = 3_750_000

// The files of a race, oldest first. undefined until the database has answered, null if it
// cannot be read.
export function useFiles(raceId: string): QualificationFile[] | null | undefined {
  return useLiveQuery(
    () =>
      db.files
        .where('raceId')
        .equals(raceId)
        .toArray()
        .then((files) => files.filter((file) => file.deleted === 0).sort((a, b) => a.addedAt - b.addedAt))
        .catch(() => null),
    [raceId],
  )
}

// Keeps the files as they were picked. The bytes are read at once: iOS may close the page while
// the camera is open, and what was not stored by then is gone.
export async function addFiles(raceId: string, picked: File[]): Promise<void> {
  const now = Date.now()
  const read = await Promise.all(
    picked.map(async (file) => ({ file, data: await file.arrayBuffer().catch(() => null) })),
  )

  await db.transaction('rw', db.files, db.uploads, async () => {
    for (const [index, { file, data }] of read.entries()) {
      const id = newId()
      const photo = shrinks(file.type)
      const refused =
        data === null
          ? 'Не удалось прочитать файл на телефоне'
          : file.size > (photo ? PHOTO_LIMIT : SIZE_LIMIT)
            ? `Файл больше ${photo ? 100 : 20} МБ`
            : !READABLE.includes(file.type)
              ? 'Не PDF и не фото'
              : null

      await db.files.add({
        id,
        raceId,
        name: label(file, now + index),
        addedAt: now + index,
        status: refused ? 'failed' : 'local',
        laps: {},
        warnings: [],
        error: refused,
        sent: 0,
        pending: refused ? 0 : 1,
        deleted: 0,
      })
      if (!refused && data) await db.uploads.add({ id, type: file.type, data, prepared: 0 })
    }
  })
}

// Every photo the camera takes in the picker is "image.jpg": those get the time they were taken.
function label(file: File, at: number): string {
  if (file.name && !/^image\.(jpe?g|png|heic|heif|webp)$/i.test(file.name)) return file.name

  const time = new Date(at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${file.type.startsWith('image/') ? 'Фото' : 'Файл'} ${time}`
}

function shrinks(type: string): boolean {
  return type.startsWith('image/') && type !== 'image/gif'
}

// Hidden at once, and gone from the server with the next exchange. Even a file that has not
// reached it is asked about: it may be on its way right now.
export async function deleteFile(file: QualificationFile): Promise<void> {
  await db.files.update(file.id, { deleted: 1, pending: 1 })
}

// Has the server read the file again. Needs a network: false when there is none.
export async function rereadFile(file: QualificationFile, onSignedOut: () => void): Promise<boolean> {
  const response = await api('POST', `/races/${file.raceId}/qualification_files/${file.id}/read`)
  if (response?.status === 401) onSignedOut()
  if (!response?.ok) return false

  const server = await serverFile(response)
  if (server) {
    await db.transaction('rw', db.files, async () => {
      // Taken out while the request was on its way: that wins.
      if ((await db.files.get(file.id))?.deleted === 0) await db.files.put(fromServer(file.raceId, server))
    })
  }
  return server !== null
}

// The karts of a race, fastest first, as the server ranked them last. undefined until the
// database has answered.
export function useKarts(raceId: string): Kart[] | undefined {
  return useLiveQuery(
    () =>
      db.rankings
        .get(raceId)
        .then((ranking) => ranking?.karts ?? [])
        .catch(() => []),
    [raceId],
  )
}

function isKart(value: unknown): value is Kart {
  const kart = value as Partial<Kart> | null
  return (
    typeof kart?.kart === 'string' &&
    typeof kart.average === 'number' &&
    typeof kart.laps === 'number' &&
    typeof kart.pace === 'number'
  )
}

// 40947 -> "40.947", 62345 -> "1:02.345".
export function formatLap(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const seconds = ((ms % 60_000) / 1000).toFixed(3)
  return minutes > 0 ? `${minutes}:${seconds.padStart(6, '0')}` : seconds
}

// 214 -> "+0.214".
export function formatGap(ms: number): string {
  return `+${(ms / 1000).toFixed(3)}`
}

type ServerFile = {
  id: string
  name: string
  status: 'waiting' | 'reading' | 'read' | 'failed'
  laps: Record<string, number[]>
  warnings: string[]
  error: string | null
  added_at: string
}

function isServerFile(value: unknown): value is ServerFile {
  const file = value as Partial<ServerFile> | null
  return (
    typeof file?.id === 'string' &&
    typeof file.name === 'string' &&
    ['waiting', 'reading', 'read', 'failed'].includes(file.status ?? '') &&
    typeof file.laps === 'object' &&
    file.laps !== null &&
    Object.values(file.laps).every((times) => Array.isArray(times) && times.every(Number.isFinite)) &&
    Array.isArray(file.warnings) &&
    file.warnings.every((warning) => typeof warning === 'string') &&
    (file.error === null || typeof file.error === 'string') &&
    typeof file.added_at === 'string'
  )
}

async function serverFile(response: Response): Promise<ServerFile | null> {
  const body: unknown = await response.json().catch(() => null)
  return isServerFile(body) ? body : null
}

function fromServer(raceId: string, file: ServerFile): QualificationFile {
  return {
    id: file.id,
    raceId,
    name: file.name,
    addedAt: Date.parse(file.added_at),
    status: file.status,
    laps: file.laps,
    warnings: file.warnings,
    error: file.error,
    sent: 1,
    pending: 0,
    deleted: 0,
  }
}

// Races whose files the phone keeps up to date: the one open and the newest. A manager who
// opened neither while there was a network has the others' files once there is one again.
let watched: string[] = []

export function watchRaces(ids: string[]) {
  watched = [...new Set(ids)]
}

// Sends what changed here, then takes the server's lists of the watched races.
async function exchange(onSignedOut: () => void): Promise<void> {
  // Deletions first: cheap, and a file deleted here must not be sent after all.
  for (const file of await db.files.where('pending').equals(1).toArray()) {
    if (file.deleted === 0) continue
    const response = await api('DELETE', `/races/${file.raceId}/qualification_files/${file.id}`)
    if (response === null) return
    if (response.status === 401) return onSignedOut()
    if (response.ok || response.status === 404) await forget(file.id)
  }

  const sentTo = new Set<string>()
  const waiting = (await db.files.where('pending').equals(1).toArray())
    .filter((file) => file.deleted === 0 && file.status === 'local')
    // A file that keeps timing out goes after the others rather than holding them back.
    .sort((a, b) => (timeouts.get(a.id) ?? 0) - (timeouts.get(b.id) ?? 0) || a.addedAt - b.addedAt)

  for (const file of waiting) {
    // A race the server does not have yet would only refuse it after the whole upload.
    if ((await db.races.get(file.raceId))?.pending !== 0) continue

    const bytes = await prepared(file.id)
    if (!bytes || bytes.data.byteLength > SIZE_LIMIT) {
      await refuse(file.id, bytes ? 'Файл больше 20 МБ' : 'Файл потерялся на телефоне')
      continue
    }

    const form = new FormData()
    form.append('file', new Blob([bytes.data], { type: bytes.type }), file.name)
    form.append('name', file.name)
    form.append('added_at', new Date(file.addedAt).toISOString())
    const response = await upload(`/races/${file.raceId}/qualification_files/${file.id}`, form)
    // No network, or too slow for this file: the lists below still come.
    if (response === null) {
      timeouts.set(file.id, (timeouts.get(file.id) ?? 0) + 1)
      break
    }
    timeouts.delete(file.id)
    if (response.status === 401) return onSignedOut()
    // The race is gone from the server: the list of races will take it away.
    if (response.status === 404) continue

    const server = response.ok ? await serverFile(response) : null
    if (!server) {
      // Only a server that says no for good loses the file; anything else (a restart, a proxy
      // page, an overload) is tried again next time, and the PUT is the same file again.
      if ([400, 413, 415, 422].includes(response.status)) await refuse(file.id, refusal(response.status))
      else break
      continue
    }

    await db.transaction('rw', db.files, db.uploads, async () => {
      const now = await db.files.get(file.id)
      if (!now) return
      // Taken out while on its way: the deletion goes next.
      await db.files.put({ ...fromServer(file.raceId, server), pending: now.deleted, deleted: now.deleted })
      await db.uploads.delete(file.id)
    })
    sentTo.add(file.raceId)
  }

  for (const raceId of new Set([...watched, ...sentTo])) {
    const response = await api('GET', `/races/${raceId}/qualification_files`)
    if (response?.status === 401) return onSignedOut()
    if (response?.status !== 200) continue

    const body: { files?: unknown; karts?: unknown } | null = await response.json().catch(() => null)
    if (!Array.isArray(body?.files) || !body.files.every(isServerFile)) continue
    if (!Array.isArray(body.karts) || !body.karts.every(isKart)) continue
    const files = body.files
    const karts = body.karts

    await db.transaction('rw', db.files, db.uploads, db.rankings, async () => {
      await db.rankings.put({ raceId, karts })
      const here = new Map((await db.files.where('raceId').equals(raceId).toArray()).map((file) => [file.id, file]))
      const there = new Set(files.map((file) => file.id))
      // A change made here and not sent yet wins over what the server has.
      await db.files.bulkPut(
        files.filter((file) => here.get(file.id)?.pending !== 1).map((file) => fromServer(raceId, file)),
      )
      // Deleted on another phone. A file that has never reached the server is not among them.
      const gone = [...here.values()]
        .filter((file) => file.sent === 1 && file.pending === 0 && !there.has(file.id))
        .map((file) => file.id)
      await db.files.bulkDelete(gone)
      await db.uploads.bulkDelete(gone)
    })
  }
}

// Refused for good: saying why is all that is left to do. A deletion made meanwhile still goes.
async function refuse(id: string, reason: string) {
  await db.transaction('rw', db.files, db.uploads, async () => {
    const now = await db.files.get(id)
    if (!now) return
    await db.files.update(id, { status: 'failed', error: reason, sent: 0, pending: now.deleted })
    await db.uploads.delete(id)
  })
}

function refusal(status: number): string {
  if (status === 413) return 'Файл больше 20 МБ'
  if (status === 415) return 'Не PDF и не фото'
  return 'Сервер не принял файл'
}

async function forget(id: string) {
  await db.transaction('rw', db.files, db.uploads, async () => {
    await db.files.delete(id)
    await db.uploads.delete(id)
  })
}

// The bytes to send: a photo is made small once, and the smaller copy replaces it.
async function prepared(id: string): Promise<Upload | undefined> {
  const stored = await db.uploads.get(id)
  if (!stored || stored.prepared === 1) return stored

  const next: Upload = { ...stored, ...(await shrink(stored)), prepared: 1 }
  await db.uploads.put(next)
  return next
}

async function shrink(photo: Upload): Promise<Pick<Upload, 'data' | 'type'>> {
  if (!shrinks(photo.type)) return photo

  try {
    const bitmap = await createImageBitmap(new Blob([photo.data], { type: photo.type }), {
      imageOrientation: 'from-image',
    })
    const { width, height } = bitmap
    const scale = Math.min(1, LONG_SIDE / Math.max(width, height), Math.sqrt(PIXELS / (width * height)))
    const small = photo.data.byteLength <= 1_500_000 && ['image/jpeg', 'image/png'].includes(photo.type)
    if (scale === 1 && small) {
      bitmap.close()
      return photo
    }

    // Drawn straight at the target size: iOS refuses canvases much larger than this.
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    canvas.width = 0
    canvas.height = 0
    return blob ? { data: await blob.arrayBuffer(), type: 'image/jpeg' } : photo
  } catch {
    // The phone cannot open it (HEIC outside Safari): the server says what it thinks of it.
    return photo
  }
}

// How many times in a row each upload ran out of time, while the app is open.
const timeouts = new Map<string, number>()

let running: Promise<void> | null = null
let again = false

// One exchange at a time, apart from the races': a file can take a minute to go, and races
// must not wait for it. Never fails: what was not sent stays pending and goes next time.
export function syncFiles(onSignedOut: () => void): Promise<void> {
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
