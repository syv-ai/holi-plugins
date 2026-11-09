// The site's room schedule, read as busy intervals. A schedule is a list of
// half-hour slots on the site's clock, each `free` or `busy`; a run of busy
// slots that share a booking is one interval.
import { fromLocal } from './clock.mjs'

/**
 * The busy slots, folded into intervals `{start, end, bookingId, title,
 * organizer, mine}` with instants as ISO strings. Consecutive busy slots that
 * share a booking are one interval. Slots with no booking id (an Outlook
 * event, another company's booking) are one interval while their title and
 * organizer stay the same, so two events back to back stay two.
 */
export function busyIntervals(slots, timeZone, me) {
  const out = []
  for (const slot of slots) {
    if (slot.status === 'free') continue
    const booking = slot.booking ?? null
    const id = booking?.id ?? null
    const title = booking?.title ?? null
    const organizer = booking?.organizer_email ?? null
    const start = fromLocal(slot.start, timeZone).toISOString()
    const end = fromLocal(slot.end, timeZone).toISOString()
    const last = out.at(-1)
    const same =
      last !== undefined &&
      last.end === start &&
      last.bookingId === id &&
      (id !== null || (last.title === title && last.organizer === organizer))
    if (same) {
      last.end = end
      continue
    }
    out.push({
      start,
      end,
      bookingId: id,
      title,
      organizer,
      mine: booking !== null && isMine(booking, me),
    })
  }
  return out
}

/**
 * The intervals with the person's own bookings at their exact times. The
 * schedule knows only half hours, so a 13:30–14:15 booking fills the 14:00
 * slot and folds out to 14:30; the site's bookings list has 14:15.
 */
export function withExactTimes(busy, exact) {
  const byId = new Map(exact.map((b) => [b.id, b]))
  return busy.map((x) => {
    const b = x.bookingId === null ? undefined : byId.get(x.bookingId)
    return b === undefined ? x : { ...x, start: b.start, end: b.end }
  })
}

// A booking is the signed-in person's by their user id or their address; an
// unknown id or address on either side matches nothing.
function isMine(booking, me) {
  if (me.userId !== '' && booking.user_id === me.userId) return true
  const organizer = booking.organizer_email ?? ''
  return organizer !== '' && organizer.toLowerCase() === me.email.toLowerCase()
}
