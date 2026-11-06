import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Refusal } from '../lib/booking.mjs'
import { main, PLAN_FILE } from '../lib/cli.mjs'

function run(argv, booking = {}) {
  const out = []
  const err = []
  return main(argv, {
    booking: { clock: (iso) => iso.slice(11, 16), ...booking },
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
