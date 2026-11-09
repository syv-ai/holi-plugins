import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Refusal } from '../lib/booking.mjs'
import { bookingTime, dayOf, lengthOf, startOf } from '../lib/when.mjs'

// Monday 9 November 2026, 12:53 at the office.
const clock = { now: Date.parse('2026-11-09T12:53:20+01:00'), timeZone: 'Europe/Copenhagen' }
const iso = ({ start, end }) => [start.toISOString(), end.toISOString()]
const refused = (fn, pattern) =>
  assert.throws(
    fn,
    (e) => e instanceof Refusal && e.code === 'BAD_REQUEST' && pattern.test(e.message),
  )

test('a day is today unless named: a date, tomorrow, or the next weekday, today included', () => {
  assert.equal(dayOf(undefined, clock), '2026-11-09')
  assert.equal(dayOf('today', clock), '2026-11-09')
  assert.equal(dayOf('tomorrow', clock), '2026-11-10')
  assert.equal(dayOf('mon', clock), '2026-11-09')
  assert.equal(dayOf('Thu', clock), '2026-11-12')
  assert.equal(dayOf('friday', clock), '2026-11-13')
  assert.equal(dayOf('sun', clock), '2026-11-15')
  assert.equal(dayOf('2026-12-01', clock), '2026-12-01')
  for (const on of ['th', 'next week', 'fridays', '12/1']) refused(() => dayOf(on, clock), /--on/)
})

test('a length is minutes or hours, 30 minutes when left out', () => {
  assert.equal(lengthOf(undefined), 30 * 60_000)
  assert.equal(lengthOf('15m'), 15 * 60_000)
  assert.equal(lengthOf('15min'), 15 * 60_000)
  assert.equal(lengthOf('45'), 45 * 60_000)
  assert.equal(lengthOf('1h'), 60 * 60_000)
  assert.equal(lengthOf('1h30m'), 90 * 60_000)
  for (const length of ['0', '0m', '1.5h', 'half an hour', '-5', ''])
    refused(() => lengthOf(length), /--for/)
})

test('a booking is a start on the office clock and a length after it', () => {
  assert.deepEqual(iso(bookingTime({ at: '13:00' }, clock)), [
    '2026-11-09T12:00:00.000Z',
    '2026-11-09T12:30:00.000Z',
  ])
  assert.deepEqual(iso(bookingTime({ at: '13.30', length: '15m' }, clock)), [
    '2026-11-09T12:30:00.000Z',
    '2026-11-09T12:45:00.000Z',
  ])
  assert.deepEqual(iso(bookingTime({ at: '9', length: '1h', on: 'tomorrow' }, clock)), [
    '2026-11-10T08:00:00.000Z',
    '2026-11-10T09:00:00.000Z',
  ])
  // Summer time at the office, whatever this machine's zone.
  assert.deepEqual(iso(bookingTime({ at: '13:00', on: '2027-06-01' }, clock)), [
    '2027-06-01T11:00:00.000Z',
    '2027-06-01T11:30:00.000Z',
  ])
  assert.deepEqual(iso(bookingTime({ at: 'now', length: '15m' }, clock)), [
    '2026-11-09T11:53:00.000Z',
    '2026-11-09T12:08:00.000Z',
  ])
  for (const at of ['25:00', '13:5', '1pm', '', undefined])
    refused(() => bookingTime({ at }, clock), /--at/)
  refused(() => bookingTime({ at: 'now', on: 'fri' }, clock), /--on/)
})

test('a time today that has passed is refused, never moved to another day', () => {
  assert.throws(
    () => bookingTime({ at: '09:00' }, clock),
    (e) =>
      e instanceof Refusal &&
      /09:00 has passed today/.test(e.message) &&
      /--on tomorrow/.test(e.next),
  )
  // A meeting that began a few minutes ago can still be booked.
  assert.equal(bookingTime({ at: '12:45' }, clock).start.toISOString(), '2026-11-09T11:45:00.000Z')
  // To cancel, any time today will do.
  assert.equal(startOf({ at: '09:00' }, clock).toISOString(), '2026-11-09T08:00:00.000Z')
})
