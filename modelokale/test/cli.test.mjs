import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Refusal } from '../lib/booking.mjs'
import { main, PLAN_FILE } from '../lib/cli.mjs'

// Monday 9 November 2026, 12:53 at the office.
const NOW = Date.parse('2026-11-09T12:53:00+01:00')

function run(argv, booking = {}) {
  const out = []
  const err = []
  return main(argv, {
    now: () => NOW,
    booking: { clock: (iso) => iso.slice(11, 16), timeZone: 'Europe/Copenhagen', ...booking },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  }).then((code) => ({ code, out: out.join('\n'), err: err.join('\n') }))
}

test('the readiness check passes only when signed in, and prints nothing', async () => {
  const signedOut = await run(['status', '--check'], { status: async () => ({ signedIn: false }) })
  assert.deepEqual([signedOut.code, signedOut.out], [1, ''])
  const signedIn = await run(['status', '--check'], { status: async () => ({ signedIn: true }) })
  assert.equal(signedIn.code, 0)
})

test('a refusal exits 1 with its reason and next step', async () => {
  const r = await run(['cancel', 'b1'], {
    cancel: async () => {
      throw new Refusal('UNAUTHORIZED', 'not signed in', 'run bookingctl login')
    },
  })
  assert.equal(r.code, 1)
  assert.equal(r.err, 'error (UNAUTHORIZED): not signed in\nnext: run bookingctl login')
})

test('book passes the title on only when given', async () => {
  const seen = []
  const book = async (b) => (seen.push(b), { roomName: 'Garage2', day: '2026-11-05', ...b })
  await run(['book', '2', '2026-11-05T09:00:00Z', '2026-11-05T10:00:00Z'], { book })
  await run(['book', '2', '2026-11-05T09:00:00Z', '2026-11-05T10:00:00Z', 'Team', 'sync'], { book })
  assert.equal('title' in seen[0], false)
  assert.equal(seen[1].title, 'Team sync')
})

test('book takes a start on the office clock and a length, today unless --on says', async () => {
  const seen = []
  const book = async (b) => (seen.push(b), { roomName: 'Garage 4', day: '2026-11-09', ...b })
  const r = await run(['book', 'Garage 4', '--at', '13:00', '--for', '15m'], { book })
  assert.equal(r.code, 0)
  await run(['book', '--room', '4', '--at', '10', '--on', 'fri', '--title', 'Call'], { book })
  assert.deepEqual(seen, [
    { room: 'Garage 4', start: '2026-11-09T12:00:00.000Z', end: '2026-11-09T12:15:00.000Z' },
    {
      room: '4',
      start: '2026-11-13T09:00:00.000Z',
      end: '2026-11-13T09:30:00.000Z',
      title: 'Call',
    },
  ])
})

test('book refuses before booking: a time passed today, no --at, an unknown flag', async () => {
  const book = async () => assert.fail('nothing is booked')
  const passed = await run(['book', '4', '--at', '09:00'], { book })
  assert.equal(passed.code, 1)
  assert.match(passed.err, /09:00 has passed today\nnext: add --on tomorrow/)
  assert.equal((await run(['book', '4', '--for', '15m'], { book })).code, 1)
  assert.equal((await run(['book', '4', '--at', '13:00', '--end', '14:00'], { book })).code, 1)
  assert.equal((await run(['book', '4', '5', '--at', '13:00'], { book })).code, 1)
})

test('cancel finds my booking by room and time, or takes its id', async () => {
  const seen = []
  const cancelAt = async (c) => (
    seen.push(c),
    {
      cancelled: 'b1',
      roomName: 'Garage 4',
      start: '2026-11-09T12:00:00.000Z',
      end: '2026-11-09T12:15:00.000Z',
    }
  )
  const r = await run(['cancel', 'Garage 4', '--at', '13:00'], { cancelAt })
  assert.deepEqual([r.code, r.out], [0, 'cancelled your booking of Garage 4, 12:00–12:15'])
  // A meeting under way is still found: no "has passed" for a cancel.
  await run(['cancel', '--room', '4', '--at', '09:00'], { cancelAt })
  assert.deepEqual(
    seen.map((c) => [c.room, c.at.toISOString()]),
    [
      ['Garage 4', '2026-11-09T12:00:00.000Z'],
      ['4', '2026-11-09T08:00:00.000Z'],
    ],
  )
  const byId = await run(['cancel', 'b1'], { cancel: async (id) => ({ cancelled: id }) })
  assert.equal(byId.out, 'cancelled booking b1')
})

test('plan creates the room plan in a vault, once, and nowhere else', async () => {
  const vault = await mkdtemp(join(tmpdir(), 'vault-'))
  assert.equal((await run(['plan', vault])).code, 1)
  await mkdir(join(vault, '.holi'))
  assert.equal((await run(['plan', vault])).code, 0)
  assert.match(await readFile(join(vault, PLAN_FILE), 'utf8'), /room plan/)
  assert.equal((await run(['plan', vault])).code, 0)
})

test('an unknown command exits 2', async () => {
  assert.equal((await run(['nope'])).code, 2)
})
