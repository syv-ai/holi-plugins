// What the plugin does, one set of operations for both doors: `bookingctl`
// for the vault's agent and the plan's server for the person. Each refuses
// with a `Refusal`, whose code says what kind of no it is and whose `next`
// tells the agent what to do about it.
import { BookingError, createApi } from './api.mjs'
import { createAuth } from './auth.mjs'
import { localDay, toLocal } from './clock.mjs'
import { busyIntervals, withExactTimes } from './schedule.mjs'
import { SITE } from './site.mjs'
import { createStore } from './store.mjs'

/** The longest one booking may run. */
const MAX_BOOKING_MS = 12 * 60 * 60_000
/** A booking may start this far in the past: "now" typed a minute ago. */
export const PAST_SLACK_MS = 15 * 60_000
/** What the site is told a booking is called: it wants a title, and the room
 *  and the time say the rest. */
const DEFAULT_TITLE = 'Meeting'

export class Refusal extends Error {
  constructor(code, message, next) {
    super(message)
    this.name = 'Refusal'
    this.code = code
    if (next !== undefined) this.next = next
  }
}

/** The next step for the agent when the sign-in is gone. */
const SIGN_IN_AGAIN =
  "sign in again: run `bookingctl login <the person's email>`, or ask the person to sign in on the room plan"
/** The next step for the agent when the slot is taken. */
const TAKEN = 'read `bookingctl availability <day>` again and pick a free room or time'

export function createBooking({
  site = SITE,
  api = createApi(site),
  store = createStore(),
  auth = createAuth({ api, store }),
  now = Date.now,
} = {}) {
  const host = new URL(site.base).host

  /** A room's busy times on `day`, with the person's own bookings at their
   *  exact times rather than the schedule's half hours. Those times only
   *  sharpen the picture, so when the list does not answer the half hours
   *  stand. */
  const busyOn = (slots, session, exact) =>
    withExactTimes(
      busyIntervals(slots, site.timeZone, { userId: session.userId, email: session.email }),
      exact,
    )
  const exactOn = (session, day) => api.myBookings(session, day).catch(() => [])

  /**
   * Run `work` with the session. The site may say to sign in again before the
   * token runs out (it ended the session, or another client rotated it):
   * then the session is refreshed once and `work` tried again, and a refresh
   * the site refuses ends the sign-in here. A renewed session it still
   * refuses is dropped, so the sign-in never reads as live while every call
   * fails. A call the site refused as signed out made no change, so trying
   * it again is safe.
   */
  async function withSession(work) {
    const first = await auth.session()
    try {
      return await work(first)
    } catch (err) {
      if (!(err instanceof BookingError) || err.kind !== 'auth') throw err
    }
    const second = await auth.renew(first)
    try {
      return await work(second)
    } catch (err) {
      if (err instanceof BookingError && err.kind === 'auth') await auth.drop(second)
      throw err
    }
  }

  /** HH:MM on the site's clock. */
  const clock = (iso) => toLocal(new Date(iso), site.timeZone).slice(11, 16)

  async function status() {
    const who = await auth.current()
    const pending = await auth.pending()
    return {
      signedIn: who !== null,
      email: who?.email ?? null,
      site: host,
      loginSentTo: who === null ? (pending?.email ?? null) : null,
      lastEmail: (await store.readPrefs()).email ?? null,
    }
  }

  /** Every room's busy times on one of the site's days, today by default:
   *  every company's bookings and the rooms' Outlook events. */
  async function availability(day) {
    if (day !== undefined && day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new Refusal('BAD_REQUEST', '`day` is a date, like 2026-11-05')
    }
    return guard(async () => {
      const rooms = await api.rooms()
      const on = day ?? localDay(new Date(now()), site.timeZone)
      return withSession(async (session) => {
        const [days, exact] = await Promise.all([
          Promise.all(rooms.map((r) => api.schedule(session, r.id, on))),
          exactOn(session, on),
        ])
        return {
          day: on,
          rooms: rooms.map((r, i) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            busy: busyOn(days[i], session, exact),
          })),
        }
      })
    })
  }

  return {
    clock,
    timeZone: site.timeZone,
    status,

    /** Ask the site to email a login link to `email`. */
    async login(email) {
      const address = String(email ?? '').trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        throw new Refusal('BAD_REQUEST', 'that is not an email address')
      }
      await guard(() => auth.start(address))
      return status()
    },

    /** Finish a sign-in with the link (or code) from the login email. */
    async finish(link) {
      if (typeof link !== 'string' || link.trim() === '') {
        throw new Refusal('BAD_REQUEST', 'give the link from the login email')
      }
      await guard(() => auth.finish(link))
      return status()
    },

    async logout() {
      await auth.signOut()
      return status()
    },

    /** The bookable rooms. Needs no sign-in. */
    rooms: () => guard(() => api.rooms()),

    availability,

    /** Book `room` (id, mailbox, name or number) from `start` to `end`, ISO
     *  instants with an offset. Refused when the room's schedule shows it
     *  taken; the site has the last word. */
    async book({ room, start, end, title }) {
      if (typeof room !== 'string' || room.trim() === '') {
        throw new Refusal('BAD_REQUEST', '`room` is required')
      }
      const from = instant(start, 'start')
      const to = instant(end, 'end')
      const name = title === undefined || title === null ? DEFAULT_TITLE : String(title).trim()
      if (to <= from) throw new Refusal('BAD_REQUEST', 'the booking must end after it starts')
      if (to - from > MAX_BOOKING_MS) {
        throw new Refusal('BAD_REQUEST', 'a booking can run at most 12 hours')
      }
      if (name === '' || name.length > 200) {
        throw new Refusal('BAD_REQUEST', 'a booking title is 1 to 200 characters')
      }
      if (from.getTime() < now() - PAST_SLACK_MS) {
        throw new Refusal('BAD_REQUEST', 'that time has passed')
      }
      return guard(async () => {
        const target = resolveRoom(await api.rooms(), room)
        const day = localDay(from, site.timeZone)
        if (localDay(new Date(to.getTime() - 1), site.timeZone) !== day) {
          throw new Refusal('BAD_REQUEST', 'a booking starts and ends on the same day')
        }
        await withSession(async (session) => {
          const [slots, exact] = await Promise.all([
            api.schedule(session, target.id, day),
            exactOn(session, day),
          ])
          const clash = busyOn(slots, session, exact).find(
            (x) => Date.parse(x.start) < to.getTime() && Date.parse(x.end) > from.getTime(),
          )
          if (clash !== undefined) {
            throw new Refusal(
              'CONFLICT',
              `${target.name} is busy from ${clock(clash.start)} to ${clock(clash.end)}`,
              TAKEN,
            )
          }
          await api.createBooking(session, { roomId: target.id, title: name, start: from, end: to })
        })
        return {
          roomId: target.id,
          roomName: target.name,
          day,
          start: from.toISOString(),
          end: to.toISOString(),
          title: name,
        }
      })
    },

    /** Cancel the person's own booking of `room` that runs at `at`, an
     *  instant: the one `availability` shows there, found by its time. */
    async cancelAt({ room, at }) {
      if (typeof room !== 'string' || room.trim() === '') {
        throw new Refusal('BAD_REQUEST', '`room` is required')
      }
      const day = localDay(at, site.timeZone)
      const { rooms } = await availability(day)
      const target = resolveRoom(rooms, room)
      const mine = target.busy.filter(
        (b) => b.mine && Date.parse(b.start) <= at.getTime() && at.getTime() < Date.parse(b.end),
      )
      const when = `${clock(at.toISOString())} on ${day}`
      if (mine.length === 0)
        throw new Refusal(
          'NOT_FOUND',
          `you have no booking of ${target.name} at ${when}`,
          `read \`bookingctl availability ${day}\` for your bookings, marked (yours)`,
        )
      if (mine.length > 1 || mine[0].bookingId === undefined || mine[0].bookingId === null)
        throw new Refusal(
          'CONFLICT',
          `the site does not say which booking of ${target.name} at ${when} is yours`,
          `cancel it by its id from \`bookingctl availability ${day}\`, or on the room plan`,
        )
      const id = mine[0].bookingId
      await guard(() => withSession((session) => api.cancelBooking(session, id)))
      return { cancelled: id, roomName: target.name, start: mine[0].start, end: mine[0].end }
    },

    /** Cancel one of the person's bookings by the id `availability` gives. */
    async cancel(booking) {
      const id = String(booking ?? '').trim()
      if (!/^[\w-]{1,100}$/.test(id)) {
        throw new Refusal('BAD_REQUEST', '`booking` is a booking id from availability')
      }
      return guard(async () => {
        await withSession((session) => api.cancelBooking(session, id))
        return { cancelled: id }
      })
    },
  }
}

/**
 * A room by id, mailbox, name or number. Names compare without spaces,
 * punctuation or case, so "garage 4" finds "Garage 4 – (MuteBox)".
 */
export function resolveRoom(rooms, query) {
  const q = query.trim()
  const byKey = rooms.find((r) => r.id === q || r.email.toLowerCase() === q.toLowerCase())
  if (byKey !== undefined) return byKey
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wanted = /^\d+$/.test(q) ? `garage${q}` : norm(q)
  const exact = rooms.filter((r) => norm(r.name) === wanted)
  if (exact.length === 1) return exact[0]
  // A prefix whose number is whole: "garage1" is not "garage10".
  const hits = rooms.filter((r) => {
    const name = norm(r.name)
    const cutsNumber = /\d$/.test(wanted) && /\d/.test(name[wanted.length] ?? '')
    return name.startsWith(wanted) && !cutsNumber
  })
  if (hits.length === 1) return hits[0]
  const names = rooms.map((r) => r.name).join(', ')
  throw new Refusal(
    hits.length > 1 ? 'BAD_REQUEST' : 'NOT_FOUND',
    `${hits.length > 1 ? 'more than one room matches' : 'no room matches'} "${q}"; the rooms are ${names}`,
  )
}

/** A booking-site failure as a refusal the caller can act on. */
async function guard(work) {
  try {
    return await work()
  } catch (err) {
    if (!(err instanceof BookingError)) throw err
    const codes = {
      auth: 'UNAUTHORIZED',
      conflict: 'CONFLICT',
      rejected: 'BAD_REQUEST',
      'rate-limited': 'RATE_LIMITED',
      network: 'UNAVAILABLE',
    }
    const message =
      err.kind === 'conflict' ? `that room is already booked then (${err.message})` : err.message
    const next = err.kind === 'auth' ? SIGN_IN_AGAIN : err.kind === 'conflict' ? TAKEN : undefined
    throw new Refusal(codes[err.kind], message, next)
  }
}

// An instant names its offset; a bare local time would mean whatever zone
// this machine happens to be in.
function instant(raw, key) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') throw new Refusal('BAD_REQUEST', `\`${key}\` is required`)
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(text)) {
    throw new Refusal(
      'BAD_REQUEST',
      `\`${key}\` must be an ISO instant with an offset, like 2026-11-05T10:00:00+01:00`,
    )
  }
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) throw new Refusal('BAD_REQUEST', `\`${key}\` is not a date`)
  return d
}
