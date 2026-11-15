// @ts-check
// The one state of a website build, from its events (runs/<id>/events.jsonl) and whether the server still
// runs it: docs/ux/states/build.md, states W3 to W14. Every screen should read this instead of working the
// state out again (an app's, a game's and a film's own states are beside it, in engine/kindstate.mjs): the Projects card does (server/projects.mjs stateOf), and so do the Design deck (the server
// sends it as `build:state` and GET /api/runs/<id>/state; web/replaytalk.js has its words) and the Overview's
// artboards (server/board.mjs `build`). It only reads: it writes no event, and an old build's file gives the
// same answer as a new one's.
//
//   planning   live, and nothing of this build's own is planned yet (W3; W6, a next version before its plan)
//   building   live, with sections of its own planned (W4)
//   done       ended, every section built (W7)
//   unchanged  a next version that ended having added and changed nothing: the last version, as it was (W9)
//   partly     ended (run:done) with sections failed or left unbuilt, and at least one section standing (W8)
//   failed     ended (run:done) with no section built at all (W8 "0 built", and an old build that planned nothing)
//   stopped    the person pressed Stop (W10), or an old file's stop that names no cause
//   halted     stopped for a cause: the model, a timeout, Hermes (W11 with sections planned, W12 with none)
//   replaced   stopped because a newer build started (W13, if its stop ever reaches the file: today it does not)
//   unsure     no end event and not live: replaced, or the server stopped mid-build (W13, W14)
//
// Sections are counted one per page and id, never per event: a section built after it failed is built, a
// failure after a section was built (a fix that failed, with or without `keep`) leaves it standing, and a
// section caught half way by Stop is unbuilt, not failed. A next version sends the last version's sections again first
// (layer:done with `kept`): those are `kept`, and `done` and `planned` count this build's own work only.
import { failuresOf } from './doctor.mjs'
import { extendBase } from './extend.mjs'
import { reasonFromFailure } from './stopreason.mjs'

/**
 * @typedef {'planning' | 'building' | 'done' | 'unchanged' | 'partly' | 'failed' | 'stopped' | 'halted' | 'replaced' | 'unsure'} BuildStateName
 * @typedef {{ code: string, message: string, action: string }} BuildReason why it stopped or failed (engine/stopreason.mjs)
 * @typedef {{ page: string, layer: string, why: string }} FailedSection
 * @typedef {object} BuildState
 * @property {BuildStateName} state
 * @property {number} done this build's own sections that are built
 * @property {number} planned this build's own sections (built, failed and still to build)
 * @property {number} kept sections carried over, built, from the last version
 * @property {FailedSection[]} failed the sections that failed and were not built later
 * @property {BuildReason | null} reason
 * @property {'resume' | 'again' | null} next the one way forward the server accepts now: Resume
 *   (/api/runs/<id>/resume) when sections are kept and something is left; Try again (/api/runs/<id>/again, the
 *   same words built afresh) when a build failed, was halted or was cut off with nothing to resume from. Set up
 *   ('setup') is not named: it is no server action.
 * @typedef {{ type: string, [key: string]: any }} RunEvent
 */

export const BUILD_STATES = /** @type {BuildStateName[]} */ (['planning', 'building', 'done', 'unchanged', 'partly', 'failed', 'stopped', 'halted', 'replaced', 'unsure'])
// the states with nobody working and something left to build
const UNFINISHED = new Set(['partly', 'failed', 'stopped', 'halted', 'replaced', 'unsure'])
// the states Try again answers, when there is nothing to resume from
const AGAIN = new Set(['failed', 'halted', 'unsure'])
const STOPPED = /^(stopped|aborted)$/i

/**
 * Is this run a plain website build? An app or game build, a game made on its own and a project brought in
 * keep their own states (engine/kindstate.mjs). A film made on a site leaves the site's build what it was, and
 * an app's design is a website build until its app is built, whether or not its start says it is an app.
 * @param {RunEvent[]} events
 */
export function isSiteBuild(events) {
  const start = events.find(e => e.type === 'run:start')
  if (!start || start.intake || (start.kind && start.kind !== 'site' && start.kind !== 'app')) return false
  return !events.some(e => typeof e.type === 'string' && (e.type.startsWith('app:') || e.type.startsWith('game:')))
}

/**
 * The state of a website build. Null when the events are not a website build (or no build at all).
 * @param {RunEvent[]} events the run's events, oldest first
 * @param {{ live?: boolean }} [opts] live: the server still runs this build (`current`, not done)
 * @returns {BuildState | null}
 */
export function buildState(events = [], { live = false } = {}) {
  if (!Array.isArray(events) || !isSiteBuild(events)) return null
  /** @type {Map<string, { status: 'planned' | 'done' | 'failed', kept: boolean }>} */
  const sections = new Map()
  for (const e of events) {
    if (e.type === 'layer:plan') {
      const key = `${e.page}/${e.id}`
      if (!sections.has(key)) sections.set(key, { status: 'planned', kept: false })
    } else if (e.type === 'layer:done') {
      sections.set(`${e.page}/${e.layer}`, { status: 'done', kept: !!e.kept })
    } else if (e.type === 'layer:failed' && !STOPPED.test(e.message || '') && !e.keep) {
      // a failure never un-builds a section: Resume builds only what has no finished HTML (engine/run.mjs resumePlan)
      const key = `${e.page}/${e.layer}`
      if (sections.get(key)?.status !== 'done') sections.set(key, { status: 'failed', kept: false })
    }
  }
  const all = [...sections.values()]
  const kept = all.filter(s => s.status === 'done' && s.kept).length
  const done = all.filter(s => s.status === 'done').length - kept
  const planned = all.length - kept
  // the failed list is Fix mode's (engine/doctor.mjs), less a fix that failed and left its section standing
  /** @type {Map<string, FailedSection>} */
  const failures = new Map()
  for (const f of failuresOf(events, { limit: Infinity })) {
    if (f.kind === 'section' && sections.get(`${f.page}/${f.layer}`)?.status === 'failed') failures.set(`${f.page}/${f.layer}`, { page: String(f.page ?? ''), layer: String(f.layer ?? ''), why: f.message })
  }
  const failed = [...failures.values()]

  // a page the planner named and never gave a section (its planner failed) is work left, too
  const bare = events.filter(e => e.type === 'page').some(p => !events.some(e => e.type === 'layer:plan' && e.page === p.id))
  const left = done < planned || bare

  const end = events.findLast(e => e.type === 'run:done' || e.type === 'run:stopped')
  const start = events.find(e => e.type === 'run:start')
  /** @type {BuildStateName} */
  let state
  /** @type {BuildReason | null} */
  let reason = null
  if (!end) state = !live ? 'unsure' : planned > 0 ? 'building' : 'planning'
  else if (end.type === 'run:stopped') {
    reason = end.reason && typeof end.reason.code === 'string' ? { code: end.reason.code, message: String(end.reason.message || ''), action: String(end.reason.action || '') } : null
    state = !reason || reason.code === 'person' ? 'stopped' : reason.code === 'replaced' ? 'replaced' : 'halted'
  } else {
    if (done + kept === 0) state = 'failed'
    else if (left) state = 'partly'
    else state = start?.extend && planned === 0 ? 'unchanged' : 'done'
  }

  // Resume is taken for any build with a theme and a page (server/server.mjs, /api/runs/<id>/resume: extendBase);
  // it is the way forward only when something is left to build. With nothing to resume from, a build that
  // failed, was halted or was cut off is tried again from its own words (/api/runs/<id>/again); one the person
  // stopped, or a newer build replaced, is not: the chat box is there.
  const base = UNFINISHED.has(state) ? extendBase(events) : null
  /** @type {'resume' | 'again' | null} */
  const next = base && left ? 'resume' : !base && AGAIN.has(state) && String(start?.brief || '').trim() ? 'again' : null
  // why a build that ran to its end is not whole: the newest failed section's own message, in the stop
  // reason's words, said for a build that ended (never "Stopped: …") and naming the way on that `next` gives
  if (end?.type === 'run:done' && failed.length) reason = reasonFromFailure(failed.at(-1)?.why, { ended: true, resume: next === 'resume' })
  return { state, done, planned, kept, failed, reason, next }
}
