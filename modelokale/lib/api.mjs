// The booking site's HTTP surface and nothing else: Supabase's auth endpoints
// (`/auth/v1`), the data API (`/rest/v1`) and the site's own schedule and
// booking routes (`/api/...`). No state and no storage; `fetch` is injected
// so the tests never reach the site.
//
// Every failure is a `BookingError` whose kind says what to do: `auth` is a
// sign-in to make again, `conflict` a slot someone else holds, `rejected` a
// request the site refused, `rate-limited` a moment to wait, `network` the
// site not answering.
import { toLocal } from './clock.mjs'

export class BookingError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'BookingError'
    this.kind = kind
  }
}

/** The longest the site gets to answer one request. */
const TIMEOUT_MS = 20_000
/** The longest a cookie value gets before the site's client splits it. */
const COOKIE_CHUNK = 3180
const ROOM_COLUMNS = 'id,display_name,email_address,capacity'

export function createApi(site, fetchImpl = fetch) {
  const host = new URL(site.base).host

  // `fetch`, never following a redirect, a body sent as JSON, and a site that
  // does not answer as a network failure.
  async function send(url, { method, headers, body }) {
    const json = body !== undefined
    try {
      return await fetchImpl(url, {
        method: method ?? (json ? 'POST' : 'GET'),
        redirect: 'manual',
        headers: json ? { ...headers, 'Content-Type': 'application/json' } : headers,
        ...(json ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new BookingError('network', `the booking site did not answer: ${err.message}`)
    }
  }

  async function request(path, init = {}) {
    const res = await send(`${site.base}${path}`, {
      ...init,
      headers: { apikey: site.anonKey, Authorization: `Bearer ${init.token ?? site.anonKey}` },
    })
    if (res.ok) return res
    throw await failure(res)
  }

  const json = async (path, init) => readJson(await request(path, init))
  const tokens = async (path, body) => readTokens(await json(path, { method: 'POST', body }))

  // One of the site's own routes (`/api/...`), which read the session from the
  // cookie its pages carry. A redirect is the site's middleware sending a
  // signed-out caller to its login page.
  async function siteRequest(path, session, init = {}) {
    const res = await send(`${site.base}${path}`, {
      ...init,
      headers: { Accept: 'application/json', Cookie: sessionCookie(session, host) },
    })
    if (res.status >= 300 && res.status < 400) {
      throw new BookingError('auth', 'the booking site asked to sign in again')
    }
    if (!res.ok) throw await failure(res)
    return res
  }

  return {
    host,

    /** Email a login link. `codeChallenge` makes it a PKCE link, so only the
     *  holder of the matching verifier can turn it into a session. */
    async sendLoginEmail(email, codeChallenge) {
      const redirect = encodeURIComponent(site.callback)
      await request(`/auth/v1/otp?redirect_to=${redirect}`, {
        method: 'POST',
        // `create_user: false`: this signs people in, it never signs them up.
        body: {
          email,
          create_user: false,
          data: {},
          code_challenge: codeChallenge,
          code_challenge_method: 's256',
        },
      })
    },

    /** Follow the emailed link one hop, to the auth server and not on to the
     *  site, and return the PKCE code the site's callback would have got.
     *  Only a code is taken: tokens in a link would sign in without the
     *  verifier, as whoever made the link. */
    async followLoginLink(link) {
      const url = loginUrl(link, host)
      const direct = fromCallback(url.toString())
      if (direct !== null) return direct
      const res = await send(url.toString(), { headers: { apikey: site.anonKey } })
      const location = res.headers.get('location')
      if (res.status < 300 || res.status >= 400 || location === null) {
        throw new BookingError('auth', 'that login link did not sign in; it may be used or expired')
      }
      const landed = fromCallback(new URL(location, site.base).toString())
      if (landed === null) {
        // GoTrue sends a used or expired link to the callback with an error,
        // and a link from a login without PKCE carries tokens instead.
        const reason = new URL(location, site.base)
        const why =
          reason.searchParams.get('error_description') ??
          new URLSearchParams(reason.hash.slice(1)).get('error_description')
        throw new BookingError('auth', why ?? 'that login link did not sign in')
      }
      return landed
    },

    exchangeCode: (code, verifier) =>
      tokens('/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: verifier }),

    /** A typed one-time code, for an email template that sends one. */
    verifyCode: (email, code) => tokens('/auth/v1/verify', { type: 'email', email, token: code }),

    refresh: (refreshToken) =>
      tokens('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken }),

    async signOut(accessToken) {
      await request('/auth/v1/logout?scope=local', { method: 'POST', token: accessToken })
    },

    async rooms() {
      const rows = await json(
        `/rest/v1/rooms?select=${ROOM_COLUMNS}&is_active=eq.true&order=display_name`,
      )
      // Not a list is the site failing, not a site with no rooms: read as one,
      // `book` would say the room does not exist.
      if (!Array.isArray(rows)) throw new BookingError('network', 'the booking site sent no rooms')
      return rows.map(readRoom)
    },

    /** One room's day (`YYYY-MM-DD`, the site's local day) as the site's
     *  booking page reads it: half-hour slots on the site's clock, with every
     *  company's bookings and the room's Outlook events among the busy ones. */
    async schedule(session, roomId, day) {
      const body = await readJson(
        await siteRequest(
          `/api/rooms/${encodeURIComponent(roomId)}/schedule?date=${encodeURIComponent(day)}`,
          session,
        ),
      )
      // The site always lists the day's slots, free ones too. An answer
      // without them is not an empty day: read as one, every room would show
      // free and a booking would skip its clash check.
      if (!Array.isArray(body?.time_slots)) {
        throw new BookingError('network', 'the booking site sent no schedule')
      }
      return body.time_slots
    },

    /** The person's own bookings around `day`, at their exact times, from the
     *  list the site's bookings page reads; cancelled ones left out. */
    async myBookings(session, day) {
      const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
      const body = await readJson(
        await siteRequest(`/api/bookings?date_start=${day}&date_end=${next}`, session),
      )
      if (!Array.isArray(body?.bookings)) {
        throw new BookingError('network', 'the booking site sent no bookings')
      }
      return body.bookings.flatMap((b) =>
        b.status !== 'cancelled' &&
        typeof b.id === 'string' &&
        typeof b.start_time === 'string' &&
        typeof b.end_time === 'string'
          ? [
              {
                id: b.id,
                start: new Date(b.start_time).toISOString(),
                end: new Date(b.end_time).toISOString(),
              },
            ]
          : [],
      )
    },

    /** Book through the site's own route, which also puts the booking in the
     *  room's Outlook calendar. Any 2xx is the booking made; the body is not
     *  read, so an answer that is not JSON never reports a made booking as a
     *  failure. */
    async createBooking(session, b) {
      await siteRequest('/api/bookings', session, {
        body: {
          room_id: b.roomId,
          title: b.title,
          description: null,
          start_time: toLocal(b.start, site.timeZone),
          end_time: toLocal(b.end, site.timeZone),
        },
      })
    },

    /** Cancel through the site's own route, as its bookings page does: the
     *  site checks the booking is the caller's and takes it off Outlook. */
    async cancelBooking(session, bookingId) {
      await siteRequest(`/api/bookings/${encodeURIComponent(bookingId)}`, session, {
        method: 'DELETE',
      })
    },
  }
}

// The emailed link, only if it points at the booking site. A link from a mail
// is untrusted input: exactly one kind is followed, to exactly one host.
function loginUrl(link, host) {
  let url
  try {
    url = new URL(String(link).trim())
  } catch {
    throw new BookingError('rejected', 'that is not a link')
  }
  if (url.protocol !== 'https:' || url.host !== host) {
    throw new BookingError('rejected', `a login link must point at ${host}`)
  }
  return url
}

function fromCallback(location) {
  const code = new URL(location).searchParams.get('code')
  return code !== null && code !== '' ? { code } : null
}

/**
 * The session as the site's pages carry it: Supabase's SSR cookie,
 * `sb-<first label of the host>-auth-token`, holding `base64-` and the session
 * JSON, split into `.0`, `.1`… when long. The site's routes read nothing else.
 * Tokens are refreshed minutes before they expire (auth.mjs), well before the
 * site's own client would rotate them where this plugin cannot see.
 */
export function sessionCookie(t, host) {
  const name = `sb-${host.split('.')[0]}-auth-token`
  const session = {
    access_token: t.accessToken,
    token_type: 'bearer',
    expires_in: Math.max(0, Math.round((t.expiresAt - Date.now()) / 1000)),
    expires_at: Math.floor(t.expiresAt / 1000),
    refresh_token: t.refreshToken,
    user: { id: t.userId, email: t.email, aud: 'authenticated', role: 'authenticated' },
  }
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`
  if (value.length <= COOKIE_CHUNK) return `${name}=${value}`
  const parts = []
  for (let i = 0; i * COOKIE_CHUNK < value.length; i++) {
    parts.push(`${name}.${i}=${value.slice(i * COOKIE_CHUNK, (i + 1) * COOKIE_CHUNK)}`)
  }
  return parts.join('; ')
}

// A body as JSON, null when empty. A page that is not JSON (an error page in
// front of the site, say) is the site not answering as it should.
async function readJson(res) {
  const text = await res.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    throw new BookingError('network', 'the booking site did not answer with data')
  }
}

async function failure(res) {
  const body = await res.json().catch(() => null)
  const message = String(
    body?.msg ?? body?.message ?? body?.error_description ?? body?.error ?? `HTTP ${res.status}`,
  )
  if (res.status === 409) return new BookingError('conflict', message)
  if (res.status === 401) return new BookingError('auth', message)
  if (res.status === 429) {
    return new BookingError('rate-limited', 'the booking site asks to wait a moment')
  }
  return new BookingError(res.status >= 500 ? 'network' : 'rejected', message)
}

const str = (v) => (typeof v === 'string' ? v : '')

function readRoom(row) {
  return {
    id: str(row.id),
    name: str(row.display_name),
    email: str(row.email_address),
    capacity: typeof row.capacity === 'number' ? row.capacity : null,
  }
}

function readTokens(v) {
  v ??= {}
  const user = v.user ?? {}
  if (typeof v.access_token !== 'string' || typeof v.refresh_token !== 'string') {
    throw new BookingError('auth', 'the booking site did not return a session')
  }
  const expiresAt =
    typeof v.expires_at === 'number'
      ? v.expires_at * 1000
      : Date.now() + (typeof v.expires_in === 'number' ? v.expires_in : 3600) * 1000
  return {
    accessToken: v.access_token,
    refreshToken: v.refresh_token,
    expiresAt,
    userId: str(user.id),
    email: str(user.email),
  }
}
