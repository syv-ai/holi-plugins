import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { BookingError } from '../lib/api.mjs'
import { createAuth } from '../lib/auth.mjs'
import { createStore } from '../lib/store.mjs'
import { tempStore, tokens } from './helpers.mjs'

const fakeApi = (over = {}) => ({
  sendLoginEmail: async () => {},
  followLoginLink: async () => ({ code: 'abc' }),
  exchangeCode: async () => tokens(),
  verifyCode: async () => tokens(),
  refresh: async () => tokens(),
  signOut: async () => {},
  ...over,
})

test('a login started in one process finishes in another, with its verifier', async () => {
  const store = await tempStore()
  let challenge = ''
  let verifier = ''
  await createAuth({
    api: fakeApi({ sendLoginEmail: async (_e, c) => void (challenge = c) }),
    store,
  }).start('me@example.test')
  // A second process over the same folder: bookingctl after the plan, say.
  const later = createAuth({
    api: fakeApi({ exchangeCode: async (_c, v) => ((verifier = v), tokens({ email: '' })) }),
    store: createStore(store.dir),
  })
  assert.deepEqual(await later.finish('https://booking.example.test/callback?code=abc'), {
    email: 'me@example.test',
  })
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge)
  assert.equal(await store.readPending(), null)
  assert.equal((await store.readPrefs()).email, 'me@example.test')
})

test('refuses a link to a login this machine did not start, without spending it', async () => {
  let followed = false
  const auth = createAuth({
    api: fakeApi({ followLoginLink: async () => ((followed = true), { code: 'x' }) }),
    store: await tempStore(),
  })
  await assert.rejects(auth.finish('https://booking.example.test/callback?code=x'), {
    kind: 'auth',
    message: /no login is waiting/,
  })
  assert.equal(followed, false)
})

test('two processes refreshing at once spend the refresh token once', async () => {
  const store = await tempStore()
  await store.writeSession(tokens({ expiresAt: 0 }))
  let refreshes = 0
  const api = fakeApi({
    refresh: async () => {
      refreshes++
      await new Promise((r) => setTimeout(r, 50))
      return tokens({ accessToken: 'new', expiresAt: Date.now() + 3_600_000 })
    },
  })
  const a = createAuth({ api, store })
  const b = createAuth({ api, store: createStore(store.dir) })
  const [x, y] = await Promise.all([a.session(), b.session()])
  assert.equal(refreshes, 1)
  assert.equal(x.accessToken, 'new')
  assert.equal(y.accessToken, 'new')
})

test('a refused refresh signs out; a site not answering does not', async () => {
  const store = await tempStore()
  await store.writeSession(tokens({ expiresAt: 0 }))
  const offline = createAuth({
    api: fakeApi({ refresh: async () => Promise.reject(new BookingError('network', 'down')) }),
    store,
  })
  await assert.rejects(offline.session(), { message: 'down' })
  assert.notEqual(await store.readSession(), null)
  const refused = createAuth({
    api: fakeApi({
      refresh: async () => Promise.reject(new BookingError('rejected', 'Invalid Refresh Token')),
    }),
    store,
  })
  await assert.rejects(refused.session(), { kind: 'auth', message: /has ended/ })
  assert.equal(await store.readSession(), null)
})

test('signs out here even when the site does not answer', async () => {
  const store = await tempStore()
  await store.writeSession(tokens())
  const auth = createAuth({
    api: fakeApi({ signOut: async () => Promise.reject(new Error('offline')) }),
    store,
  })
  await auth.signOut()
  assert.equal(await auth.current(), null)
})

test('renews a session the site refused early, or takes one renewed meanwhile', async () => {
  const store = await tempStore()
  const held = tokens({ accessToken: 'old', refreshToken: 'r1' })
  await store.writeSession(held)
  let refreshes = 0
  const auth = createAuth({
    api: fakeApi({
      refresh: async () => (refreshes++, tokens({ accessToken: 'new', refreshToken: 'r2' })),
    }),
    store,
  })
  // Not due for a refresh by its clock, but the site said to sign in again.
  assert.equal((await auth.renew(held)).accessToken, 'new')
  // Another caller with the same stale session gets the renewed one, and
  // the rotated refresh token is not spent again.
  assert.equal((await auth.renew(held)).accessToken, 'new')
  assert.equal(refreshes, 1)
})

test('a renewal the site refuses ends the sign-in here', async () => {
  const store = await tempStore()
  const held = tokens()
  await store.writeSession(held)
  const auth = createAuth({
    api: fakeApi({
      refresh: async () => Promise.reject(new BookingError('rejected', 'Session not found')),
    }),
    store,
  })
  await assert.rejects(auth.renew(held), { kind: 'auth', message: /has ended/ })
  assert.equal(await auth.current(), null)
})

test('drops only the session it was given, never a newer one', async () => {
  const store = await tempStore()
  const auth = createAuth({ api: fakeApi(), store })
  await store.writeSession(tokens({ accessToken: 'newer' }))
  await auth.drop(tokens({ accessToken: 'older' }))
  assert.equal((await store.readSession()).accessToken, 'newer')
  await auth.drop(tokens({ accessToken: 'newer' }))
  assert.equal(await store.readSession(), null)
})
