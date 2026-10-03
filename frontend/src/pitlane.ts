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
// by hand before the race.
export type PitMove = { lane: number; kart: string | null }

// Moves in order, and how many of them stand: the ones after count were undone.
export type Moves = { moves: PitMove[]; count: number }

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

export function standing(log: Moves): PitMove[] {
  return log.moves.slice(0, log.count)
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

// Two phones changed the pits apart, starting from the same log (base, null if this phone has
// never had the server's): this phone (here) and the rest of the team (there, as the server has
// it now). Each side may have undone moves of the base and done new ones after. The side that
// undid more of the base goes first: what it undid stays undone, whoever kept it. The other
// side's new moves follow its new moves. A new move both sides made (two managers entered the
// same team into the same corridor) counts once. Nothing new is lost.
export function merge(base: Moves | null, here: Moves, there: Moves): Moves {
  const old = base ? standing(base) : []
  const mine = standing(here)
  const theirs = standing(there)
  const keptHere = sharedStart(mine, old)
  const keptThere = sharedStart(theirs, old)

  const [first, firstKept, second, secondKept] =
    keptHere < keptThere ? [mine, keptHere, theirs, keptThere] : [theirs, keptThere, mine, keptHere]
  const firstNew = first.slice(firstKept)
  const merged = [...old.slice(0, firstKept), ...firstNew, ...without(second.slice(secondKept), firstNew)]

  if (alike(merged, theirs)) return there
  if (alike(merged, mine)) return here
  return { moves: merged, count: merged.length }
}

function same(a: PitMove, b: PitMove): boolean {
  return a.lane === b.lane && a.kart === b.kart
}

function alike(a: readonly PitMove[], b: readonly PitMove[]): boolean {
  return a.length === b.length && sharedStart(a, b) === a.length
}

function sharedStart(a: readonly PitMove[], b: readonly PitMove[]): number {
  let i = 0
  while (i < a.length && i < b.length && same(a[i], b[i])) i++
  return i
}

// The moves not among others, each of the others matching one move at most.
function without(moves: readonly PitMove[], others: readonly PitMove[]): PitMove[] {
  const left = [...others]
  return moves.filter((move) => {
    const at = left.findIndex((other) => same(other, move))
    if (at < 0) return true
    left.splice(at, 1)
    return false
  })
}
