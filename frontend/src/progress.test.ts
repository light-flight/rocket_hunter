import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dismiss,
  expectedRead,
  filesSeen,
  type Protocol,
  progress,
  readStarted,
  SENDING,
  uploadEnded,
  uploadProgress,
  uploadStarted,
} from './progress.ts'

const SECOND = 1000

// A protocol where it is on its way: 'local', 'waiting', 'reading', 'read' or 'failed'.
function file(id: string, status: Protocol['status']): Protocol {
  return { id, status }
}

test('a race with nothing on its way has no bar', () => {
  assert.equal(progress('none', [file('n1', 'read'), file('n2', 'failed')], 0), null)
})

test('the way to the server is the first quarter of the bar, measured by the bytes', () => {
  const at = progress('a', [file('a1', 'local')], 0)
  assert.deepEqual(at, { sent: 0, read: 0, whole: 0, files: 1, local: 1, reading: 0, done: false })

  uploadStarted('a1', 100_000, 0)
  uploadProgress('a1', 0.5)
  const half = progress('a', [file('a1', 'local')], 100)
  assert.equal(half?.sent, 0.5)
  assert.equal(half?.whole, SENDING / 2)
  uploadEnded('a1')
})

test('before the phone says how much has gone, the bytes are guessed, and never all of them', () => {
  uploadStarted('b1', 150_000, 0)
  const early = progress('b', [file('b1', 'local')], 500)!
  const late = progress('b', [file('b1', 'local')], 60 * SECOND)!
  assert.ok(early.sent > 0 && early.sent < late.sent)
  assert.ok(late.sent < 1)
  uploadEnded('b1')
})

test('the model is timed from when it got the file, and is never done before the server says', () => {
  readStarted('c1', 0)
  const start = progress('c', [file('c1', 'waiting')], 0)!
  assert.equal(start.sent, 1)
  assert.equal(start.read, 0)
  assert.equal(start.whole, SENDING)

  // Four fifths of the guess at the time a read is expected to take.
  const expected = progress('c', [file('c1', 'reading')], expectedRead())!
  assert.ok(Math.abs(expected.read - 0.95 * 0.8) < 1e-9)

  const long = progress('c', [file('c1', 'reading')], 60 * 60 * SECOND)!
  assert.ok(long.read < 1 && !long.done)

  const read = progress('c', [file('c1', 'read')], 60 * 60 * SECOND)!
  assert.equal(read.whole, 1)
  assert.equal(read.done, true)
})

test('the bar never goes back: an upload that starts over keeps its part', () => {
  uploadStarted('d1', 1_000_000, 0)
  uploadProgress('d1', 0.6)
  assert.equal(progress('d', [file('d1', 'local')], 100)?.sent, 0.6)
  // It ran out of time and goes again from the first byte.
  uploadEnded('d1')
  uploadStarted('d1', 1_000_000, 200)
  uploadProgress('d1', 0.1)
  assert.equal(progress('d', [file('d1', 'local')], 300)?.sent, 0.6)
  uploadEnded('d1')
})

test('a file done keeps its share while the others go, and the bar is full once all are done', () => {
  const both = [file('e1', 'waiting'), file('e2', 'local')]
  readStarted('e1', 0)
  assert.equal(progress('e', both, 0)?.files, 2)

  const one = progress('e', [file('e1', 'read'), file('e2', 'waiting')], 10 * SECOND)!
  assert.equal(one.sent, 1)
  assert.ok(one.read >= 0.5)
  assert.deepEqual([one.local, one.reading, one.done], [0, 1, false])

  const all = progress('e', [file('e1', 'read'), file('e2', 'read')], 20 * SECOND)!
  assert.deepEqual([all.whole, all.files, all.done], [1, 2, true])

  // Shown full, then put away.
  dismiss('e')
  assert.equal(progress('e', [file('e1', 'read'), file('e2', 'read')], 21 * SECOND), null)
})

test('a file added once the bar is done starts a new bar', () => {
  progress('f', [file('f1', 'waiting')], 0)
  assert.equal(progress('f', [file('f1', 'read')], SECOND)?.done, true)

  const next = progress('f', [file('f1', 'read'), file('f2', 'local')], 2 * SECOND)!
  assert.deepEqual([next.files, next.whole, next.done], [1, 0, false])
})

test('a file read again goes through the model once more', () => {
  progress('g', [file('g1', 'waiting'), file('g2', 'waiting')], 0)
  progress('g', [file('g1', 'read'), file('g2', 'waiting')], SECOND)
  readStarted('g1', 2 * SECOND)
  const again = progress('g', [file('g1', 'waiting'), file('g2', 'waiting')], 2 * SECOND)!
  assert.ok(again.read < 0.5)
})

test('a file taken out leaves the bar, and the bar goes with the last one', () => {
  progress('h', [file('h1', 'local'), file('h2', 'read'), file('h3', 'local')], 0)
  assert.equal(progress('h', [file('h1', 'local'), file('h2', 'read')], SECOND)?.files, 1)
  assert.equal(progress('h', [file('h2', 'read')], 2 * SECOND), null)
})

// Last: what it learns stays for the tests after it.
test('how long the model took over the files sent from here tells how long the next will take', () => {
  for (const [index, ms] of [12, 10, 14].entries()) {
    const id = `t${index}`
    readStarted(id, 0)
    filesSeen([{ id, status: 'read' }], ms * SECOND)
  }
  assert.equal(expectedRead(), 12 * SECOND)

  // One sent from another phone was first seen halfway: its time says nothing.
  filesSeen([{ id: 'u1', status: 'reading' }], 0)
  filesSeen([{ id: 'u1', status: 'read' }], 2 * SECOND)
  assert.equal(expectedRead(), 12 * SECOND)
})
