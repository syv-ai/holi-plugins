# Mødelokale Booking

Books the office's meeting rooms (Garage 1–6 at
[booking.birdsatfive.dk](https://booking.birdsatfive.dk)) from Holi. You get two things:

- **A room plan in a tab.** Any `*.booking` file opens as the rooms laid out as a plan, free or
  busy for the slot you pick. Booking takes one button, and your own bookings get a Cancel button
  that asks once more before it cancels. `bookingctl plan` creates `Rooms.local.booking` in the
  vault.
- **`bookingctl` for the vault's agent**, with the `meeting-rooms` skill:
  `status`, `login`, `finish`, `logout`, `rooms`, `availability`, `book`, `cancel` and `plan`.
  Each call asks for permission like any other command until you allow it.

It needs Node 20.19 or newer on Holi's `PATH`, and nothing else: there is no setup step and no
dependencies.

## Signing in

The site signs people in with an emailed login link. `bookingctl login <email>`, or the plan's
**Send login link**, asks the site for that email with a PKCE challenge. The challenge's verifier
stays on this machine, so a forwarded or intercepted link signs no one in. Paste the link into the
plan, or hand it to `bookingctl finish '<link>'`. The agent can also find the email itself with
`holi google`.

The sign-in is per machine, shared by the plan and `bookingctl`, and never in a vault:

| OS      | Folder                                                    |
| ------- | --------------------------------------------------------- |
| macOS   | `~/Library/Application Support/holi-modelokale/`          |
| Linux   | `$XDG_STATE_HOME/holi-modelokale/` (`~/.local/state/...`) |
| Windows | `%APPDATA%\holi-modelokale\`                              |

`MODELOKALE_HOME` overrides the folder. Its files are readable by you alone (mode 600), and are
not otherwise encrypted. Holi's readiness check reads them, so the plugin's row in Settings says
when you are not signed in.

## How it talks to the site

- **Rooms** come from the site's Supabase data API (`/rest/v1`), with the site's public `anon`
  key that its login page ships to every browser.
- **Schedules, bookings and cancellations** go through the routes the site's own pages call
  (`/api/rooms/{id}/schedule`, `/api/bookings`), with your session as the site's cookie. A
  booking made this way also lands in the room's Outlook calendar.
- **Times:** the site speaks its own wall clock (`Europe/Oslo`, Copenhagen's time), which
  `lib/clock.mjs` converts with `Intl`. `book` takes instants with an offset, never a bare local
  time.
- **Exact times:** the schedule knows only half hours, so your own bookings take their exact times
  from your bookings list.
- **Token refresh:** access tokens refresh five minutes before they run out, under a lock the
  plan's server and `bookingctl` share, because refresh tokens rotate.
- **A session the site ends early:** when the site says to sign in again before the token runs
  out, the plugin refreshes once and retries the call. If the site refuses the refresh, or refuses
  the renewed session too, the sign-in is dropped on this machine. So `bookingctl status` and
  Holi's readiness check, which read only this machine's files, say signed out after that call.

## The plan's server

Holi starts `node lib/serve.mjs --port <port>` for an opened `*.booking` file and frames it. The
server answers only its own page. A call must:

- name the server as its `Host`;
- come from its own origin when it states one;
- be a JSON `POST` carrying `X-Modelokale: 1`.

So another web page on this machine cannot use your sign-in.

## Not verified

- **Answers to a booking and a cancel:** any 2xx counts as done, and the body is not read. A site
  that answered 2xx without acting would go unnoticed until the next look.

## Code

- `lib/site.mjs`: the site's origin, public key and time zone.
- `lib/api.mjs`: the HTTP client, with no state.
- `lib/clock.mjs`: the site's wall clock.
- `lib/schedule.mjs`: folding slots into busy intervals.
- `lib/store.mjs`: this machine's files and their lock.
- `lib/auth.mjs`: PKCE sign-in and refresh.
- `lib/booking.mjs`: the operations both doors use.
- `lib/cli.mjs` and `bin/bookingctl`: the agent's command.
- `lib/serve.mjs` and `web/`: the plan.

`npm test` runs the tests in `test/` with Node's own runner; they never reach the site.
