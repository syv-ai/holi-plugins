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
