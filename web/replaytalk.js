// @ts-check
// Replay in words (☰ → Replay, web/canvas/replay.js). A replay is a recording of how a version was made: nothing
// is built while it plays. The owner (2026-11-14): "what does replay actually do? does it simulate and walk back
// how the app was made or does it actually build another version of the app?" So everything a replay shows says
// Replay, and the chat answers for it. Pure rules here, with tests (tests/replaytalk.test.mjs); the canvas
// (web/canvas/replay.js, rooms.js, panels.js, loop.js) only shows what these say.

/** The one word of the mark: the canvas strip and the App room's pill read it for the whole replay. */
export const REPLAY_WORD = 'Replay'

/** How far along the replay is, from 0 to 1, as the mark shows it ("42%").  @param {number} at */
export const replayPct = at => `${Math.round(Math.max(0, Math.min(1, Number(at) || 0)) * 100)}%`

/**
 * The canvas strip's words: a live build counts its agents ("3 agents building"); a replay never reads as work
 * going on, it reads Replay and how far the recording is.
 * @param {{ replay?: boolean, at?: number, state: string, working?: number, pages?: number, done?: number, total?: number }} o
 * @returns {{ text: string, num: string }}
 */
export function statusWords(o) {
  if (o.replay) return { text: REPLAY_WORD, num: replayPct(o.at || 0) }
  const n = o.working || 0
  const text = { idle: 'Ready', planning: 'Planning the pages', done: `${o.pages || 0} pages built`, working: `${n} agent${n === 1 ? '' : 's'} building`, paused: 'Stopped' }[o.state] || ''
  return { text, num: o.total ? `${o.done || 0}/${o.total}` : '' }
}

/**
 * The chat's progress line. Live: who is building and how far. In a replay: the same count, said as a record.
 * @param {{ replay?: boolean, plan?: string, working?: number, done?: number, total?: number, pages?: number }} o
 */
export function progressLine(o) {
  if (!o.total) return o.replay ? 'Replay: the pages being planned' : 'Planning the pages…'
  const far = `${o.done || 0}/${o.total} sections across ${o.pages || 0} pages`
  return o.replay ? `Replay: ${far}` : `${o.plan ? `${o.plan} ` : ''}${o.working || 0} agents building · ${far}`
}

// ---------- A website build in words, from the server's one state of it (engine/buildstate.mjs, sent to the page
// as `build:state` and with a saved build): the strip, the chat's progress line and what the chat says when a
// build ends or is opened again all read the same state, so they can not disagree. The page never works the
// state out: with none (an app, a game, the hosted studio) the words above are used as before.
/**
 * @typedef {{ state: string, done: number, planned: number, kept: number, failed: unknown[], reason: { code: string, message: string, action: string } | null, next: 'resume' | 'again' | null }} BuildState
 */
const BUILD_LIVE = new Set(['planning', 'building'])
/** every section standing, and every section there is: this build's own and the ones it was handed  @param {BuildState} b */
const sectionsOf = b => ({ built: b.done + b.kept, total: b.planned + b.kept })

/**
 * The canvas strip for a website build: the same words as `statusWords`, chosen by the build's state. While it
 * runs the count is this build's own work (a next version that has planned nothing counts nothing, never the
 * sections it was handed); once it ended, every section standing of every section there is. `state` is the
 * strip's look (the dot and the bar), `pct` the bar.
 * @param {BuildState} b  @param {{ working?: number, pages?: number }} [o]
 * @returns {{ state: 'planning' | 'working' | 'done' | 'paused', text: string, num: string, pct: number }}
 */
export function buildStrip(b, o = {}) {
  const { built, total } = sectionsOf(b), n = o.working || 0
  if (b.state === 'planning') return { state: 'planning', text: b.kept ? 'Planning what to add' : 'Planning the pages', num: '', pct: 0 }
  if (b.state === 'building') return { state: 'working', text: `${n} agent${n === 1 ? '' : 's'} building`, num: `${b.done}/${b.planned}`, pct: b.planned ? b.done / b.planned : 0 }
  const num = total ? `${built}/${total}` : '', pct = total ? built / total : 0
  if (b.state === 'done' || b.state === 'unchanged') return { state: 'done', text: `${o.pages || 0} pages built`, num, pct }
  return { state: 'paused', text: b.state === 'partly' ? 'Partly built' : b.state === 'failed' ? 'Failed' : 'Stopped', num, pct }
}

/**
 * The chat's progress line for a website build that is running: planning, then who is building and how far
 * with this build's own sections.
 * @param {BuildState} b  @param {{ plan?: string, working?: number, pages?: number }} [o]
 */
export function buildProgress(b, o = {}) {
  if (b.state !== 'building') return b.kept ? 'Planning what to add…' : 'Planning the pages…'
  return `${o.plan ? `${o.plan} ` : ''}${o.working || 0} agents building · ${b.done}/${b.planned} sections across ${o.pages || 0} pages`
}

/** Is this build still running on the server?  @param {BuildState | null | undefined} b */
export const buildLive = b => !!b && BUILD_LIVE.has(b.state)
/** Did it end, or stop, with something left to build?  @param {BuildState | null | undefined} b */
export const buildLeft = b => !!b && ['partly', 'failed', 'stopped', 'halted', 'replaced', 'unsure'].includes(b.state)

/**
 * What the chat says of a build that ended, or stopped, with something left: what is built and kept, how many
 * sections failed, and why, in the reason's own words. Never "All N pages are built" (the owner, 2026-11-15:
 * the app only says what really happened). The reason's one thing to do and the button (`next`) follow it.
 * @param {BuildState} b
 */
export function endWords(b) {
  const { built, total } = sectionsOf(b), f = b.failed.length
  const why = b.reason && b.reason.code !== 'person' ? b.reason.message : ''
  const count = !total ? '' : `${built ? `${built} of ${total} sections are built and kept` : `None of the ${total} sections are built`}${f ? `; ${f} failed` : ''}.`
  const join = (...parts) => parts.filter(Boolean).join(' ')
  // it ran to its end: what stands first, then why the rest does not
  if (b.state === 'partly' || b.state === 'failed') return join(count, why) || 'Stopped before any page was planned.'
  // nobody knows why it ended (the server stopped, or a newer build took over)
  if (b.state === 'unsure') return join('This run stopped before it finished.', count)
  // stopped for a cause: the cause, then what is kept
  if (why) return join(why, count)
  return total ? join('Stopped.', count, b.next === 'resume' ? 'Say what to change, or Resume.' : 'Say what to change.') : 'Stopped before any page was planned.'
}

/**
 * The App room's pill. Live: building, running, built… In a replay: Replay and how far, whatever the recording
 * is showing.
 * @param {{ replay?: boolean, at?: number, state?: string, url?: string | null, hasApp?: boolean, kind?: string }} o
 */
export function appPill(o) {
  if (o.replay) return `${REPLAY_WORD} ${replayPct(o.at || 0)}`
  const st = o.state
  return st === 'working' ? 'building' : st === 'done' ? (o.url ? 'running' : 'built') : st === 'failed' ? 'failed' : st === 'stopped' ? 'stopped' : st === 'paused' ? 'your turn' : o.hasApp ? 'built' : o.kind === 'game' ? 'no game yet' : 'no app yet'
}

export const REPLAY_SAYS = {
  // asked while one plays: "is this building?", "what is this?"
  what: 'This is a replay of how this version was made. Nothing is being built. Say “stop” to end it.',
  // asked with none playing: "what does replay do?"
  about: 'A replay plays back how this version was made, from its saved record. Nothing is built. Say “replay” to watch it.',
  stopped: 'Stopped the replay. The finished version is back.',
  // something else was asked for while one played: it ends first, and the chat says so
  first: 'Stopped the replay first.',
  none: 'There is no finished version here to replay yet.',
  idle: 'No replay is playing.'
}

const RP_STOP = /^(?:please )?(?:stop|end|quit|exit|cancel|close|leave)(?: it| this| that| the replay| replay| replaying| the recording)?(?: please| now)?$/
const RP_START = /^(?:please )?(?:replay|replay (?:it|this|that|the build|this build|this version|the version)|(?:play|show|watch|see|start|run)(?: me)?(?: the| a)? replay|play (?:it|this|the build) (?:back|again)|watch (?:it|this|the build) (?:again|being (?:built|made)))(?: please| again)?$/
const RP_ASKS = /^(?:is|are|was|were|what|whats|what's|why|how|does|did|do|am|can|will|wait)\b/
const RP_ABOUT = /\b(?:replay\w*|record\w*|build\w*|built|rebuil\w*|live|real|really|simulat\w*|fake|happening|going on|doing|making|made|another version|new version|again)\b|\bwhat(?:'s| is|s) (?:this|that|it)\b|\bwhat am i\b/

/**
 * Where a typed message goes because of a replay, before any other route of the chat.
 * `on`: a replay is playing. While one plays: "stop" ends it, a question about what is on screen ("is this
 * building?", "what is this?") gets the one true line, "replay" is answered the same way, and anything else
 * ('first') ends the replay before the chat does what was asked. With none playing: "replay" starts one, a
 * question about replay is answered, "stop replay" says none is playing, and every other message is not a
 * replay's business (null).
 * @param {string} text  @param {boolean} on
 * @returns {'stop' | 'what' | 'start' | 'about' | 'idle' | 'first' | null}
 */
export function replayAsk(text, on) {
  const raw = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const t = raw.replace(/[.!?]+$/, '')
  if (!t) return null
  const asks = raw.endsWith('?') || RP_ASKS.test(t)
  if (on) {
    if (RP_STOP.test(t)) return 'stop'
    if (RP_START.test(t)) return 'what'
    if (asks && RP_ABOUT.test(t)) return 'what'
    return 'first'
  }
  if (RP_START.test(t)) return 'start'
  if (/\breplay\w*\b/.test(t) && RP_STOP.test(t)) return 'idle'
  if (asks && /\breplay\w*\b/.test(t)) return 'about'
  return null
}
