import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromLocal, localDay, toLocal } from '../lib/clock.mjs'

const OSLO = 'Europe/Oslo'

test('reads the site clock in winter and in summer', () => {
  assert.equal(fromLocal('2026-11-05T10:00:00', OSLO).toISOString(), '2026-11-05T09:00:00.000Z')
  assert.equal(fromLocal('2026-07-01T11:00', OSLO).toISOString(), '2026-07-01T09:00:00.000Z')
})

test('reads the day the clocks go back by the offset of each hour', () => {
  assert.equal(fromLocal('2026-10-25T01:00:00', OSLO).toISOString(), '2026-10-24T23:00:00.000Z')
  assert.equal(fromLocal('2026-10-25T09:00:00', OSLO).toISOString(), '2026-10-25T08:00:00.000Z')
  assert.equal(fromLocal('2026-03-29T09:00:00', OSLO).toISOString(), '2026-03-29T07:00:00.000Z')
})

test('writes instants on the site clock, and its day', () => {
  assert.equal(toLocal(new Date('2026-11-05T09:15:00Z'), OSLO), '2026-11-05T10:15:00')
  assert.equal(toLocal(new Date('2026-07-01T22:30:00Z'), OSLO), '2026-07-02T00:30:00')
  assert.equal(localDay(new Date('2026-11-05T23:30:00Z'), OSLO), '2026-11-06')
})

test('refuses what is not a local time', () => {
  assert.throws(() => fromLocal('2026-11-05T10:00:00+01:00', OSLO), /not a local time/)
  assert.throws(() => fromLocal('tomorrow', OSLO), /not a local time/)
})
