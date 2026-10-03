import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Moves, type PitMove, kartOf, merge, paceOf, replay, standing, teamNumber, teams } from './pitlane.ts'

// Moves written short: '1:5' is team 5 into the second corridor, '0:?' a spare into the first.
// '0:5@12' was entered at minute 12; a move with no @ has no time, as in a log from before.
function moves(...written: string[]): PitMove[] {
  return written.map((move) => {
    const [where, minute] = move.split('@')
    const [lane, kart] = where.split(':')
    return { lane: Number(lane), kart: kart === '?' ? null : kart, ...(minute && { at: Number(minute) * 60_000 }) }
  })
}

function log(...written: string[]): Moves {
  const all = moves(...written)
  return { moves: all, count: all.length }
}

// A log written short again, to write a longer one after it.
function written(log: Moves): string[] {
  return log.moves.map(({ lane, kart, at }) => `${lane}:${kart ?? '?'}${at === undefined ? '' : `@${at / 60_000}`}`)
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

test('only the moves that stand count', () => {
  assert.deepEqual(standing({ moves: moves('0:?', '0:1'), count: 1 }), moves('0:?'))
})

test('what only one side changed is taken as it is, with the moves it can do again', () => {
  const base = log('0:?', '0:1')
  const changed = { moves: moves('0:?', '0:1', '0:5', '0:9'), count: 3 }

  assert.equal(merge(base, changed, base), changed)
  assert.equal(merge(base, base, changed), changed)
})

test('the same log on both sides needs nothing more', () => {
  const there = log('0:?@0', '0:1@5')

  assert.equal(merge(log('0:?@0'), log('0:?@0', '0:1@5'), there), there)
  assert.equal(merge(null, log('0:?@0', '0:1@5'), there), there)
})

test('teams entered on two phones apart are all kept, in the order they came in', () => {
  const base = log('0:?@0', '0:?@0')
  const merged = merge(base, log('0:?@0', '0:?@0', '0:5@14'), log('0:?@0', '0:?@0', '0:1@10', '0:9@20'))

  assert.deepEqual(merged, log('0:?@0', '0:?@0', '0:1@10', '0:5@14', '0:9@20'))
  // So the corridor hands its karts out as it really did: 1 took the first spare, 5 the second.
  assert.deepEqual(corridors(...written(merged))[0], ['q5', 'q9'])
  assert.equal(rides(written(merged), '1'), 's0')
  assert.equal(rides(written(merged), '5'), 's1')
})

test('a stop entered on both phones counts once', () => {
  const base = log('0:?@0', '0:?@0')
  const there = log('0:?@0', '0:?@0', '0:1@10', '0:5@11')

  assert.equal(merge(base, log('0:?@0', '0:?@0', '0:1@10.5'), there), there)
  assert.deepEqual(
    merge(base, log('0:?@0', '0:?@0', '0:5@11.5', '0:7@12'), there),
    log('0:?@0', '0:?@0', '0:1@10', '0:5@11', '0:7@12'),
  )
})

test('a team that comes in again is a stop of its own, whichever phone entered it', () => {
  // This phone entered team 7 at 10:00 with no network; the other one entered 12, then 7 again.
  const base = log('0:?@0', '0:?@0', '0:7@1', '0:3@2')
  const here = log('0:?@0', '0:?@0', '0:7@1', '0:3@2', '0:7@10')
  const there = log('0:?@0', '0:?@0', '0:7@1', '0:3@2', '0:12@15', '0:7@20')

  assert.deepEqual(merge(base, here, there), log('0:?@0', '0:?@0', '0:7@1', '0:3@2', '0:7@10', '0:12@15', '0:7@20'))
  // One phone handed the entering over to the other, which had no network: 5 came in on both.
  const before = log('0:?@0', '0:?@0', '0:1@1', '0:5@2', '0:9@3')
  assert.deepEqual(
    merge(before, log(...written(before), '0:7@30', '0:5@35'), log(...written(before), '0:5@20', '0:12@22')),
    log(...written(before), '0:5@20', '0:12@22', '0:7@30', '0:5@35'),
  )
})

test('a move undone here stays undone, and what the others did after it stays', () => {
  const base = log('0:?', '0:?', '0:1')

  assert.deepEqual(merge(base, log('0:?', '0:?'), log('0:?', '0:?', '0:1', '0:5')), log('0:?', '0:?', '0:5'))
  assert.deepEqual(
    merge(base, log('0:?', '0:?', '1:1'), log('0:?', '0:?', '0:1', '0:5')),
    log('0:?', '0:?', '1:1', '0:5'),
  )
})

test('a move undone on another phone stays undone, and what was done here after it stays', () => {
  const base = log('0:?', '0:?', '0:1')

  assert.deepEqual(merge(base, log('0:?', '0:?', '0:1', '0:5'), log('0:?', '0:?', '1:1')), log('0:?', '0:?', '1:1', '0:5'))
})

test('a phone that has never had the server’s log adds what the server does not have', () => {
  assert.deepEqual(merge(null, log('0:?', '0:?', '0:1', '0:5'), log('0:?', '0:?', '0:1', '0:9')), log('0:?', '0:?', '0:1', '0:9', '0:5'))
  assert.deepEqual(merge(null, log('0:?'), log()), log('0:?'))
  // Whatever the server has had of the same team in the same corridor before.
  const there = log('0:?@0', '0:?@0', '0:5@10', '0:9@40')
  assert.deepEqual(merge(null, log('0:5@30'), there), log('0:?@0', '0:?@0', '0:5@10', '0:5@30', '0:9@40'))
  assert.equal(merge(null, log('0:9@39'), there), there)
})

test('moves with no time are never taken for one another', () => {
  assert.deepEqual(merge(null, log('0:7'), log('0:?', '0:?', '0:7', '0:3')), log('0:?', '0:?', '0:7', '0:3', '0:7'))
  assert.deepEqual(
    merge(log('0:?', '0:?'), log('0:?', '0:?', '0:1'), log('0:?', '0:?', '0:1')),
    log('0:?', '0:?', '0:1', '0:1'),
  )
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
