import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../lib/store.mjs'

export const SITE = {
  base: 'https://booking.example.test',
  anonKey: 'anon',
  callback: 'https://booking.example.test/callback',
  timeZone: 'Europe/Oslo',
}

export const tempStore = async () => createStore(await mkdtemp(join(tmpdir(), 'modelokale-')))

export const tokens = (over = {}) => ({
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: Date.parse('2030-01-01T00:00:00Z'),
  userId: 'me-id',
  email: 'me@example.test',
  ...over,
})

export const ROOMS = [
  { id: 'room-1', name: 'Garage1', email: 'Garage1@example.test', capacity: 8 },
  { id: 'room-2', name: 'Garage2', email: 'Garage2@example.test', capacity: 8 },
  { id: 'room-4', name: 'Garage 4 – (MuteBox)', email: 'Garage4@example.test', capacity: 1 },
  { id: 'room-5', name: 'Garage 5 (MuteBox)', email: 'Garage5@example.test', capacity: 1 },
]

/** A day of half-hour slots, 08 to 18, busy where `busy` says. */
export function day(date, busy = {}) {
  const slots = []
  for (let m = 8 * 60; m < 18 * 60; m += 30) {
    const at = (x) =>
      `${date}T${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}:00`
    const booking = busy[at(m).slice(11, 16)]
    slots.push({
      start: at(m),
      end: at(m + 30),
      status: booking ? 'busy' : 'free',
      booking: booking ?? null,
    })
  }
  return slots
}

/** A fetch that answers from `routes` (`'GET /path?query'` → response) and
 *  keeps what it was asked. */
export function fakeFetch(routes) {
  const seen = []
  const fn = async (url, init = {}) => {
    const u = new URL(url)
    const key = `${init.method ?? 'GET'} ${u.pathname}${u.search}`
    seen.push({ key, init })
    const hit = Object.entries(routes).find(([k]) => key.startsWith(k))
    if (hit === undefined) throw new Error(`no route for ${key}`)
    const r = typeof hit[1] === 'function' ? hit[1](init) : hit[1]
    const body =
      r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
    return new Response(body === '' ? null : body, {
      status: r.status ?? 200,
      headers: r.headers ?? {},
    })
  }
  fn.seen = seen
  return fn
}
