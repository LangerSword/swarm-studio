// @ts-check
// The one state of everything a build can be besides a website: an app, a game, a film
// (docs/ux/states/build.md, states A1 to A7 and F1 to F6). It sits beside the website's
// (engine/buildstate.mjs) and has the same shape, { state, …, reason, next }, so every screen reads it instead
// of working the state out again: the Projects card (server/projects.mjs stateOf), the Overview's App, Game
// and Film artboards (server/board.mjs `parts`), and the App, Game and Film rooms (sent with the website's
// state as `parts`: `build:state` on the stream and GET /api/runs/<id>/state). It only reads: it writes no
// event, and an old build's file gives the same answer as a new one's.
//
// What a build is (`kind`) comes from its own facts at its start, never from whether something finished: a game
// says so (run:start kind, or its spec), a film run says so, and an app is an app from the start when the run
// or its brief says so (`piece`, engine/naming.mjs pieceKind) or once an app build was asked for.
//
// An app or a game:
//   designed  nothing built yet: no app build was ever started (A1). For an app: designed, not built
//   building  the engine is at work, here or in another Studio on the same runs folder (A2, A3)
//   waiting   a big game stopped after a slice and asks the person: their turn (A4)
//   built     the last build finished (A5)
//   failed    the last build failed (A6)
//   stopped   the person stopped it, or the Studio that ran it went away (A7)
//
// A film (null when none was ever asked for, F1):
//   making    being made (F2)
//   done      made (F3)
//   failed    it failed, or the Studio restarted before it finished (F4, F6)
//   stopped   the person stopped it (F5)
import { buildState } from './buildstate.mjs'
import { reasonFromFailure } from './stopreason.mjs'

/**
 * @typedef {'site' | 'app' | 'game' | 'film'} Kind
 * @typedef {'designed' | 'building' | 'waiting' | 'built' | 'failed' | 'stopped'} AppStateName
 * @typedef {'making' | 'done' | 'failed' | 'stopped'} FilmStateName
 * @typedef {{ code: string, message: string, action: string }} Reason
 * @typedef {object} AppState
 * @property {'app' | 'game'} kind
 * @property {AppStateName} state
 * @property {string} stage the step the engine is on, while building
 * @property {[number, number] | null} at a big game's stage, x of y
 * @property {boolean} hasApp a build finished once: there is an app to open and to change
 * @property {Reason | null} reason why it failed, in plain words
 * @property {string} detail the engine's own message, for "Show details"
 * @property {'build' | 'again' | 'resume' | null} next the one way forward POST /api/runs/<id>/app takes now
 *   with no words of the person's: Build (a first build), Try again (a first build that failed), Go on (a
 *   build stopped part way, or a game waiting after a slice). Null where it needs their words (a change that
 *   failed: "say what to change") or would be refused.
 * @typedef {object} FilmState
 * @property {FilmStateName} state
 * @property {number} pct
 * @property {string} stage
 * @property {Reason | null} reason
 * @property {'again' | null} next Try again: POST /api/runs/<id>/video makes it again
 * @typedef {{ type: string, [key: string]: any }} RunEvent
 */

export const APP_STATES = /** @type {AppStateName[]} */ (['designed', 'building', 'waiting', 'built', 'failed', 'stopped'])
export const FILM_STATES = /** @type {FilmStateName[]} */ (['making', 'done', 'failed', 'stopped'])
/** the events that can change an app's, a game's or a film's state */
export const KIND_EVENTS = new Set(['app:start', 'app:done', 'app:failed', 'app:paused', 'video:start', 'video:done', 'video:failed'])
const APP_ENDS = ['app:start', 'app:done', 'app:failed', 'app:paused']
const FILM_ENDS = ['video:start', 'video:done', 'video:failed']
/** what the server writes for a film cut off by a restart (server/server.mjs) */
export const FILM_CUT_OFF = 'Swarm Studio restarted before the video finished. Make it again.'
// a failure the stop reasons can read (engine/stopreason.mjs): a model call, a timeout, Hermes away
const KNOWN = /HTTP \d{3}|Hermes|hermes_(closed|updated)|timed? ?out|took too long|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|other side closed|terminated/i
const firstLine = (text, n) => String(text || '').split('\n')[0].replace(/(\/[\w.@-]+){3,}/g, m => `…/${m.split('/').slice(-2).join('/')}`).replace(/\s+/g, ' ').trim().slice(0, n)

/**
 * What a build is, from its own facts. `piece`: what the run or its brief says it is (engine/naming.mjs
 * pieceKind, with the run's meta). Null with no run:start.
 * @param {RunEvent[]} events  @param {{ piece?: string | null }} [opts]
 * @returns {Kind | null}
 */
export function kindOf(events = [], { piece = null } = {}) {
  const start = events.find(e => e.type === 'run:start')
  if (!start) return null
  if (start.kind === 'game' || events.some(e => e.type === 'game:spec')) return 'game'
  if (start.kind === 'film') return 'film'
  if (start.kind === 'app' || piece === 'app' || events.some(e => APP_ENDS.includes(e.type) || e.type === 'app:ready')) return 'app'
  return 'site'
}

/**
 * Why an app, game or film failed, in plain words: the stop reasons' own (engine/stopreason.mjs) when the
 * message is a model call, a timeout or Hermes; else the message's first line, or `fallback`.
 * @param {string} message  @param {{ code: string, fallback: string, n?: number }} o
 * @returns {Reason}
 */
function reasonOf(message, { code, fallback, n = 220 }) {
  if (KNOWN.test(String(message || ''))) return reasonFromFailure(message, { ended: true })
  return { code, message: firstLine(message, n) || fallback, action: '' }
}

/**
 * The state of an app or a game build. Null when the run is neither.
 * @param {RunEvent[]} events the run's events, oldest first
 * @param {{ kind?: Kind | null, working?: boolean, stage?: string, alive?: (pid: number) => boolean, self?: number, now?: number }} [opts]
 *   working: this server's own job is at work on it. alive, self: is a process alive, and this server's own
 *   (a build another Studio drives names its process). now: the clock, for a build that names none.
 * @returns {AppState | null}
 */
export function appState(events = [], { kind = kindOf(events), working = false, stage = '', alive = () => false, self = 0, now = Date.now() } = {}) {
  if (!Array.isArray(events) || (kind !== 'app' && kind !== 'game')) return null
  const start = events.find(e => e.type === 'run:start')
  const last = events.findLast(e => APP_ENDS.includes(e.type))
  const texts = events.filter(e => e.type === 'app:step').map(e => String(e.step?.text ?? ''))
  const m = texts.findLast(t => /^stage \d+ of \d+/.test(t))?.match(/^stage (\d+) of (\d+)/)
  const at = m ? /** @type {[number, number]} */ ([Number(m[1]), Number(m[2])]) : null
  const hasApp = events.some(e => e.type === 'app:done')
  /** @type {AppStateName} */
  let state
  if (working) state = 'building'
  else if (!last) state = 'designed'
  // a build left at its start: another Studio's while its process lives (one that names none, while its log
  // still moved in the last twenty minutes, as engine/appjob.mjs reads it), else it stopped
  else if (last.type === 'app:start') state = (last.pid ? last.pid !== self && alive(last.pid) : now - (events.at(-1)?.t || 0) < 20 * 60e3) ? 'building' : 'stopped'
  else if (last.type === 'app:paused') state = 'waiting'
  else if (last.type === 'app:done') state = 'built'
  else state = last.message === 'stopped' ? 'stopped' : 'failed'
  const detail = state === 'failed' ? String(last?.message || '') : ''
  const reason = state === 'failed' ? reasonOf(detail, { code: 'engine', fallback: 'The engine stopped before the app built.' }) : null
  // what POST /api/runs/<id>/app takes with nothing typed (engine/appjob.mjs startRefusal): never a project
  // brought in; a first build needs a built section (an app) or the saved spec (a game); a change needs words
  const can = !start?.intake && !hasApp && (kind === 'game' ? events.some(e => e.type === 'game:spec') : events.some(e => e.type === 'layer:done' && e.html))
  const next = !can ? null : state === 'designed' ? 'build' : state === 'failed' ? 'again' : state === 'stopped' || state === 'waiting' ? 'resume' : null
  return { kind, state, stage: state === 'building' ? String(stage || texts.at(-1) || '').slice(0, 200) : '', at, hasApp, reason, detail, next }
}

/**
 * The state of a build's film. Null when no film was ever asked for.
 * @param {RunEvent[]} events
 * @param {{ job?: { state?: string, pct?: number, stage?: string } | null }} [opts] job: this server's own film job
 * @returns {FilmState | null}
 */
export function filmState(events = [], { job = null } = {}) {
  if (!Array.isArray(events)) return null
  const last = events.findLast(e => FILM_ENDS.includes(e.type))
  if (job?.state === 'working') return { state: 'making', pct: Number(job.pct) || 0, stage: String(job.stage || ''), reason: null, next: null }
  if (!last) return null
  if (last.type === 'video:done') return { state: 'done', pct: 100, stage: '', reason: null, next: null }
  const start = events.find(e => e.type === 'run:start')
  // what POST /api/runs/<id>/video takes: a film run, or a build with a section built
  const next = start?.kind === 'film' || events.some(e => e.type === 'layer:done') ? 'again' : null
  if (last.type === 'video:failed' && last.message === 'stopped') return { state: 'stopped', pct: 0, stage: '', reason: null, next }
  // left at its start with nobody making it: the Studio that made it went away
  const message = last.type === 'video:start' ? FILM_CUT_OFF : String(last.message || '')
  const reason = message === FILM_CUT_OFF ? { code: 'restart', message, action: '' } : reasonOf(message, { code: 'film', fallback: 'The film did not finish.', n: 160 })
  return { state: 'failed', pct: 0, stage: '', reason, next }
}

/**
 * Every part of a build, each with its one state: `site` (engine/buildstate.mjs; null once an app or a game
 * was built on it, or for a game or a project brought in), `app` or `game`, and `film`.
 * @param {RunEvent[]} events
 * @param {{ live?: boolean, piece?: string | null, working?: boolean, stage?: string, film?: object | null, alive?: (pid: number) => boolean, self?: number, now?: number }} [opts]
 * @returns {{ kind: Kind | null, site: import('./buildstate.mjs').BuildState | null, app: AppState | null, game: AppState | null, film: FilmState | null }}
 */
export function kindState(events = [], { live = false, piece = null, film = null, ...job } = {}) {
  const kind = kindOf(events, { piece })
  const made = appState(events, { kind, ...job })
  return { kind, site: buildState(events, { live }), app: kind === 'app' ? made : null, game: kind === 'game' ? made : null, film: filmState(events, { job: /** @type {any} */ (film) }) }
}
