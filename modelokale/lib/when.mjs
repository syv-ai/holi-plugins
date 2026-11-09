// When a booking is, from what a person types: a start on the office's clock
// (`--at 13:00`, or `now`), a length (`--for 15m`, 30 minutes when left out)
// and a day (`--on fri`, today when left out). The office's clock is the
// site's zone, so `13:00` is 13:00 at the office in winter and summer alike,
// whatever zone this machine is in.
import { fromLocal, localDay } from './clock.mjs'
import { PAST_SLACK_MS, Refusal } from './booking.mjs'

/** How long a booking runs when no length is given. */
export const DEFAULT_LENGTH_MS = 30 * 60_000

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_MS = 24 * 60 * 60_000

/** `YYYY-MM-DD` moved by `days`. */
function addDays(day, days) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

const weekdayOf = (day) => new Date(`${day}T00:00:00Z`).getUTCDay()

/**
 * The office's day `on` names: a date, `today`, `tomorrow`, or a weekday
 * (`fri`, `friday`), the next one from today with today included.
 */
export function dayOf(on, { now, timeZone }) {
  const today = localDay(new Date(now), timeZone)
  const text = String(on ?? 'today')
    .trim()
    .toLowerCase()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  if (text === 'today') return today
  if (text === 'tomorrow') return addDays(today, 1)
  const weekday = text.length < 3 ? -1 : WEEKDAYS.findIndex((w) => w.startsWith(text))
  if (weekday >= 0) return addDays(today, (weekday - weekdayOf(today) + 7) % 7)
  throw new Refusal(
    'BAD_REQUEST',
    `\`--on\` is a date (2026-11-12), today, tomorrow or a weekday (fri), not "${on}"`,
  )
}

/** `13:00`, `13.00`, `9:30` or `13`, as `HH:MM`. */
function clockTime(at) {
  const m = /^([01]?\d|2[0-3])(?:[:.]([0-5]\d))?$/.exec(String(at ?? '').trim())
  if (m === null)
    throw new Refusal('BAD_REQUEST', `\`--at\` is a time on the office's clock, like 13:00, or now`)
  return `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`
}

/** `15m`, `15min`, `1h`, `1h30m` or a bare `45` (minutes), in ms. */
export function lengthOf(length) {
  if (length === undefined || length === null) return DEFAULT_LENGTH_MS
  const m = /^(?:(\d+)h)?(?:(\d+)(?:m|min)?)?$/.exec(String(length).trim().toLowerCase())
  const minutes = m === null ? 0 : Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
  if (minutes <= 0)
    throw new Refusal(
      'BAD_REQUEST',
      `\`--for\` is a length, like 15m, 1h or 1h30m, not "${length}"`,
    )
  return minutes * 60_000
}

/** When `at` on `on` is, as an instant: a time or `now`, today unless `on`
 *  names another day. */
export function startOf({ at, on }, { now, timeZone }) {
  if (
    String(at ?? '')
      .trim()
      .toLowerCase() === 'now'
  ) {
    if (on !== undefined) throw new Refusal('BAD_REQUEST', '`--at now` takes no `--on`')
    return new Date(Math.floor(now / 60_000) * 60_000)
  }
  return fromLocal(`${dayOf(on, { now, timeZone })}T${clockTime(at)}`, timeZone)
}

/**
 * A booking's start and end, `length` after it (30 minutes when left out).
 * A time today that has already passed is refused rather than moved to
 * another day, so a booking never lands on a day nobody named.
 */
export function bookingTime({ at, length, on }, clock) {
  const ms = lengthOf(length)
  const start = startOf({ at, on }, clock)
  if (on === undefined && start.getTime() < clock.now - PAST_SLACK_MS)
    throw new Refusal(
      'BAD_REQUEST',
      `${clockTime(at)} has passed today`,
      'add --on tomorrow, or --on <weekday or date>, for another day',
    )
  return { start, end: new Date(start.getTime() + ms) }
}
