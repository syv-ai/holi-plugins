import assert from 'node:assert/strict'
import { request } from 'node:http'
import { after, before, test } from 'node:test'
import { Refusal } from '../lib/booking.mjs'
import { createPlanServer } from '../lib/serve.mjs'

let server
let port
const calls = []

before(async () => {
  const booking = {
    status: async () => ({ signedIn: false }),
    book: async (b) => {
      calls.push(b)
      throw new Refusal('CONFLICT', 'taken')
    },
  }
  // The port is only known once listening; the server checks Host by it.
  server = createPlanServer({ port: 0, booking })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  port = server.address().port
  server.close()
  server = createPlanServer({ port, booking })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
})
after(() => server.close())

function send(path, { method = 'POST', headers = {}, body = '{}' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers: { host: `localhost:${port}`, ...headers } },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode, text }))
      },
    )
    req.on('error', reject)
    req.end(method === 'GET' ? undefined : body)
  })
}

const CALL = { 'content-type': 'application/json', 'x-modelokale': '1' }

test('answers its own page', async () => {
  const r = await send('/api/status', { headers: CALL })
  assert.deepEqual(JSON.parse(r.text), { ok: true, value: { signedIn: false } })
  assert.equal((await send('/', { method: 'GET' })).status, 200)
})

test('passes a refusal on with its code', async () => {
  const r = await send('/api/book', { headers: CALL, body: '{"room":"2"}' })
  assert.deepEqual(JSON.parse(r.text), { ok: false, code: 'CONFLICT', message: 'taken' })
  assert.deepEqual(calls.at(-1), { room: '2', start: undefined, end: undefined })
})

test('answers no other page, host or kind of request', async () => {
  const no = async (opts, status) => assert.equal((await send('/api/status', opts)).status, status)
  await no({ headers: { 'content-type': 'application/json' } }, 403)
  await no({ headers: { 'x-modelokale': '1', 'content-type': 'text/plain' } }, 403)
  await no({ headers: { ...CALL, origin: 'https://evil.test' } }, 403)
  await no({ headers: { ...CALL, host: `evil.test:${port}` } }, 421)
  await no({ method: 'GET', headers: CALL }, 403)
  assert.equal((await send('/lib/site.mjs', { method: 'GET' })).status, 404)
  assert.equal((await send('/api/nope', { headers: CALL })).status, 404)
})

test('a request it cannot read gets a 400, and the server stays up', async () => {
  const { connect } = await import('node:net')
  const first = await new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () =>
      s.write(`GET //[ HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`),
    )
    let text = ''
    s.on('data', (d) => (text += d))
    s.on('end', () => resolve(text.split('\r\n')[0]))
    s.on('error', reject)
  })
  assert.equal(first, 'HTTP/1.1 400 Bad Request')
  assert.equal((await send('/', { method: 'GET' })).status, 200)
})
