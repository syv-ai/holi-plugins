import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BookingError } from '../lib/api.mjs'
import { createBooking, resolveRoom } from '../lib/booking.mjs'
import { ROOMS, SITE, day, tempStore, tokens } from './helpers.mjs'

const NOW = Date.parse('2026-11-05T07:00:00Z') // 08:00 in Copenhagen

async function setup(over = {}) {
  const made = []
  const cancelled = []
  const session = tokens()
  const api = {
    rooms: async () => ROOMS,
    schedule: async (_s, roomId, d) => over.schedule?.(roomId, d) ?? day(d),
    myBookings: async () => over.exact ?? [],
    createBooking: async (_s, b) => void made.push(b),
    cancelBooking: async (_s, id) => void cancelled.push(id),
    ...over.api,
  }
  const auth = {
    current: async () => ({ email: session.email, userId: session.userId }),
    pending: async () => null,
    session: async () => session,
    ...over.auth,
  }
  const booking = createBooking({ site: SITE, api, auth, store: await tempStore(), now: () => NOW })
  return { booking, made, cancelled }
}

test('finds a room by number, name, mailbox or id', () => {
  assert.equal(resolveRoom(ROOMS, '4').name, 'Garage 4 – (MuteBox)')
  assert.equal(resolveRoom(ROOMS, 'garage 5').id, 'room-5')
  assert.equal(resolveRoom(ROOMS, 'garage1@EXAMPLE.test').id, 'room-1')
  assert.equal(resolveRoom(ROOMS, 'room-2').id, 'room-2')
  assert.throws(() => resolveRoom(ROOMS, 'kitchen'), { code: 'NOT_FOUND' })
  assert.throws(() => resolveRoom(ROOMS, 'garage'), {
    code: 'BAD_REQUEST',
    message: /more than one/,
  })
})

test('books a free slot, titled Meeting', async () => {
  const { booking, made } = await setup()
  const b = await booking.book({
    room: '2',
    start: '2026-11-05T10:00:00+01:00',
    end: '2026-11-05T10:45:00+01:00',
  })
  assert.equal(b.roomName, 'Garage2')
  assert.equal(made[0].title, 'Meeting')
  assert.equal(made[0].end.toISOString(), '2026-11-05T09:45:00.000Z')
})

test('refuses a taken slot with what to do next', async () => {
  const taken = { id: 'x', title: 'Theirs', organizer_email: 'x@other.test' }
  const { booking, made } = await setup({
    schedule: (roomId, d) => (roomId === 'room-2' ? day(d, { '10:30': taken }) : day(d)),
  })
  await assert.rejects(
    booking.book({
      room: '2',
      start: '2026-11-05T10:00:00+01:00',
      end: '2026-11-05T11:00:00+01:00',
    }),
    { code: 'CONFLICT', message: 'Garage2 is busy from 10:30 to 11:00', next: /availability/ },
  )
  assert.equal(made.length, 0)
})

test('refuses bare local times, the past, and a booking over two days', async () => {
  const { booking } = await setup()
  await assert.rejects(
    booking.book({ room: '2', start: '2026-11-05T10:00', end: '2026-11-05T11:00+01:00' }),
    {
      code: 'BAD_REQUEST',
      message: /with an offset/,
    },
  )
  await assert.rejects(
    booking.book({ room: '2', start: '2026-11-04T10:00+01:00', end: '2026-11-04T11:00+01:00' }),
    {
      message: 'that time has passed',
    },
  )
  await assert.rejects(
    booking.book({ room: '2', start: '2026-11-05T17:00+01:00', end: '2026-11-06T01:00+01:00' }),
    {
      message: /same day/,
    },
  )
})

test("shows every room's day, mine at their exact times", async () => {
  const mine = { id: 'b1', title: 'Meeting', organizer_email: 'me@example.test' }
  const { booking } = await setup({
    schedule: (roomId, d) =>
      roomId === 'room-1' ? day(d, { '13:30': mine, '14:00': mine }) : day(d),
    exact: [{ id: 'b1', start: '2026-11-05T12:30:00.000Z', end: '2026-11-05T13:15:00.000Z' }],
  })
  const a = await booking.availability()
  assert.equal(a.day, '2026-11-05')
  const [b] = a.rooms[0].busy
  assert.deepEqual([b.mine, booking.clock(b.start), booking.clock(b.end)], [true, '13:30', '14:15'])
  assert.deepEqual(a.rooms[1].busy, [])
})

test("cancels my booking of a room by a time it runs at, and nobody else's", async () => {
  const mine = { id: 'b1', title: 'Meeting', organizer_email: 'me@example.test' }
  const theirs = { id: 'b2', title: 'Theirs', organizer_email: 'them@example.test' }
  const { booking, cancelled } = await setup({
    schedule: (roomId, d) =>
      roomId === 'room-4' ? day(d, { '13:30': mine, '14:00': mine, '15:00': theirs }) : day(d),
    exact: [{ id: 'b1', start: '2026-11-05T12:30:00.000Z', end: '2026-11-05T13:15:00.000Z' }],
  })
  const at = (hhmm) => new Date(`2026-11-05T${hhmm}:00+01:00`)
  assert.deepEqual(await booking.cancelAt({ room: 'garage 4', at: at('13:45') }), {
    cancelled: 'b1',
    roomName: 'Garage 4 – (MuteBox)',
    start: '2026-11-05T12:30:00.000Z',
    end: '2026-11-05T13:15:00.000Z',
  })
  assert.deepEqual(cancelled, ['b1'])
  await assert.rejects(booking.cancelAt({ room: 'garage 4', at: at('15:00') }), {
    code: 'NOT_FOUND',
    message: /no booking of Garage 4 – \(MuteBox\) at 15:00 on 2026-11-05/,
  })
  await assert.rejects(booking.cancelAt({ room: 'garage 4', at: at('14:15') }), {
    code: 'NOT_FOUND',
  })
  assert.deepEqual(cancelled, ['b1'])
})

test('a lost sign-in tells the agent to sign in again', async () => {
  const { booking } = await setup({
    auth: { session: async () => Promise.reject(new BookingError('auth', 'not signed in')) },
  })
  await assert.rejects(booking.availability(), { code: 'UNAUTHORIZED', next: /bookingctl login/ })
})

test('cancels by booking id, and refuses anything else', async () => {
  const { booking, cancelled } = await setup()
  assert.deepEqual(await booking.cancel('b1'), { cancelled: 'b1' })
  assert.deepEqual(cancelled, ['b1'])
  await assert.rejects(booking.cancel('../x'), { code: 'BAD_REQUEST' })
})

/** The real sign-in over a temporary folder, and a site whose routes say
 *  "sign in again" to the access tokens in `refused`. */
async function siteThatEndsSessions({ refused, refresh }) {
  const store = await tempStore()
  await store.writeSession(tokens({ accessToken: 'a1', refreshToken: 'r1' }))
  const made = []
  const check = (s) => {
    if (refused.has(s.accessToken))
      throw new BookingError('auth', 'the booking site asked to sign in again')
  }
  const api = {
    rooms: async () => ROOMS,
    schedule: async (s, _r, d) => (check(s), day(d)),
    myBookings: async () => [],
    createBooking: async (s, b) => (check(s), made.push(b)),
    cancelBooking: async (s) => check(s),
    refresh,
  }
  const booking = createBooking({ site: SITE, api, store, now: () => NOW })
  return { booking, store, made }
}

test('a session the site ended early is renewed once and the call made again', async () => {
  const { booking, store, made } = await siteThatEndsSessions({
    refused: new Set(['a1']),
    refresh: async () => tokens({ accessToken: 'a2', refreshToken: 'r2' }),
  })
  await booking.book({
    room: '2',
    start: '2026-11-05T10:00:00+01:00',
    end: '2026-11-05T10:30:00+01:00',
  })
  assert.equal(made.length, 1)
  assert.equal((await store.readSession()).accessToken, 'a2')
})

test('a session the site will not renew reads as signed out', async () => {
  const { booking } = await siteThatEndsSessions({
    refused: new Set(['a1']),
    refresh: async () => Promise.reject(new BookingError('rejected', 'Session not found')),
  })
  await assert.rejects(booking.cancel('b1'), { code: 'UNAUTHORIZED', next: /bookingctl login/ })
  assert.equal((await booking.status()).signedIn, false)
})

test('a renewed session the site still refuses is dropped, not kept as live', async () => {
  const { booking } = await siteThatEndsSessions({
    refused: new Set(['a1', 'a2']),
    refresh: async () => tokens({ accessToken: 'a2', refreshToken: 'r2' }),
  })
  await assert.rejects(booking.availability('2026-11-05'), { code: 'UNAUTHORIZED' })
  assert.equal((await booking.status()).signedIn, false)
})
