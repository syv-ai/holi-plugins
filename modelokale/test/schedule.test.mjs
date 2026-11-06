import assert from 'node:assert/strict'
import { test } from 'node:test'
import { busyIntervals, withExactTimes } from '../lib/schedule.mjs'
import { day } from './helpers.mjs'

const ME = { userId: 'me-id', email: 'me@example.test' }
const OSLO = 'Europe/Oslo'

test('folds a booking over several slots into one interval, and knows mine', () => {
  const mine = { id: 'b1', title: 'Meeting', organizer_email: 'ME@example.test', user_id: null }
  const busy = busyIntervals(day('2026-11-05', { '09:00': mine, '09:30': mine }), OSLO, ME)
  assert.deepEqual(busy, [
    {
      start: '2026-11-05T08:00:00.000Z',
      end: '2026-11-05T09:00:00.000Z',
      bookingId: 'b1',
      title: 'Meeting',
      organizer: 'ME@example.test',
      mine: true,
    },
  ])
})

test('keeps two Outlook events back to back apart, and others not mine', () => {
  const a = { title: 'Standup', organizer_email: 'x@other.test' }
  const b = { title: 'Review', organizer_email: 'y@other.test' }
  const busy = busyIntervals(day('2026-11-05', { '10:00': a, '10:30': b }), OSLO, ME)
  assert.equal(busy.length, 2)
  assert.deepEqual(
    busy.map((x) => [x.title, x.mine, x.bookingId]),
    [
      ['Standup', false, null],
      ['Review', false, null],
    ],
  )
})

test('puts my bookings at their exact times', () => {
  const busy = [
    { start: '2026-11-05T12:30:00.000Z', end: '2026-11-05T13:30:00.000Z', bookingId: 'b1' },
    { start: '2026-11-05T14:00:00.000Z', end: '2026-11-05T15:00:00.000Z', bookingId: null },
  ]
  const exact = [{ id: 'b1', start: '2026-11-05T12:30:00.000Z', end: '2026-11-05T13:15:00.000Z' }]
  const out = withExactTimes(busy, exact)
  assert.equal(out[0].end, '2026-11-05T13:15:00.000Z')
  assert.equal(out[1], busy[1])
})
