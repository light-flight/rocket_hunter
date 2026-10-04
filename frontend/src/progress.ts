// How far the files of a race on their way have got, for the bar over its karts. A file goes two
// legs: to the server, measured by the bytes as they go, and through the model, which says nothing
// until it is done, so that leg goes by the clock, against how long the model took lately. Kept
// while the app is open, apart from how long the model took.

// The share of the bar the way to the server takes; the model has the rest.
export const SENDING = 0.25

// What the bar needs of a protocol (QualificationFile in db.ts, which the unit tests leave out).
export type Protocol = { id: string; status: 'local' | 'waiting' | 'reading' | 'read' | 'failed' }

// How far one file has got on each leg, from 0 to 1.
type Legs = { sent: number; read: number }

export type Progress = {
  // How far the files of the bar have got on each leg, from 0 to 1, and on the whole way.
  sent: number
  read: number
  whole: number
  files: number
  // Of them, still on the phone, and with the model.
  local: number
  reading: number
  // Every file of the bar is done.
  done: boolean
}

// A guess never goes past this: only the server says a file is done.
const GUESS_CAP = 0.95
// A guess is at four fifths of the way at the time it expects.
const AT_EXPECTED = Math.log(5)
// How fast the bytes go before the phone has said: a slow network at a race track.
const BYTES_PER_MS = 150
const SETTING_OFF_MS = 1000
// How long the model takes over a protocol until the phone has timed it: half a minute to a minute.
const READ_MS = 40_000
const READS_KEY = 'rocket-hunter.read-ms'
// The model's last times this phone keeps, and the bounds a time is held to.
const READS = 5
const READ_MIN_MS = 5000
const READ_MAX_MS = 3 * 60_000

// Each upload going now: when it started, its size, and the part of it gone, once the phone says.
const uploads = new Map<string, { since: number; bytes: number; part: number | null }>()
// When the model got each file, by this phone's clock. timed: this phone saw it get there, so how
// long it takes tells how long the next one will.
const reads = new Map<string, { since: number; timed: boolean }>()
// How long the model took over the files this phone timed, the last last.
let took = storedTimes()
// The bar of each race: how far each of its files has been shown to get, so that it never goes
// back while it is up. done once all of them were done.
const bars = new Map<string, { legs: Map<string, Legs>; done: boolean }>()

export function uploadStarted(id: string, bytes: number, now = Date.now()) {
  uploads.set(id, { since: now, bytes, part: null })
}

export function uploadProgress(id: string, part: number) {
  const upload = uploads.get(id)
  if (upload) upload.part = Math.min(1, Math.max(upload.part ?? 0, part))
}

export function uploadEnded(id: string) {
  uploads.delete(id)
}

// The model has the file from now: sent from this phone, or read again at its asking.
export function readStarted(id: string, now = Date.now()) {
  reads.set(id, { since: now, timed: true })
}

// Notes where the files are: a file with the model is timed from when the phone first saw it there,
// and one it timed from the start teaches how long the next will take.
export function filesSeen(files: Protocol[], now = Date.now()) {
  for (const file of files) {
    const read = reads.get(file.id)
    if (file.status === 'waiting' || file.status === 'reading') {
      if (!read) reads.set(file.id, { since: now, timed: false })
    } else if (read) {
      if (file.status === 'read' && read.timed) remember(now - read.since)
      reads.delete(file.id)
    }
  }
}

function busy(file: Protocol): boolean {
  return file.status === 'local' || file.status === 'waiting' || file.status === 'reading'
}

// The bar of a race now, or null when it has none: a bar is up from the moment a file is on its
// way until it is put away once everything is done. A file added or read again after that starts
// a new bar.
export function progress(raceId: string, files: Protocol[], now = Date.now()): Progress | null {
  filesSeen(files, now)
  const going = files.filter(busy)
  let bar = bars.get(raceId)
  if (!bar || (bar.done && going.length > 0)) {
    if (going.length === 0) return null
    bar = { legs: new Map(), done: false }
    bars.set(raceId, bar)
  }

  const here = new Map(files.map((file) => [file.id, file]))
  for (const id of bar.legs.keys()) if (!here.has(id)) bar.legs.delete(id)
  for (const file of going) if (!bar.legs.has(file.id)) bar.legs.set(file.id, { sent: 0, read: 0 })
  // Every file of the bar taken out.
  if (bar.legs.size === 0) {
    bars.delete(raceId)
    return null
  }

  for (const [id, shown] of bar.legs) {
    const file = here.get(id)!
    const next = legs(file, now)
    // A file read again goes through the model once more.
    const again = busy(file) && shown.read === 1
    bar.legs.set(id, again ? next : { sent: Math.max(shown.sent, next.sent), read: Math.max(shown.read, next.read) })
  }
  bar.done = going.length === 0

  const all = [...bar.legs.values()]
  const sent = all.reduce((sum, leg) => sum + leg.sent, 0) / all.length
  const read = all.reduce((sum, leg) => sum + leg.read, 0) / all.length
  const local = going.filter((file) => file.status === 'local').length
  return {
    sent,
    read,
    whole: SENDING * sent + (1 - SENDING) * read,
    files: all.length,
    local,
    reading: going.length - local,
    done: bar.done,
  }
}

// Puts away the bar of a race once its end has been shown.
export function dismiss(raceId: string) {
  if (bars.get(raceId)?.done) bars.delete(raceId)
}

function legs(file: Protocol, now: number): Legs {
  if (file.status === 'local') {
    const upload = uploads.get(file.id)
    if (!upload) return { sent: 0, read: 0 }
    return { sent: upload.part ?? guess(now - upload.since, SETTING_OFF_MS + upload.bytes / BYTES_PER_MS), read: 0 }
  }
  if (busy(file)) {
    const read = reads.get(file.id)
    return { sent: 1, read: read ? guess(now - read.since, expectedRead()) : 0 }
  }
  return { sent: 1, read: 1 }
}

// How far a leg nobody reports on has got: quickly at first, then slower and slower, and never
// all the way.
function guess(elapsed: number, expected: number): number {
  return GUESS_CAP * (1 - Math.exp((-AT_EXPECTED * Math.max(0, elapsed)) / expected))
}

// The middle of the model's last times.
export function expectedRead(): number {
  if (took.length === 0) return READ_MS
  const sorted = [...took].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function remember(ms: number) {
  took = [...took, Math.min(READ_MAX_MS, Math.max(READ_MIN_MS, ms))].slice(-READS)
  try {
    localStorage.setItem(READS_KEY, JSON.stringify(took))
  } catch {
    // Without storage the times last until the app is closed.
  }
}

function storedTimes(): number[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(READS_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((ms) => Number.isFinite(ms)).slice(-READS) : []
  } catch {
    // Storage is unavailable, or holds something else.
    return []
  }
}
