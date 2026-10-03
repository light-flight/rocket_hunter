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

// The corridors a race can have (app/models/race.rb). All of them are kept whatever the race has
// now: fewer corridors hide the karts of the rest, more bring them back as they were.
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
}

// Two phones that entered the same team into the same corridor this close together entered the
// same stop: a stop takes about a minute, and a team comes in again only a stint later.
export const SAME_STOP_MS = 2 * 60_000

// The moves that stand, in the order they were entered: a corridor hands its karts out in the order
// the teams came. A stop entered on two phones counts once, as the one entered first. Spare karts
// are never taken for one another: several go into a corridor at once before the start.
export function standing(log: Moves): PitMove[] {
  const undone = new Set(log.undone)
  const kept: PitMove[] = []
  const last = new Map<string, PitMove>()
  for (const move of log.moves.filter((move) => !undone.has(move.id)).sort(byTime)) {
    if (move.kart !== null) {
      const stop = `${move.lane} ${move.kart}`
      const before = last.get(stop)
      if (before && move.at - before.at <= SAME_STOP_MS) continue
      last.set(stop, move)
    }
    kept.push(move)
  }
  return kept
}

// What "undo" takes back: the last move that stands, and the same stop entered on another phone.
// null when nothing stands.
export function lastMove(log: Moves): { move: PitMove; ids: string[] } | null {
  const move = standing(log).at(-1)
  if (!move) return null
  const undone = new Set(log.undone)
  const ids = log.moves
    .filter((other) => other.id === move.id || (!undone.has(other.id) && sameStop(other, move)))
    .map((other) => other.id)
  return { move, ids }
}

// How far another phone's clock may run ahead of this one's for a move entered here still to join
// the end. Moves pushed past it stand a millisecond apart, and two of them are never two stops of
// one team: a team comes into a corridor again only a stint later.
export const CLOCKS_APART_MS = 60_000

// The time for a move entered now: after the last move that stands, so a team dropped into a
// corridor joins its end, when another phone's clock runs a little ahead of this one's. A clock far
// ahead is not followed: moves pushed after it would stand a millisecond apart for as long as it is
// ahead, and the same team's next stop would be taken for one stop entered on two phones.
export function nextTime(log: Moves, now: number): number {
  const last = standing(log).at(-1)?.at
  return last !== undefined && last >= now && last - now < CLOCKS_APART_MS ? last + 1 : now
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
// get their place, a little more than SAME_STOP_MS apart, so that two stops of a team in an old log
// are never taken for one stop entered on two phones. The migration that turned the server's old
// logs (db/migrate/20261003120000_keep_pit_moves_with_ids.rb) does the same.
export function fromOldLog(moves: readonly { lane: number; kart: string | null }[], count: number): PitMove[] {
  return moves
    .slice(0, count)
    .map((move, place) => ({ id: oldId(place, move), lane: move.lane, kart: move.kart, at: place * OLD_STEP }))
}

const OLD_STEP = SAME_STOP_MS + 1

function oldId(place: number, move: { lane: number; kart: string | null }): string {
  return `L${place}-${move.lane}-${move.kart ?? 'S'}`
}

// A move kept from an old log, as fromOldLog turned it.
export function isOld(move: PitMove): boolean {
  return move.at % OLD_STEP === 0 && move.id === oldId(move.at / OLD_STEP, move)
}

function sameStop(a: PitMove, b: PitMove): boolean {
  return a.kart !== null && a.lane === b.lane && a.kart === b.kart && Math.abs(a.at - b.at) <= SAME_STOP_MS
}

// By when the moves were entered; by id between two of the same time, so every phone agrees.
function byTime(a: PitMove, b: PitMove): number {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// The pit lane after the moves that stand.
export function replay(moves: readonly PitMove[]): Pitlane {
  const corridors: PitKart[][] = Array.from({ length: CORRIDORS }, () => [])
  const riding = new Map<string, PitKart>()
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
    riding.set(team, queue.shift()!)
  }
  return { corridors, riding }
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
