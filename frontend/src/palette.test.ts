import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PALETTE, paceColour, paceIsLight, type Palette } from './palette.ts'

const [fast, mid, slow] = DEFAULT_PALETTE

test('the default palette mixes as it always has', () => {
  assert.equal(paceColour(0, DEFAULT_PALETTE), `color-mix(in oklch, ${fast}, ${mid} 0.0%)`)
  assert.equal(paceColour(0.25, DEFAULT_PALETTE), `color-mix(in oklch, ${fast}, ${mid} 50.0%)`)
  assert.equal(paceColour(0.5, DEFAULT_PALETTE), `color-mix(in oklch, ${fast}, ${mid} 100.0%)`)
  assert.equal(paceColour(1, DEFAULT_PALETTE), `color-mix(in oklch, ${mid}, ${slow} 100.0%)`)
  assert.equal(paceColour(2, DEFAULT_PALETTE), paceColour(1, DEFAULT_PALETTE))
  assert.equal(paceColour(-1, DEFAULT_PALETTE), paceColour(0, DEFAULT_PALETTE))
})

test('a light pace tile asks for a dark number', () => {
  const traffic: Palette = ['#00c853', '#ffd600', '#ff1744']
  assert.equal(paceIsLight(0, DEFAULT_PALETTE), false)
  assert.equal(paceIsLight(0.5, DEFAULT_PALETTE), false)
  assert.equal(paceIsLight(0, traffic), true)
  assert.equal(paceIsLight(0.5, traffic), true)
  assert.equal(paceIsLight(1, traffic), false)
})
