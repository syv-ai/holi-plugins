// The room plan's server. Holi starts it for an opened `*.booking` file with
// `--port <port>` and frames http://localhost:<port>/. It serves the plan's
// page from web/ and answers the page's calls at POST /api/<operation>, with
// the same operations `bookingctl` runs, so the plan and the agent share one
// sign-in on this machine.
//
// Any web page in any browser on this machine can send requests to a
// loopback port, so the server answers only its own page: a request must name
// this server as its Host (no DNS rebinding), come from its own origin when
// it says one, and carry a JSON body with the plugin's header. That header and
// that content type make a browser ask first (CORS preflight), which this
// server never grants, so another site's page cannot call it.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createBooking, Refusal } from './booking.mjs'

const WEB = new URL('../web/', import.meta.url)
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
}
/** The header the page sends with every call. */
export const CALL_HEADER = 'x-modelokale'
/** The most a call's body may be. */
const MAX_BODY = 16 * 1024

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** The operations the page may call, and how each reads its body. */
function operations(booking) {
  return {
    status: () => booking.status(),
    login: (b) => booking.login(b.email),
    finish: (b) => booking.finish(b.link),
    logout: () => booking.logout(),
    rooms: () => booking.rooms(),
    availability: (b) => booking.availability(b.day ?? undefined),
    book: (b) => booking.book({ room: b.room, start: b.start, end: b.end }),
    cancel: (b) => booking.cancel(b.booking),
  }
}

export function createPlanServer({ port, booking = createBooking() }) {
  const ops = operations(booking)
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`])
  const origins = new Set([...hosts].map((h) => `http://${h}`))

  async function handle(req, res) {
    const send = (status, body, type) => answer(res, status, body, type)
    if (!hosts.has(req.headers.host ?? '')) return send(421, { error: 'wrong host' })
    const origin = req.headers.origin
    if (origin !== undefined && !origins.has(origin)) return send(403, { error: 'wrong origin' })

    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path.startsWith('/api/')) {
      const op = ops[path.slice('/api/'.length)]
      if (op === undefined) return send(404, { error: 'no such call' })
      if (
        req.method !== 'POST' ||
        req.headers[CALL_HEADER] !== '1' ||
        !(req.headers['content-type'] ?? '').startsWith('application/json')
      ) {
        return send(403, { error: 'not a call from the plan' })
      }
      let body
      try {
        body = await readBody(req)
      } catch {
        return send(400, { ok: false, code: 'BAD_REQUEST', message: 'the call was not JSON' })
      }
      try {
        return send(200, { ok: true, value: await op(body) })
      } catch (err) {
        const refusal = err instanceof Refusal
        return send(200, {
          ok: false,
          code: refusal ? err.code : 'INTERNAL',
          message: err.message,
        })
      }
    }

    const file = FILES[path]
    if (file === undefined || req.method !== 'GET') return send(404, 'not found', 'text/plain')
    send(200, await readFile(new URL(file[0], WEB)), file[1])
  }

  // Whatever one request does wrong (a request line that is no URL, say), it
  // gets its own answer and the server stays up for the plan: an exception
  // here would otherwise end the process, and the tab with it.
  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) res.destroy()
      else answer(res, 400, { error: 'bad request' })
    })
  })
}

function answer(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': CSP,
    'Referrer-Policy': 'no-referrer',
  })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  const value = text === '' ? {} : JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('not an object')
  return value
}

// Run as Holi's `serve` command: `node lib/serve.mjs --port <port>`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--port')
  const port = Number(process.argv[at + 1])
  if (at === -1 || !Number.isInteger(port) || port <= 0) {
    process.stderr.write('usage: node lib/serve.mjs --port <port>\n')
    process.exit(2)
  }
  // Both loopbacks, since `localhost` may resolve to either; a machine
  // without IPv6 has only the first.
  const booking = createBooking()
  createPlanServer({ port, booking }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`room plan on http://localhost:${port}/\n`)
  })
  createPlanServer({ port, booking })
    .on('error', () => {})
    .listen(port, '::1')
}
