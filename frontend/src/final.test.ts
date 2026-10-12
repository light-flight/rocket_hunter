import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Final, SOON, clock, countOf, isFinal, progressOf, stopsIn } from './final.ts'
import type { PitMove } from './pitlane.ts'

const SECOND = 1000
const MINUTE = 60_000
const START = Date.UTC(2026, 9, 12, 10)

// 12 pilots, one stop each, 25 minutes, the pit lane closing 5 minutes before the end, lights with
// changes of 40 seconds, started at START.
const FINAL: Final = { pilots: 12, stops: 1, minutes: 25, closes: 5, lights: true, change: 40, start: START }

// Moves written short: '1:5@3' is team 5 into the second corridor, 3 minutes after the start;
// '0:?@-1' a spare into the first, a minute before it. Seconds may follow: '0:5@3.5' is at 3:30.
function moves(...written: string[]): PitMove[] {
  return written.map((move, place) => {
    const [where, minute] = move.split('@')
    const [lane, kart] = where.split(':')
    return { id: `m${place}`, lane: Number(lane), kart: kart === '?' ? null : kart, at: START + Number(minute) * MINUTE }
  })
}

const at = (minutes: number) => START + minutes * MINUTE

test('counts the stops of the teams made from the start to the end, those after the pit lane closed too', () => {
  const stops = stopsIn(FINAL, moves('0:1@-3', '0:?@1', '0:1@2', '1:5@4', '0:1@10', '0:7@22', '0:9@25', '0:9@26'))

  assert.deepEqual([...stops], [
    ['1', 2],
    ['5', 1],
    ['7', 1],
  ])
  assert.deepEqual([...stopsIn({ ...FINAL, start: null }, moves('0:1@2'))], [])
})

test('counts each pilot up to the stops he must make, and no more than all of them must', () => {
  const stops = new Map([
    ['1', 3],
    ['5', 1],
  ])

  assert.deepEqual(countOf(FINAL, stops), { done: 2, needed: 12 })
  assert.deepEqual(countOf({ ...FINAL, stops: 2 }, stops), { done: 3, needed: 24 })
  assert.deepEqual(countOf({ ...FINAL, pilots: 1 }, stops), { done: 1, needed: 1 })
  assert.deepEqual(countOf({ ...FINAL, stops: 0 }, stops), { done: 0, needed: 0 })
})

test('waits for the start, then the window, the closed pit lane and the end', () => {
  assert.deepEqual(progressOf({ ...FINAL, start: null }, [], 1, at(0)), { kind: 'waiting' })
  assert.equal(progressOf(FINAL, [], 1, at(0)).kind, 'open')
  assert.equal(progressOf(FINAL, [], 1, at(19.99)).kind, 'open')
  assert.deepEqual(progressOf(FINAL, moves('0:1@3'), 1, at(20)), { kind: 'closed', done: 1, needed: 12, endsIn: 5 * MINUTE })
  assert.deepEqual(progressOf(FINAL, moves('0:1@3'), 1, at(25)), { kind: 'over', done: 1, needed: 12 })
})

test('with one corridor the stops left go one after another, and the last must start before the pit lane closes', () => {
  // 12 stops of 40 seconds: the corridor is red 8 minutes, the last starts 7:20 from now.
  const early = progressOf(FINAL, [], 1, at(0))
  assert.deepEqual(early, {
    kind: 'open',
    done: 0,
    needed: 12,
    closesIn: 20 * MINUTE,
    left: 12,
    busy: 8 * MINUTE,
    spare: 20 * MINUTE - 7 * MINUTE - 20 * SECOND,
    alarm: 'calm',
  })

  // 13:30 in, 2 changed: the last of the 10 left starts 6 minutes from now, 6:30 left in the window.
  const soon = progressOf(FINAL, moves('0:1@3', '0:5@4'), 1, at(13.5))
  assert.equal(soon.kind === 'open' && soon.spare, 30 * SECOND)
  assert.equal(soon.kind === 'open' && soon.alarm, 'soon')
  // Right at the moment it still starts in time.
  const edge = progressOf(FINAL, moves('0:1@3', '0:5@4'), 1, at(14))
  assert.equal(edge.kind === 'open' && edge.spare, 0)
  assert.equal(edge.kind === 'open' && edge.alarm, 'soon')

  // A minute later the last one waits a minute at least.
  const late = progressOf(FINAL, moves('0:1@3', '0:5@4'), 1, at(15))
  assert.equal(late.kind === 'open' && late.spare, -MINUTE)
  assert.equal(late.kind === 'open' && late.alarm, 'late')
})

test('several corridors change at once', () => {
  // 12 stops in 3 corridors: 4 rounds of 40 seconds, the last starting 2 minutes from now.
  const three = progressOf(FINAL, [], 3, at(17))
  assert.equal(three.kind === 'open' && three.busy, 160 * SECOND)
  assert.equal(three.kind === 'open' && three.spare, MINUTE)
  assert.equal(three.kind === 'open' && three.alarm, 'soon')

  // 13 stops in 2 corridors: 7 rounds, the last starting 4 minutes from now.
  const two = progressOf({ ...FINAL, pilots: 13 }, [], 2, at(10))
  assert.equal(two.kind === 'open' && two.busy, 280 * SECOND)
  assert.equal(two.kind === 'open' && two.spare, 6 * MINUTE)
})

test('a corridor is red till the change entered last in it is over', () => {
  // Team 1 came into the first corridor 10 seconds ago: it is green again in 30.
  const now = at(10) + 10 * SECOND
  const red = progressOf({ ...FINAL, pilots: 2 }, moves('0:1@10'), 1, now)
  assert.equal(red.kind === 'open' && red.left, 1)
  assert.equal(red.kind === 'open' && red.busy, 70 * SECOND)
  assert.equal(red.kind === 'open' && red.spare, closesIn(now) - 30 * SECOND)

  // The other corridor is green: the stop left goes there at once.
  const green = progressOf({ ...FINAL, pilots: 2 }, moves('0:1@10'), 2, now)
  assert.equal(green.kind === 'open' && green.busy, 40 * SECOND)
  assert.equal(green.kind === 'open' && green.spare, closesIn(now))

  // A spare put in by hand and a move into a corridor out of sight keep nothing red.
  const spare = progressOf({ ...FINAL, pilots: 2 }, moves('0:?@10', '2:1@10'), 1, now)
  assert.equal(spare.kind === 'open' && spare.busy, 40 * SECOND)
})

function closesIn(now: number): number {
  return at(20) - now
}

test('with every stop made nothing hurries', () => {
  const all = moves(...Array.from({ length: 12 }, (_, team) => `0:${team + 1}@${team + 1}`))
  const done = progressOf(FINAL, all, 1, at(19.5))

  assert.equal(done.kind === 'open' && done.left, 0)
  assert.equal(done.kind === 'open' && done.busy, 0)
  assert.equal(done.kind === 'open' && done.alarm, 'calm')
})

test('with no lights there is no queue: only the window closing with stops still to make', () => {
  const free = { ...FINAL, lights: false }
  const early = progressOf(free, [], 1, at(15))
  assert.equal(early.kind === 'open' && early.busy, null)
  assert.equal(early.kind === 'open' && early.spare, null)
  assert.equal(early.kind === 'open' && early.alarm, 'calm')

  const soon = progressOf(free, [], 1, at(20) - SOON)
  assert.equal(soon.kind === 'open' && soon.alarm, 'soon')

  const one = progressOf({ ...free, pilots: 1 }, moves('0:1@3'), 1, at(19))
  assert.equal(one.kind === 'open' && one.alarm, 'calm')
})

test('tells a final a phone or the server would keep', () => {
  assert.ok(isFinal(FINAL))
  assert.ok(isFinal({ ...FINAL, start: null, lights: false, stops: 0, closes: 0 }))
  for (const final of [
    { ...FINAL, pilots: 0 },
    { ...FINAL, pilots: 100 },
    { ...FINAL, stops: 1.5 },
    { ...FINAL, closes: 25 },
    { ...FINAL, minutes: '25' },
    { ...FINAL, lights: 1 },
    { ...FINAL, change: 0 },
    { ...FINAL, start: -1 },
    { ...FINAL, start: undefined },
    { ...FINAL, by: 'me' },
    null,
    'final',
  ]) {
    assert.ok(!isFinal(final), JSON.stringify(final))
  }
})

test('shows time as a clock, to the second up', () => {
  assert.equal(clock(6 * MINUTE + 42 * SECOND), '6:42')
  assert.equal(clock(4 * SECOND + 1), '0:05')
  assert.equal(clock(0), '0:00')
  assert.equal(clock(-5 * SECOND), '0:00')
  assert.equal(clock(62 * MINUTE + 3 * SECOND), '1:02:03')
})
