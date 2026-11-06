import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApi, sessionCookie } from '../lib/api.mjs'
import { SITE, fakeFetch, tokens } from './helpers.mjs'

const HOST = 'booking.example.test'

test('carries the session as the site cookie, split when long', () => {
  const short = sessionCookie(tokens(), HOST)
  assert.match(short, /^sb-booking-auth-token=base64-/)
  const decoded = JSON.parse(Buffer.from(short.split('base64-')[1], 'base64url').toString())
  assert.equal(decoded.refresh_token, 'refresh')
  const long = sessionCookie(tokens({ accessToken: 'a'.repeat(5000) }), HOST)
  assert.match(long, /^sb-booking-auth-token\.0=base64-.*; sb-booking-auth-token\.1=/)
})

test('maps the site answers to kinds', async () => {
  const api = createApi(
    SITE,
    fakeFetch({
      'POST /api/bookings': { status: 409, body: { message: 'overlap' } },
      'DELETE /api/bookings/b1': { status: 429 },
      'DELETE /api/bookings/b2': { status: 302, headers: { location: '/login' } },
      'GET /rest/v1/rooms': { status: 503 },
    }),
  )
  const s = tokens()
  const b = { roomId: 'r', title: 'Meeting', start: new Date(), end: new Date() }
  await assert.rejects(api.createBooking(s, b), { kind: 'conflict', message: 'overlap' })
  await assert.rejects(api.cancelBooking(s, 'b1'), { kind: 'rate-limited' })
  await assert.rejects(api.cancelBooking(s, 'b2'), { kind: 'auth' })
  await assert.rejects(api.rooms(), { kind: 'network' })
})

test('a schedule without slots or a rooms answer that is no list is the site failing', async () => {
  const api = createApi(
    SITE,
    fakeFetch({ 'GET /api/rooms/r/schedule': { body: {} }, 'GET /rest/v1/rooms': { body: {} } }),
  )
  await assert.rejects(api.schedule(tokens(), 'r', '2026-11-05'), { kind: 'network' })
  await assert.rejects(api.rooms(), { kind: 'network' })
})

test('books on the site clock', async () => {
  const fetch = fakeFetch({ 'POST /api/bookings': { status: 201 } })
  await createApi(SITE, fetch).createBooking(tokens(), {
    roomId: 'r',
    title: 'Meeting',
    start: new Date('2026-11-05T09:00:00Z'),
    end: new Date('2026-11-05T09:45:00Z'),
  })
  const body = JSON.parse(fetch.seen[0].init.body)
  assert.equal(body.start_time, '2026-11-05T10:00:00')
  assert.equal(body.end_time, '2026-11-05T10:45:00')
})

test('lists my bookings at their exact times, without cancelled ones', async () => {
  const api = createApi(
    SITE,
    fakeFetch({
      'GET /api/bookings?date_start=2026-11-05&date_end=2026-11-06': {
        body: {
          bookings: [
            {
              id: 'b1',
              status: 'confirmed',
              start_time: '2026-11-05T12:30:00+00:00',
              end_time: '2026-11-05T13:15:00+00:00',
            },
            {
              id: 'b2',
              status: 'cancelled',
              start_time: '2026-11-05T14:00:00+00:00',
              end_time: '2026-11-05T15:00:00+00:00',
            },
          ],
        },
      },
    }),
  )
  assert.deepEqual(await api.myBookings(tokens(), '2026-11-05'), [
    { id: 'b1', start: '2026-11-05T12:30:00.000Z', end: '2026-11-05T13:15:00.000Z' },
  ])
})

test('follows a login link only to the site, one hop, and takes only a code', async () => {
  const api = createApi(
    SITE,
    fakeFetch({
      'GET /auth/v1/verify?token=good': {
        status: 303,
        headers: { location: 'https://booking.example.test/callback?code=abc' },
      },
      'GET /auth/v1/verify?token=tokens': {
        status: 303,
        headers: { location: 'https://booking.example.test/callback#access_token=x' },
      },
    }),
  )
  assert.deepEqual(await api.followLoginLink(`https://${HOST}/auth/v1/verify?token=good`), {
    code: 'abc',
  })
  assert.deepEqual(await api.followLoginLink(`https://${HOST}/callback?code=direct`), {
    code: 'direct',
  })
  await assert.rejects(api.followLoginLink('https://evil.test/auth/v1/verify?token=good'), {
    kind: 'rejected',
  })
  await assert.rejects(api.followLoginLink(`http://${HOST}/auth/v1/verify?token=good`), {
    kind: 'rejected',
  })
  await assert.rejects(api.followLoginLink(`https://${HOST}/auth/v1/verify?token=tokens`), {
    kind: 'auth',
  })
})
