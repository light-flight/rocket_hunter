import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type Moves,
  type PitMove,
  fromOldLog,
  isOld,
  kartOf,
  lanesOf,
  lastMove,
  nextTime,
  paceOf,
  replay,
  standing,
  teamNumber,
  teams,
  union,
} from './pitlane.ts'

const MINUTE = 60_000

// Moves written short: '1:5' is team 5 into the second corridor, '0:?' a spare into the first.
// 'a=0:5@12' is the move with id a, entered at minute 12. With no id the move is named by its
// place; with no time it was entered at that place in milliseconds, before any minute.
function moves(...written: string[]): PitMove[] {
  return written.map((move, place) => {
    const [named, minute] = move.split('@')
    const [id, where] = named.includes('=') ? named.split('=') : [`m${place}`, named]
    const [lane, kart] = where.split(':')
    return { id, lane: Number(lane), kart: kart === '?' ? null : kart, at: minute ? Number(minute) * MINUTE : place }
  })
}

function log(written: string[], undone: string[] = []): Moves {
  return { moves: moves(...written), undone }
}

// The moves that stand, written short again.
function stand(log: Moves): string[] {
  return standing(log).map((move) => `${move.id}=${move.lane}:${move.kart ?? '?'}`)
}

// Each corridor front first, by kart id.
function corridors(...written: string[]): string[][] {
  return replay(moves(...written)).corridors.map((queue) => queue.map((kart) => kart.id))
}

function rides(written: string[], team: string): string {
  return kartOf(replay(moves(...written)).riding, team).id
}

test('before anyone comes in, every team is on the kart it qualified on', () => {
  const pits = replay(moves('0:?', '0:?'))

  assert.deepEqual(pits.corridors[0].map((kart) => kart.id), ['s0', 's1'])
  assert.equal(kartOf(pits.riding, '7').id, 'q7')
  assert.equal(kartOf(pits.riding, '7').qualifiedBy, '7')
})

test('a team joins the end of the corridor and goes out on the kart at the front', () => {
  const stops = ['0:?', '0:?', '0:1', '0:5', '0:9']

  assert.deepEqual(corridors(...stops)[0], ['q5', 'q9'])
  assert.equal(rides(stops, '1'), 's0')
  assert.equal(rides(stops, '5'), 's1')
  assert.equal(rides(stops, '9'), 'q1')
})

test('a team comes in again on the kart it took the last time', () => {
  const stops = ['0:?', '0:?', '0:1', '0:5', '0:9', '0:1', '0:5', '0:9']
  const pits = replay(moves(...stops))

  assert.deepEqual(
    pits.corridors[0].map((kart) => [kart.id, kart.leftBy]),
    [
      ['s1', '5'],
      ['q1', '9'],
    ],
  )
  assert.equal(rides(stops, '1'), 'q5')
  assert.equal(rides(stops, '5'), 'q9')
  assert.equal(rides(stops, '9'), 's0')
})

test('a team may come into any corridor, again and again', () => {
  const stops = ['0:?', '0:?', '1:?', '1:?', '0:1', '1:1']

  assert.deepEqual(corridors(...stops).slice(0, 2), [
    ['s1', 'q1'],
    ['s3', 's0'],
  ])
  assert.equal(rides(stops, '1'), 's2')
})

test('every team stays on the track, whichever corridor it came through', () => {
  const stops = moves('0:?', '0:?', '1:?', '1:?', '1:1', '0:5', '0:9')

  assert.deepEqual(teams([], stops), ['1', '5', '9'])
  assert.deepEqual(teams(['11', '2', '5', '12A', '12'], stops), ['1', '2', '5', '9', '11', '12', '12A'])
})

test('each stop tells the kart the team went out on', () => {
  const pits = replay(moves('a=0:?', 'b=0:?', 'c=0:1', 'd=0:5', 'e=0:1'))

  assert.deepEqual(
    [...pits.took].map(([id, kart]) => [id, kart.id]),
    [
      ['c', 's0'],
      ['d', 's1'],
      ['e', 'q1'],
    ],
  )
})

test('the corridors are the number chosen, or with none chosen the ones the moves use', () => {
  assert.equal(lanesOf(2, []), 2)
  assert.equal(lanesOf(2, moves('2:5')), 2)
  assert.equal(lanesOf(null, []), null)
  assert.equal(lanesOf(null, moves('0:?', '2:5')), 3)
})

test('in an empty corridor the driver gets back into the same kart', () => {
  const stops = ['0:1']

  assert.deepEqual(corridors(...stops)[0], [])
  assert.equal(rides(stops, '1'), 'q1')
})

test('a spare put in during the race joins the end', () => {
  assert.deepEqual(corridors('0:?', '0:1', '0:?')[0], ['q1', 's1'])
})

test('the karts of a corridor the race no longer has are kept as they were', () => {
  const stops = ['2:?', '2:?', '2:4', '0:4']

  assert.deepEqual(corridors(...stops), [[], [], ['s1', 'q4']])
  assert.equal(rides(stops, '4'), 's0')
})

test('a kart keeps the pace of the team it qualified under, whoever is on it now', () => {
  const pace = new Map([
    ['1', 0],
    ['9', 1],
  ])
  const pits = replay(moves('0:?', '0:?', '0:1', '0:5', '0:9'))

  assert.equal(paceOf(kartOf(pits.riding, '9'), pace), 0)
  assert.equal(paceOf(kartOf(pits.riding, '1'), pace), undefined)
  // Team 5 has no time: the kart it left is as unknown as a spare.
  assert.equal(paceOf(pits.corridors[0][0], pace), undefined)
  assert.equal(paceOf(pits.corridors[0][1], pace), 1)
})

test('the moves that stand are the ones not undone, in the order they were entered', () => {
  const pits = log(['c=0:9@14', 'a=0:1@10', 'b=0:5@12'], ['b'])

  assert.deepEqual(stand(pits), ['a=0:1', 'c=0:9'])
})

test('two moves entered at the same moment stand in the same order on every phone', () => {
  assert.deepEqual(stand(log(['b=0:5@10', 'a=1:9@10'])), ['a=1:9', 'b=0:5'])
  assert.deepEqual(stand(log(['a=1:9@10', 'b=0:5@10'])), ['a=1:9', 'b=0:5'])
})

test('teams entered on two phones apart are all kept, in the order they came in', () => {
  const start = ['s0=0:?@1', 's1=0:?@1']
  const here = log([...start, 'a=0:9@12'])
  const there = log([...start, 'b=0:1@10', 'c=0:5@11'])

  assert.deepEqual(stand(union(here, there)), ['s0=0:?', 's1=0:?', 'b=0:1', 'c=0:5', 'a=0:9'])
  assert.deepEqual(stand(union(there, here)), stand(union(here, there)))
})

test('a stop entered on both phones counts once, as the one entered first', () => {
  const here = log(['a=0:5@10.5', 'c=0:9@11'])
  const there = log(['b=0:5@10'])

  assert.deepEqual(stand(union(here, there)), ['b=0:5', 'c=0:9'])
})

test('a team that comes in again is a stop of its own, whichever phone entered it', () => {
  assert.deepEqual(stand(union(log(['a=0:5@10']), log(['b=0:5@25']))), ['a=0:5', 'b=0:5'])
  // Into the other corridor, it is another stop however soon.
  assert.deepEqual(stand(log(['a=0:5@10', 'b=1:5@10.5'])), ['a=0:5', 'b=1:5'])
})

test('spare karts put in together are all kept', () => {
  assert.deepEqual(stand(log(['a=0:?@1', 'b=0:?@1', 'c=0:?@1'])), ['a=0:?', 'b=0:?', 'c=0:?'])
})

test('a move undone on one phone stays undone, whatever another phone sends after', () => {
  const entered = log(['s0=0:?@1', 'a=0:9@11'])
  const undoneHere = { moves: entered.moves, undone: ['a'] }

  assert.deepEqual(stand(union(undoneHere, entered)), ['s0=0:?'])
  assert.deepEqual(stand(union(entered, undoneHere)), ['s0=0:?'])
  // The same log sent again, as after an answer that was lost, changes nothing.
  assert.deepEqual(union(union(undoneHere, entered), entered), union(undoneHere, entered))
})

test('an undo holds when the other phone has put an earlier stop before it meanwhile', () => {
  // Phone B, offline, entered 3 at minute 10; phone A entered 9 at minute 11, which reached the
  // server first. B's 3 arrives and stands before 9; A, not having read it yet, undoes its 9.
  const start = ['s0=0:?@1', 's1=0:?@1']
  const server = union(log([...start, 'a9=0:9@11']), log([...start, 'b3=0:3@10']))
  const a = { moves: moves(...start, 'a9=0:9@11'), undone: ['a9'] }

  assert.deepEqual(stand(union(a, server)), ['s0=0:?', 's1=0:?', 'b3=0:3'])
  assert.deepEqual(stand(union(server, a)), ['s0=0:?', 's1=0:?', 'b3=0:3'])
})

test('putting logs together gives the same in any order and any number of times', () => {
  const one = log(['a=0:1@10', 'b=0:5@12', 'c=1:9@13'], ['b'])
  const two = log(['a=0:1@10', 'd=0:5@12.5', 'e=1:3@11'], [])
  const three = log(['f=0:?@1', 'g=1:9@13.2'], ['e'])

  const all = stand(union(union(one, two), three))
  assert.deepEqual(stand(union(one, union(two, three))), all)
  assert.deepEqual(stand(union(union(three, one), two)), all)
  assert.deepEqual(stand(union(union(union(one, two), three), two)), all)
  // b and e are undone, and g is c entered again on another phone.
  assert.deepEqual(all, ['f=0:?', 'a=0:1', 'd=0:5', 'c=1:9'])
})

test('undo takes back the last stop, and the same stop entered on another phone', () => {
  const pits = log(['s0=0:?@1', 'a=0:5@10', 'b=0:5@10.5', 'c=1:1@9'])

  assert.deepEqual(lastMove(pits), { move: moves('a=0:5@10')[0], ids: ['a', 'b'] })
  assert.deepEqual(lastMove(log(['s0=0:?@1', 's1=0:?@1'])), { move: moves('s1=0:?@1')[0], ids: ['s1'] })
  assert.equal(lastMove(log(['a=0:5@10'], ['a'])), null)
})

test('a move entered now goes after the last that stands when the other phone’s clock is a little ahead', () => {
  const pits = log(['a=0:5@10', 'b=0:9@30'], ['b'])

  assert.equal(nextTime(pits, 20 * MINUTE), 20 * MINUTE)
  assert.equal(nextTime(pits, 9.5 * MINUTE), 10 * MINUTE + 1)
  assert.equal(nextTime(log([]), 7), 7)
  // A clock a minute or more behind is not followed: its moves stand by its own time.
  assert.equal(nextTime(pits, 9 * MINUTE), 9 * MINUTE)
})

test('a clock far behind the other phone’s never makes two stops of a team one', () => {
  // Phone B, 20 minutes ahead, entered 7 into corridor 0. Phone A then enters 5 into corridor 0
  // twice, a stint apart: both stops stand.
  let pits = log(['b=0:7@40'])
  for (const [id, minute] of [
    ['a1', 21],
    ['a2', 36],
  ] as const) {
    const move = { id, lane: 0, kart: '5', at: nextTime(pits, minute * MINUTE) }
    pits = { moves: [...pits.moves, move], undone: [] }
  }

  assert.deepEqual(stand(pits), ['a1=0:5', 'a2=0:5', 'b=0:7'])
})

test('an old log turns into the same moves on the phone and on the server, before any new one', () => {
  const old = [
    { lane: 0, kart: null },
    { lane: 0, kart: '5' },
    { lane: 1, kart: '12A' },
  ]
  const turned = fromOldLog(old, 2)

  assert.deepEqual(turned, [
    { id: 'L0-0-S', lane: 0, kart: null, at: 0 },
    { id: 'L1-0-5', lane: 0, kart: '5', at: 120_001 },
  ])
  assert.deepEqual(fromOldLog(old, 3)[2], { id: 'L2-1-12A', lane: 1, kart: '12A', at: 240_002 })
  assert.ok(turned.every(isOld))
  assert.ok(!isOld({ id: 'L1-0-5', lane: 0, kart: '5', at: 1 }))
  const later = { moves: [{ id: 'n', lane: 0, kart: '9', at: Date.UTC(2026, 9, 3) }], undone: [] }
  assert.deepEqual(stand(union(later, { moves: turned, undone: [] })), ['L0-0-S=0:?', 'L1-0-5=0:5', 'n=0:9'])
})

test('every stop of an old log stands, a team coming into the same corridor again too', () => {
  const old = ['?', '1', '5', '1', '5', '1'].map((kart) => ({ lane: 0, kart: kart === '?' ? null : kart }))

  assert.equal(standing({ moves: fromOldLog(old, old.length), undone: [] }).length, 6)
})

test('a number typed by hand is read the way the protocols are', () => {
  assert.equal(teamNumber(' 07 '), '7')
  assert.equal(teamNumber('№ 7'), '7')
  assert.equal(teamNumber('#007'), '7')
  assert.equal(teamNumber('0'), '0')
  assert.equal(teamNumber('12а'), '12A')
  assert.equal(teamNumber('１２Ａ'), '12A')
  assert.equal(teamNumber('1234'), null)
  assert.equal(teamNumber('12AB'), null)
  assert.equal(teamNumber('пять'), null)
  assert.equal(teamNumber(''), null)
})
