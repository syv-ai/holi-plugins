// What this machine keeps: the session, a login waiting for its email, and
// the address last used to sign in. One folder in the user's own data
// directory, readable by the user alone, and never in a vault: the session is
// one person's sign-in.
//
// `bookingctl` and the plan's server are separate processes over the same
// files, and refresh tokens rotate, so everything that changes the session
// runs under one lock: two refreshes at once would spend the same token twice
// and sign the person out.
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** A lock older than this was left by a process that died holding it. */
const STALE_LOCK_MS = 60_000
/** The longest a caller waits for the lock. */
const LOCK_WAIT_MS = 30_000

export function stateDir(env = process.env, platform = process.platform) {
  if (env.MODELOKALE_HOME) return env.MODELOKALE_HOME
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'holi-modelokale')
  if (platform === 'win32')
    return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'holi-modelokale')
  return join(env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'holi-modelokale')
}

export function createStore(dir = stateDir()) {
  const file = (name) => join(dir, name)

  async function read(name) {
    try {
      return JSON.parse(await readFile(file(name), 'utf8'))
    } catch (err) {
      // Missing is nothing kept; a torn or hand-broken file is too.
      if (err.code === 'ENOENT' || err instanceof SyntaxError) return null
      throw err
    }
  }

  async function write(name, value) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    // Written beside and renamed over, so a reader never sees half a file.
    const tmp = file(`${name}.${process.pid}.tmp`)
    await writeFile(tmp, JSON.stringify(value), { mode: 0o600 })
    await rename(tmp, file(name))
  }

  const clear = (name) => rm(file(name), { force: true })

  return {
    dir,
    readSession: () => read('session.json'),
    writeSession: (s) => write('session.json', s),
    clearSession: () => clear('session.json'),
    readPending: () => read('pending-login.json'),
    writePending: (p) => write('pending-login.json', p),
    clearPending: () => clear('pending-login.json'),
    readPrefs: async () => (await read('prefs.json')) ?? {},
    writePrefs: (p) => write('prefs.json', p),

    /** Run `fn` holding the lock every process here shares. */
    async withLock(fn) {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const lock = file('lock')
      const gaveUpAt = Date.now() + LOCK_WAIT_MS
      for (;;) {
        try {
          await mkdir(lock)
          break
        } catch (err) {
          if (err.code !== 'EEXIST') throw err
          const age = await stat(lock).then(
            (s) => Date.now() - s.mtimeMs,
            () => 0,
          )
          if (age > STALE_LOCK_MS) {
            await rm(lock, { recursive: true, force: true })
            continue
          }
          if (Date.now() > gaveUpAt) {
            throw new Error('the booking sign-in is busy in another process; try again')
          }
          await new Promise((r) => setTimeout(r, 100))
        }
      }
      try {
        return await fn()
      } finally {
        await rm(lock, { recursive: true, force: true })
      }
    },
  }
}
