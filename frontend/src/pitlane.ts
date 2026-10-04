// The pit lane by the regulation. Every team has a number, a sticker, and the number is always
// on the track: only the karts under it change. Before the start each number stands on a kart of
// its own, the one the team qualified on, so the qualification tells that kart's pace. The
// corridors hold spare karts with no number, of a pace nobody knows. A team that comes in joins
// the end of a corridor, its driver gets into the kart at the front, and the number is moved onto
// it: the front kart goes out under the number, the kart the team came on stays at the end with
// none. So the karts change hands all race long, and a number can be on a kart of any pace, or of
// none known. Nothing here touches the phone's database: it is the same on every phone and in
// the tests (npm test).

// One thing done in the pits: a team that came into a corridor, or a spare kart (null) put there
// by hand before the race. id is the move's own, the same on every phone and on the server: the
// phone that entered it gives it. at is when it was entered, by the clock of that phone, in
// milliseconds since the epoch; a move kept from before the moves had times has its place in the
// old log instead, spaced out (see fromOldLog), so it stays ahead of every move entered since.
export type PitMove = { id: string; lane: number; kart: string | null; at: number }

// Everything done in the pits of a race: every move entered on any phone, and the ids of the moves
// undone. Both only ever grow, so two phones, or a phone and the server, put theirs together by
// taking everything in both (union): in any order, as often as they like, the result is the same,
// and a move once undone stays undone. Nothing is ever taken out, so nothing comes back.
export type Moves = { moves: PitMove[]; undone: string[] }

// The corridors a pit lane can have (PitLog::LANES in app/models/pit_log.rb). All of them are
// replayed whatever the pits show: a move into a corridor they do not have (sent by a phone without
// a network after another started the pits over with fewer) keeps its karts there, hidden, not lost.
export const CORRIDORS = 3

// A physical kart.
export type PitKart = {
  // The same all race long: 'q7' is the kart team 7 qualified on, 's2' the third spare put in.
  id: string
  // The team whose qualification time is this kart's. null for a spare: its pace is unknown.
  qualifiedBy: string | null
  // The last team that left it in a corridor. null for a spare nobody has taken out yet.
  leftBy: string | null
}

export type Pitlane = {
  // What stands in each corridor, front (the exit) first.
  corridors: PitKart[][]
  // The kart each team that has come in is on the track with now. Any other team is still on
  // the kart it qualified on.
  riding: Map<string, PitKart>
  // The kart a team went out on at each of its stops, by the id of the move.
  took: Map<string, PitKart>
}

// The moves that stand, in the order they were entered: a corridor hands its karts out in the order
// the teams came, first in, first out. Every move that is not undone stands: a team may come into the
// same corridor again and again, as often and as soon as it likes, and each time the number goes onto
// the kart at the front. A stop entered twice by mistake is taken back with «Отменить».
export function standing(log: Moves): PitMove[] {
  const undone = new Set(log.undone)
  return log.moves.filter((move) => !undone.has(move.id)).sort(byTime)
}

// What "undo" takes back: the last move that stands. null when nothing stands.
export function lastMove(log: Moves): PitMove | null {
  return standing(log).at(-1) ?? null
}

// The time for a move entered now: now, but never before the last move that stands, so a move
// entered always goes last, whatever the clock does.
export function nextTime(log: Moves, now: number): number {
  const last = standing(log).at(-1)?.at
  return last !== undefined && last >= now ? last + 1 : now
}

// Two logs put together: every move and every undo of both, each once.
export function union(a: Moves, b: Moves): Moves {
  const known = new Set(a.moves.map((move) => move.id))
  const moves = [...a.moves]
  for (const move of b.moves) {
    if (known.has(move.id)) continue
    known.add(move.id)
    moves.push(move)
  }
  return { moves, undone: [...new Set([...a.undone, ...b.undone])] }
}

// The moves of a log kept before moves had ids and times: the ones that stood, in order. Their
// ids come from their place and what they are, so the phone and the server, each turning the same
// old log, give the same moves; a move only one of them had gets an id of its own. For a time they
// get their place, OLD_STEP apart, so they stand in their order, before every move entered since.
// The migration that turned the server's old logs (db/migrate/20261003120000_keep_pit_moves_with_ids.rb)
// does the same, with the same step: the ids and isOld depend on it.
export function fromOldLog(moves: readonly { lane: number; kart: string | null }[], count: number): PitMove[] {
  return moves
    .slice(0, count)
    .map((move, place) => ({ id: oldId(place, move), lane: move.lane, kart: move.kart, at: place * OLD_STEP }))
}

const OLD_STEP = 120_001

function oldId(place: number, move: { lane: number; kart: string | null }): string {
  return `L${place}-${move.lane}-${move.kart ?? 'S'}`
}

// A move kept from an old log, as fromOldLog turned it.
export function isOld(move: PitMove): boolean {
  return move.at % OLD_STEP === 0 && move.id === oldId(move.at / OLD_STEP, move)
}

// Real times of entry are decades after the places old logs give for one.
const TIMED_FROM = Date.UTC(2020, 0)

// A move with no real time of entry: one kept from an old log, or one «Вернуть» entered again from
// it, under an id of its own but at its place in the old log.
export function untimed(move: PitMove): boolean {
  return move.at < TIMED_FROM
}

// By when the moves were entered; by id between two of the same time, so every phone agrees.
function byTime(a: PitMove, b: PitMove): number {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// The pit lane after the moves that stand.
export function replay(moves: readonly PitMove[]): Pitlane {
  const corridors: PitKart[][] = Array.from({ length: CORRIDORS }, () => [])
  const riding = new Map<string, PitKart>()
  const took = new Map<string, PitKart>()
  let spares = 0

  for (const move of moves) {
    const queue = corridors[move.lane]
    // The server takes no other corridors.
    if (!queue) continue
    if (move.kart === null) {
      queue.push({ id: `s${spares++}`, qualifiedBy: null, leftBy: null })
      continue
    }
    const team = move.kart
    queue.push({ ...kartOf(riding, team), leftBy: team })
    // The driver gets into the front kart. In an empty corridor that is the kart the team came on.
    const out = queue.shift()!
    riding.set(team, out)
    took.set(move.id, out)
  }
  return { corridors, riding, took }
}

// How many corridors the pits of a race have: the number chosen on the pit screen. None chosen yet
// while nothing stands, and the screen asks for it. Moves standing with none chosen (another phone
// started the pits over while this one entered) keep every corridor they use.
export function lanesOf(chosen: number | null, moves: readonly PitMove[]): number | null {
  if (chosen !== null) return chosen
  return moves.length > 0 ? Math.max(...moves.map((move) => move.lane)) + 1 : null
}

// The corridors as a phone or the server keeps them: how many, null when they are to be chosen
// (before the first stop, or after the pits were started over), and when that was, by the clock of
// the phone that chose them or started the pits over.
export type LaneChoice = { lanes: number | null; at: number }

// Whether the corridors chosen on a phone take the place of the ones the server, or another phone,
// has. The later do, but never over corridors something stands in: once the race is on its
// corridors stay, and only starting the pits over changes them. So a phone that chose before it had
// read the pits does not take the corridors away from the stops entered in them. What stands is
// counted without the stops entered on the choosing phone and not sent yet: those were entered in
// the corridors it chose. The server does the same (PitLog#take_lanes).
export function replaces(chosen: LaneChoice, there: LaneChoice, standsThere: boolean): boolean {
  return chosen.at > there.at && (chosen.lanes === null || there.lanes === null || !standsThere)
}

// The kart a team is on the track with.
export function kartOf(riding: ReadonlyMap<string, PitKart>, team: string): PitKart {
  return riding.get(team) ?? { id: `q${team}`, qualifiedBy: team, leftBy: null }
}

// A kart's pace from 0 (the fastest) to 1 (the slowest), from the qualification time of the team
// it stood under before the start. undefined when nobody knows it: a spare, or the kart of a team
// with no time in the protocols.
export function paceOf(kart: PitKart, pace: ReadonlyMap<string, number>): number | undefined {
  return kart.qualifiedBy === null ? undefined : pace.get(kart.qualifiedBy)
}

// The teams of the race: every number of the qualification and every number that has come in.
export function teams(qualified: Iterable<string>, moves: readonly PitMove[]): string[] {
  const all = new Set(qualified)
  for (const move of moves) if (move.kart !== null) all.add(move.kart)
  return [...all].sort(byNumber)
}

// Kart numbers in the order people count them: 2 before 10, 12 before 12A.
export function byNumber(a: string, b: string): number {
  return a.localeCompare(b, 'ru', { numeric: true })
}

// A team number as typed, the way the server reads the protocols (Protocol.kart in
// app/models/protocol.rb): "07", "№7" and "#07" are "7", a Cyrillic letter that looks Latin
// becomes Latin: "12а" is "12A". null for anything that is not a number of up to three digits
// with a letter or none.
export function teamNumber(text: string): string | null {
  const team = text
    // № first: normalizing would make it "No".
    .replace(/[\s№#]/g, '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[АВЕКМНОРСТХ]/g, (letter) => 'ABEKMHOPCTX'['АВЕКМНОРСТХ'.indexOf(letter)])
    .replace(/^0+(?=\d)/, '')
  return /^\d{1,3}[A-Z]?$/.test(team) ? team : null
}
