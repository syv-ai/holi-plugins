// Signing in to the booking site, and staying signed in.
//
// The site signs people in with an emailed login link. This plugin asks for
// that email itself with a PKCE challenge, and keeps the verifier on this
// machine, so the link is useless to anyone else: a forwarded or intercepted
// link signs no one in. Handing the link (or a code, for a template that sends
// one) to `finish` stores the session; `session()` refreshes it on use.
import { createHash, randomBytes } from 'node:crypto'
import { BookingError } from './api.mjs'

/** Refresh this long before the access token runs out: well before the
 *  site's own client would (it renews inside 90 seconds). A site that renewed
 *  first would rotate the refresh token in a cookie this plugin never reads,
 *  and the next refresh, with the old one, would sign the person out. */
const REFRESH_EARLY_MS = 5 * 60_000
/** A login email's link is good for as long as the site's: an hour. */
const PENDING_MS = 60 * 60_000

export function createAuth({ api, store, now = Date.now }) {
  return {
    /** The signed-in person, or null. */
    async current() {
      const held = await store.readSession()
      return held === null ? null : { email: held.email, userId: held.userId }
    },

    /** The login email in flight, if any. */
    async pending() {
      const p = await store.readPending()
      return p !== null && now() - p.sentAt < PENDING_MS
        ? { email: p.email, sentAt: p.sentAt }
        : null
    },

    /** Ask the site to email a login link. */
    async start(email) {
      const verifier = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      await api.sendLoginEmail(email, challenge)
      const sentAt = now()
      await store.withLock(async () => {
        await store.writePending({ email, verifier, sentAt })
        await store.writePrefs({ ...(await store.readPrefs()), email })
      })
      return { email, sentAt }
    },

    /** Finish with what the email carried: its link, or a one-time code. */
    async finish(input) {
      const text = String(input).trim()
      return store.withLock(async () => {
        const p = await store.readPending()
        // Asked before a link is followed, which spends it.
        if (p === null || now() - p.sentAt >= PENDING_MS) {
          throw new BookingError(
            'auth',
            'no login is waiting on this machine: send a login email first (bookingctl login <email>)',
          )
        }
        const tokens = /^\d{6,10}$/.test(text)
          ? await api.verifyCode(p.email, text)
          : await api.exchangeCode((await api.followLoginLink(text)).code, p.verifier)
        const kept = { ...tokens, email: tokens.email || p.email }
        await store.writeSession(kept)
        await store.clearPending()
        return { email: kept.email }
      })
    },

    /** The session, refreshed when its access token is about to run out.
     *  Throws `BookingError('auth')` when nobody is signed in. */
    async session() {
      const held = await store.readSession()
      if (held === null) throw new BookingError('auth', 'not signed in to the booking site')
      if (held.expiresAt - now() > REFRESH_EARLY_MS) return held
      return store.withLock(async () => {
        // Read again under the lock: another process may have renewed it, or
        // signed out, while this one waited.
        const cur = await store.readSession()
        if (cur === null) throw new BookingError('auth', 'not signed in to the booking site')
        if (cur.expiresAt - now() > REFRESH_EARLY_MS) return cur
        try {
          const renewed = await api.refresh(cur.refreshToken)
          const kept = { ...renewed, email: renewed.email || cur.email }
          await store.writeSession(kept)
          return kept
        } catch (err) {
          // A site not answering, or asking to wait, leaves the session be.
          if (!(err instanceof BookingError)) throw err
          if (err.kind === 'network' || err.kind === 'rate-limited') throw err
          await store.clearSession()
          throw new BookingError('auth', `the booking sign-in has ended (${err.message})`)
        }
      })
    },

    /** Forget the session here, and tell the site, which may not answer. */
    async signOut() {
      const held = await store.withLock(async () => {
        const h = await store.readSession()
        await store.clearSession()
        await store.clearPending()
        return h
      })
      if (held !== null) await api.signOut(held.accessToken).catch(() => {})
    },
  }
}
