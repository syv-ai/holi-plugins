// The site's wall clock. The site speaks local times with no offset
// (`2026-11-04T09:00:00`) in its own zone; callers speak instants. Converting
// goes through `Intl`, which knows the zone's daylight saving.

const formats = new Map()

function wallParts(instant, timeZone) {
  let f = formats.get(timeZone)
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formats.set(timeZone, f)
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]))
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second }
}

/** `instant` on the zone's wall clock: `2026-11-04T09:00:00`. */
export function toLocal(instant, timeZone) {
  const p = wallParts(instant, timeZone)
  return `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}:${p.s}`
}

/** The zone's local day `instant` falls on: `2026-11-04`. */
export function localDay(instant, timeZone) {
  return toLocal(instant, timeZone).slice(0, 10)
}

/** How far the zone's wall clock is ahead of UTC at `ms`, in ms. */
function offsetAt(ms, timeZone) {
  const p = wallParts(new Date(ms), timeZone)
  const wall = Date.UTC(+p.y, +p.mo - 1, +p.d, +p.h, +p.mi, +p.s)
  return wall - (ms - (((ms % 1000) + 1000) % 1000))
}

/** A wall-clock time in the zone, as an instant. The site books 08 to 18, so
 *  the night hours a clock change skips or repeats never come up. */
export function fromLocal(local, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local)
  if (m === null) throw new Error(`not a local time: ${local}`)
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  // Guess with the offset at the wall time read as UTC, then once more with
  // the offset at that guess: two steps settle every change of offset.
  const guess = wall - offsetAt(wall, timeZone)
  return new Date(wall - offsetAt(guess, timeZone))
}
