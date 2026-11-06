// `bookingctl`: the meeting rooms for the vault's agent. Prints text, or JSON
// with --json. Exit 0 is done, 1 a refusal (its reason, and what to do next,
// on stderr), 2 a command this does not know.
import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createBooking, Refusal } from './booking.mjs'

/** The file the plan opens from: `.local.` so it stays on this machine, as
 *  the sign-in does, and never syncs to members without the plugin. */
export const PLAN_FILE = 'Rooms.local.booking'

const USAGE = `bookingctl: see, book and cancel the office meeting rooms (booking.birdsatfive.dk)

  bookingctl status                      signed in? as whom
  bookingctl login <email>               email a login link
  bookingctl finish '<link>'             sign in with the link from that email
  bookingctl logout                      sign out on this machine
  bookingctl rooms                       name, mailbox, id
  bookingctl availability [YYYY-MM-DD]   every room's busy times that day (today)
  bookingctl book <room> <start> <end> [title]
                                         start and end are ISO instants with an offset
  bookingctl cancel <booking id>         one of your own bookings
  bookingctl plan [vault folder]         create ${PLAN_FILE}, the room plan

Add --json for JSON.`

export async function main(argv, deps = {}) {
  const out = deps.out ?? ((s) => process.stdout.write(`${s}\n`))
  const err = deps.err ?? ((s) => process.stderr.write(`${s}\n`))
  const json = argv.includes('--json')
  const check = argv.includes('--check')
  const [verb, ...args] = argv.filter((a) => a !== '--json' && a !== '--check')
  const booking = deps.booking ?? createBooking()
  const print = (value, text) => out(json ? JSON.stringify(value, null, 2) : text(value))

  try {
    switch (verb) {
      case 'status': {
        const s = await booking.status()
        // The readiness check Holi runs: signed in or not, from this
        // machine's files alone, with nothing printed.
        if (check) return s.signedIn ? 0 : 1
        print(s, (v) =>
          v.signedIn
            ? `signed in to ${v.site} as ${v.email}`
            : v.loginSentTo
              ? `not signed in; a login link was emailed to ${v.loginSentTo}: run bookingctl finish '<link>'`
              : `not signed in to ${v.site}: run bookingctl login <email>`,
        )
        return 0
      }
      case 'login': {
        const s = await booking.login(args[0])
        print(
          s,
          (v) =>
            `a login link was emailed to ${v.loginSentTo}. Pass the link from that email to: bookingctl finish '<link>'`,
        )
        return 0
      }
      case 'finish': {
        const s = await booking.finish(args[0])
        print(s, (v) => `signed in to ${v.site} as ${v.email}`)
        return 0
      }
      case 'logout': {
        const s = await booking.logout()
        print(s, () => 'signed out of the booking site on this machine')
        return 0
      }
      case 'rooms': {
        const rooms = await booking.rooms()
        print(rooms, (v) => v.map((r) => `${r.name}\t${r.email}\t${r.id}`).join('\n'))
        return 0
      }
      case 'availability': {
        const a = await booking.availability(args[0])
        print(a, (v) => availabilityText(v, booking.clock))
        return 0
      }
      case 'book': {
        const [room, start, end, ...title] = args
        const made = await booking.book({
          room,
          start,
          end,
          ...(title.length > 0 ? { title: title.join(' ') } : {}),
        })
        print(
          made,
          (v) =>
            `booked ${v.roomName}, ${booking.clock(v.start)}–${booking.clock(v.end)} on ${v.day}`,
        )
        return 0
      }
      case 'cancel': {
        const r = await booking.cancel(args[0])
        print(r, (v) => `cancelled booking ${v.cancelled}`)
        return 0
      }
      case 'plan': {
        const path = await createPlan(args[0] ?? process.env.HOLI_VAULT_ROOT ?? process.cwd())
        print({ path }, (v) => `the room plan is ${v.path}: open it in Holi's file tree`)
        return 0
      }
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        out(USAGE)
        return verb === undefined ? 2 : 0
      default:
        err(`bookingctl: no command "${verb}"\n\n${USAGE}`)
        return 2
    }
  } catch (e) {
    if (!(e instanceof Refusal)) {
      err(`error: ${e.message}`)
      return 1
    }
    if (json) err(JSON.stringify({ code: e.code, message: e.message, next: e.next }))
    else err(`error (${e.code}): ${e.message}${e.next ? `\nnext: ${e.next}` : ''}`)
    return 1
  }
}

function availabilityText(a, clock) {
  const lines = a.rooms.map((r) => {
    if (r.busy.length === 0) return `${r.name}\tfree all day`
    const busy = r.busy.map((b) => {
      const yours = b.mine ? ` (yours${b.bookingId ? `, id ${b.bookingId}` : ''})` : ''
      return `${clock(b.start)}–${clock(b.end)}${yours}`
    })
    return `${r.name}\tbusy ${busy.join(', ')}`
  })
  return [`${a.day} (times on the office's clock)`, ...lines].join('\n')
}

/** Create the plan's file in a vault, once; an existing one is left as is. */
async function createPlan(folder) {
  const vault = resolve(folder)
  if (!existsSync(join(vault, '.holi'))) {
    throw new Refusal('BAD_REQUEST', `${vault} is not a Holi vault: give the vault's folder`)
  }
  const path = join(vault, PLAN_FILE)
  await writeFile(
    path,
    'This file opens as the meeting-room plan in Holi, with the Mødelokale Booking plugin.\n',
    { flag: 'wx' },
  ).catch((e) => {
    if (e.code !== 'EEXIST') throw e
  })
  return path
}
