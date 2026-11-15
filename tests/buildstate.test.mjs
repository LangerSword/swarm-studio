// node --test tests/buildstate.test.mjs
// One state per website build (engine/buildstate.mjs, docs/ux/states/build.md W3 to W14), and the Projects
// card reads it (server/projects.mjs stateOf): a build with failed sections never reads Designed.
// The logs are shaped as engine/run.mjs and server/server.mjs write them (run:start, page, layer:plan with
// `id`, layer:done and layer:failed with `layer`, run:done / run:stopped with the counts and the reason).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildState, BUILD_STATES, isSiteBuild } from '../engine/buildstate.mjs'
import { carryEvents } from '../engine/extend.mjs'
import { reasonFromAbort, reasonFromFailure } from '../engine/stopreason.mjs'
import { stateOf } from '../server/projects.mjs'
import { cardOf, differences, oldStateOf } from '../scripts/build-state-diff.mjs'
import { working } from '../ui/src/screens/projects/model.ts'

const RUN = '2026-11-01T10-00-00-000Z'
const AGENTS = [{ id: 'a0', name: 'Ada', color: '#d4d4d8' }, { id: 'a1', name: 'Bo', color: '#a1a1aa' }]
const HTTP500 = 'cb/deepseek-v4.1-flash: HTTP 500 {"error":"no model here"}'
const PAGES = [['home', 'Cedar Cafe'], ['menu', 'Menu'], ['visit', 'Visit']]
const ROLES = ['hero', 'features', 'footer']
let clock = 1000
const ev = (type, data = {}) => ({ type, t: (clock += 10), run: RUN, ...data })
const start = (more = {}) => ev('run:start', { brief: 'Cedar Cafe, a small cafe with a menu and opening hours', agents: AGENTS, plannerModel: 'planner', workerModel: 'worker', paint: false, ...more })
const theme = () => ev('theme', { name: 'Plain', direction: '', vars: { '--background': '#111111', '--foreground': '#eeeeee', '--primary': '#e4e4e7' } })
const plan = (pages = PAGES) => [theme(), ...pages.map(([id, title], index) => ev('page', { id, title, purpose: '', index })),
  ...pages.flatMap(([page]) => ROLES.map((role, j) => ev('layer:plan', { page, id: role, role, height: j ? 520 : 760, links: [] }))),
  ev('plan:done', { ms: 50, pages: pages.length, layers: pages.length * ROLES.length })]
const built = (page, layer, more = {}) => [ev('agent:assign', { agent: 'a0', page, layer, role: layer }), ev('layer:done', { page, layer, agent: 'a0', ms: 400, done: 1, planned: 9, html: `<section>${page} ${layer}</section>`, ...more })]
const broke = (page, layer, message = HTTP500) => [ev('agent:assign', { agent: 'a1', page, layer, role: layer }), ev('layer:failed', { page, layer, agent: 'a1', message })]
const every = (fn, pages = PAGES) => pages.flatMap(([page]) => ROLES.flatMap(role => fn(page, role)))
const done = (counts, more = {}) => ev('run:done', { ms: 7200, pages: 3, ...counts, ...more })
const stopped = (counts, reason) => ev('run:stopped', { ms: 4400, pages: 3, ...counts, stopped: true, ...(reason ? { reason } : {}) })
// a finished first version, and what the next version sends again before it plans anything (engine/run.mjs:123)
const first = () => [start(), ...plan(), ...every(built), done({ planned: 9, done: 9, failed: 0 })]
const next = (from, more = {}) => [start({ extend: true, ask: 'add a gift page', kept: 3, ...more }), ...carryEvents(from).map(c => ev(c.type, c.data))]
// the first five sections built, the last four failed (the walkthrough's failing build: the model answers 500)
const five = () => every((p, r) => (p === 'home' || (p === 'menu' && r !== 'footer') ? built(p, r) : broke(p, r)))
const half = () => every((p, r) => (p === 'home' ? built(p, r) : []))

// name, the log, live, then what must be true: the state, the counts, the way forward and the card's word
const CASES = [
  ['every section done (W7)', first(), false, { state: 'done', done: 9, planned: 9, kept: 0, failed: 0, next: null, reason: null, word: 'Designed' }],
  ['some sections failed (W8)', [start(), ...plan(), ...five(), done({ planned: 9, done: 5, failed: 4 })], false, { state: 'partly', done: 5, planned: 9, kept: 0, failed: 4, next: 'resume', reason: 'model', word: 'Partly built' }],
  ['all failed, 0 built (W8)', [start(), ...plan(), ...every(broke), done({ planned: 9, done: 0, failed: 9 })], false, { state: 'failed', done: 0, planned: 9, kept: 0, failed: 9, next: 'resume', reason: 'model', word: 'Failed', empty: true }],
  ['a section failed, then was built', [start(), ...plan(), ...every(built).slice(2), ...broke('home', 'hero'), ...built('home', 'hero', { fixed: true }), done({ planned: 9, done: 9, failed: 1 })], false, { state: 'done', done: 9, planned: 9, kept: 0, failed: 0, next: null, reason: null, word: 'Designed' }],
  ['a fix failed and the old section stays', [...first(), ev('layer:reset', { page: 'home', layer: 'hero', agent: 'a0' }), ev('layer:failed', { page: 'home', layer: 'hero', agent: 'a0', message: HTTP500, keep: '<section>home hero</section>' })], false, { state: 'done', done: 9, planned: 9, kept: 0, failed: 0, next: null, word: 'Designed' }],
  ['a built section whose later pass failed with nothing kept', [start(), ...plan(), ...every(built), ev('layer:failed', { page: 'menu', layer: 'hero', agent: 'a1', message: HTTP500 }), done({ planned: 9, done: 9, failed: 1 })], false, { state: 'done', done: 9, planned: 9, kept: 0, failed: 0, next: null, reason: null, word: 'Designed' }],
  ['a next version before its plan, live (W6)', next(first()), true, { state: 'planning', done: 0, planned: 0, kept: 9, failed: 0, next: null, word: 'Designed' }],
  ['a next version building a new page, live', [...next(first()), ev('page', { id: 'gifts', title: 'Gift boxes', purpose: '', index: 3, added: true }), ev('layer:plan', { page: 'gifts', id: 'hero', role: 'hero', height: 760, links: [] })], true, { state: 'building', done: 0, planned: 1, kept: 9, failed: 0, next: null }],
  ['a next version that added a page', [...next(first()), ev('page', { id: 'gifts', title: 'Gift boxes', purpose: '', index: 3, added: true }), ev('layer:plan', { page: 'gifts', id: 'hero', role: 'hero', height: 760, links: [] }), ...built('gifts', 'hero'), done({ planned: 1, done: 1, failed: 0 }, { extend: true, kept: 3, added: [{ id: 'gifts', title: 'Gift boxes' }], changed: [] })], false, { state: 'done', done: 1, planned: 1, kept: 9, failed: 0, next: null, word: 'Designed' }],
  ['a next version that added nothing (W9)', [...next(first()), ev('error', { where: 'planner', message: HTTP500 }), done({ planned: 0, done: 0, failed: 0 }, { extend: true, kept: 3, added: [], changed: [] })], false, { state: 'unchanged', done: 0, planned: 0, kept: 9, failed: 0, next: null, reason: null, word: 'Designed' }],
  ['a resumed build whose sections failed again', [...next([start(), ...plan(), ...five(), done({ planned: 9, done: 5, failed: 4 })], { ask: '', resume: true }), ...broke('menu', 'footer'), ...every(broke, [['visit']]), done({ planned: 4, done: 0, failed: 4 }, { extend: true, kept: 3, added: [], changed: [], resume: true })], false, { state: 'partly', done: 0, planned: 4, kept: 5, failed: 4, next: 'resume', reason: 'model', word: 'Partly built' }],
  ['stopped by the person (W10)', [start(), ...plan(), ...half(), stopped({ planned: 9, done: 3, failed: 0 }, reasonFromAbort('person'))], false, { state: 'stopped', done: 3, planned: 9, kept: 0, failed: 0, next: 'resume', reason: 'person', word: 'Stopped' }],
  ['stopped by the person, a section caught half way', [start(), ...plan(), ...half(), ev('layer:failed', { page: 'menu', layer: 'hero', agent: 'a1', message: 'stopped' }), stopped({ planned: 9, done: 3, failed: 0 }, reasonFromAbort('person'))], false, { state: 'stopped', done: 3, planned: 9, kept: 0, failed: 0, next: 'resume', word: 'Stopped' }],
  ['an old file: stopped, no cause named', [start(), ...plan(), ...half(), stopped({ planned: 9, done: 3, failed: 0 })], false, { state: 'stopped', done: 3, planned: 9, kept: 0, failed: 0, next: 'resume', reason: null, word: 'Stopped' }],
  ['stopped for a cause, sections planned (W11)', [start(), ...plan(), ...half(), stopped({ planned: 9, done: 3, failed: 0 }, reasonFromFailure('the model took too long'))], false, { state: 'halted', done: 3, planned: 9, kept: 0, failed: 0, next: 'resume', reason: 'timeout', word: 'Stopped' }],
  ['stopped for a cause, nothing planned (W12)', [start(), ev('error', { where: 'planner', message: 'the site plan came back empty, trying once more' }), ev('error', { where: 'planner', message: HTTP500 }), stopped({ planned: 0, done: 0, failed: 0, pages: 0 }, reasonFromFailure(HTTP500))], false, { state: 'halted', done: 0, planned: 0, kept: 0, failed: 0, next: 'again', reason: 'model', word: 'Stopped', empty: true }],
  ['no end event, live, nothing planned (W3)', [start()], true, { state: 'planning', done: 0, planned: 0, kept: 0, failed: 0, next: null }],
  ['no end event, live, sections planned (W4)', [start(), ...plan(), ...half()], true, { state: 'building', done: 3, planned: 9, kept: 0, failed: 0, next: null }],
  ['no end event, not live (W13, W14)', [start(), ...plan(), ...half()], false, { state: 'unsure', done: 3, planned: 9, kept: 0, failed: 0, next: 'resume', reason: null, word: 'Stopped' }],
  ['no end event, not live, nothing planned', [start()], false, { state: 'unsure', done: 0, planned: 0, kept: 0, failed: 0, next: 'again', word: 'Stopped', empty: true }],
  ['replaced, if its stop reached the file', [start(), ...plan(), ...half(), stopped({ planned: 9, done: 3, failed: 0 }, reasonFromAbort('replaced'))], false, { state: 'replaced', done: 3, planned: 9, kept: 0, failed: 0, next: 'resume', reason: 'replaced', word: 'Stopped' }],
  ['an old build that ended with nothing', [start(), done({ planned: 0, done: 0, failed: 0, pages: 0 })], false, { state: 'failed', done: 0, planned: 0, kept: 0, failed: 0, next: 'again', reason: null, word: 'Failed', empty: true }],
  ['a page the planner never gave a section', [start(), ...plan(), ev('page', { id: 'press', title: 'Press', purpose: '', index: 3 }), ev('error', { where: 'planner:press', message: HTTP500 }), ...every(built), done({ planned: 9, done: 9, failed: 0 })], false, { state: 'partly', done: 9, planned: 9, kept: 0, failed: 0, next: 'resume', word: 'Partly built' }]
]

test('every website build has one state, from its events and the live flag', () => {
  for (const [name, events, live, want] of CASES) {
    const s = buildState(events, { live })
    assert.ok(s, name)
    assert.ok(BUILD_STATES.includes(s.state), name)
    assert.deepEqual({ state: s.state, done: s.done, planned: s.planned, kept: s.kept, failed: s.failed.length, next: s.next },
      { state: want.state, done: want.done, planned: want.planned, kept: want.kept, failed: want.failed, next: want.next }, name)
    if ('reason' in want) assert.equal(s.reason?.code ?? null, want.reason, `${name}: the reason`)
    // nothing is offered while it is live, and nothing for a build that is whole
    if (live || s.state === 'done' || s.state === 'unchanged') assert.equal(s.next, null, name)
  }
})

test('the failed list names each failed section once, with the provider\'s words', () => {
  const s = buildState([start(), ...plan(), ...five(), done({ planned: 9, done: 5, failed: 4 })])
  assert.deepEqual(s.failed.map(f => `${f.page}/${f.layer}`), ['menu/footer', 'visit/hero', 'visit/features', 'visit/footer'])
  assert.ok(s.failed.every(f => f.why === HTTP500))
  assert.match(s.reason.message, /no model here/)
  assert.ok(s.reason.action)
})

test('a next version does not count the sections it was handed as its own work', () => {
  // before its plan: 9 kept, nothing of its own, and it is planning, not building the old ones
  const s = buildState(next(first()), { live: true })
  assert.deepEqual([s.state, s.done, s.planned, s.kept], ['planning', 0, 0, 9])
  // a resume builds the unfinished sections with no new plan event: they are its own work at once
  const r = buildState(next([start(), ...plan(), ...five(), done({ planned: 9, done: 5, failed: 4 })], { ask: '', resume: true }), { live: true })
  assert.deepEqual([r.state, r.done, r.planned, r.kept], ['building', 0, 4, 5])
})

test('Resume is named only when the server would take it and something is left', () => {
  // no theme and no page: /api/runs/<id>/resume answers "nothing to resume" (extendBase is null)
  assert.equal(buildState([start(), ev('layer:plan', { page: 'home', id: 'hero', role: 'hero' }), stopped({ planned: 1, done: 0, failed: 0 }, reasonFromAbort('person'))]).next, null)
  // stopped with every section built and every page planned: nothing to resume
  assert.equal(buildState([start(), ...plan(), ...every(built), stopped({ planned: 9, done: 9, failed: 0 }, reasonFromAbort('person'))]).next, null)
})

test('Try again is named when a build failed, was halted or was cut off with nothing to resume from', () => {
  const none = { planned: 0, done: 0, failed: 0, pages: 0 }
  // the planner failed before any page (W12), an old build that ended with nothing, a build cut off while planning
  assert.equal(buildState([start(), ev('error', { where: 'planner', message: HTTP500 }), stopped(none, reasonFromFailure(HTTP500))]).next, 'again')
  assert.equal(buildState([start(), done(none)]).next, 'again')
  assert.equal(buildState([start()]).next, 'again')
  // sections planned with no theme: nothing to resume from, so the same words again
  assert.equal(buildState([start(), ev('layer:plan', { page: 'home', id: 'hero', role: 'hero' }), stopped({ ...none, planned: 1 }, reasonFromFailure(HTTP500))]).next, 'again')
  // never while it is live, never for a stop by the person or an old stop that names no cause, never with no words to build from
  assert.equal(buildState([start()], { live: true }).next, null)
  assert.equal(buildState([start(), stopped(none, reasonFromAbort('person'))]).next, null)
  assert.equal(buildState([start(), stopped(none)]).next, null)
  assert.equal(buildState([start({ brief: '' }), stopped(none, reasonFromFailure(HTTP500))]).next, null)
  // and never where Resume is the way on: one way forward
  for (const [name, events, live] of CASES) {
    const s = buildState(events, { live })
    assert.ok([null, 'resume', 'again'].includes(s.next), name)
    if (s.next === 'again') assert.ok(['failed', 'halted', 'unsure'].includes(s.state), name)
    if (s.next === 'resume') assert.ok(s.done + s.kept > 0 || s.planned > 0, name)
  }
})

test('the reason of a build that ran to its end says what happened, and names the way on', () => {
  // partly built: nothing "Stopped", and the action is Resume, the button the state gives
  const partly = buildState([start(), ...plan(), ...five(), done({ planned: 9, done: 5, failed: 4 })])
  assert.equal(partly.reason.message, "The model didn't answer (no model here).")
  assert.equal(partly.reason.action, 'Resume, or pick another model in `hermes model`.')
  assert.equal(partly.next, 'resume')
  const slow = buildState([start(), ...plan(), ...every(built).slice(2), ...broke('home', 'hero', 'the model took too long')], { live: false })
  assert.equal(slow.state, 'unsure')
  const late = buildState([start(), ...plan(), ...every(built).slice(2), ...broke('home', 'hero', 'the model took too long'), done({ planned: 9, done: 8, failed: 1 })])
  assert.equal(late.reason.message, 'The model took too long to answer.')
  assert.match(late.reason.action, /^Resume; /)
  // a stop keeps its own words, as the server wrote them
  assert.equal(reasonFromFailure(HTTP500).message, "Stopped: the model didn't answer (no model here).")
  assert.equal(reasonFromFailure(HTTP500).action, 'Try again, or pick another model in `hermes model`.')
  assert.equal(reasonFromFailure('timed out').message, 'Stopped: the model took too long to answer.')
  assert.equal(reasonFromFailure('HTTP 429 {}', { resume: true }).action, 'Wait a minute, then resume.')
})

test('an app, a game and a project brought in have no website state', () => {
  assert.equal(buildState([]), null)
  assert.equal(buildState([ev('error', { where: 'models', message: 'No model key yet.' })]), null)
  assert.equal(buildState([start({ kind: 'game' }), ev('game:spec', { spec: {} }), ev('app:start', { kind: 'game' })]), null)
  assert.equal(buildState([start({ kind: 'app' }), ...plan(), ...every(built), done({ planned: 9, done: 9, failed: 0 })]), null)
  assert.equal(buildState([...first(), ev('app:start', {}), ev('app:failed', { message: 'npm failed' })]), null)
  assert.equal(buildState([start({ intake: true }), ev('intake', {})]), null)
  // a film made on a site leaves the site's build what it was
  assert.equal(isSiteBuild([...first(), ev('video:start', {}), ev('video:done', { seconds: 20 })]), true)
})

test('the Projects card says what the build state says', () => {
  for (const [name, events, live, want] of CASES) {
    const card = { ...cardOf(RUN, events), live, buildState: buildState(events, { live }) }
    const st = stateOf(card)
    assert.equal(st.kind, 'Website', name)
    assert.equal(st.status, live ? 'Building' : want.word, name)
    assert.equal(st.site, want.state, name)
    assert.equal(!!st.empty, !live && !!want.empty, `${name}: empty`)
    // never Designed unless every section stands
    if (st.status === 'Designed') assert.ok(['done', 'unchanged'].includes(want.state), name)
  }
})

test('a card that is Live, a game, an app or a film reads as before', () => {
  const failedSite = cardOf(RUN, [start(), ...plan(), ...every(broke), done({ planned: 9, done: 0, failed: 9 })])
  // published once: Live comes first, as before (PU2 in docs/ux/states/publish.md is not closed here)
  const live = { ...failedSite, sites: { local: 'http://127.0.0.1:4400/cedar/' } }
  assert.equal(stateOf(live).status, 'Live')
  assert.equal(stateOf(live).empty, undefined)
  for (const card of [
    { kind: 'game', game: true, build: 'working', updated: 0 },
    { kind: 'game', game: true, build: 'failed' },
    { kind: 'app', build: 'built', app: true, pages: 2, layers: 6 },
    { kind: 'app', build: 'failed', pages: 2, layers: 6 },
    { kind: 'app', pages: 2, layers: 6, planned: 6 },
    { kind: 'site', pages: 0, layers: 0, video: true },
    { kind: 'site', pages: 3, layers: 9, planned: 9, intake: 'in', build: 'built' },
    // a site with a play page is a Game on its card: its words stay
    { ...failedSite, game: true }
  ]) assert.deepEqual(stateOf(card), oldStateOf(card), JSON.stringify(card).slice(0, 80))
})

test('old against new: only a failed, stopped or unfinished website changes its words', () => {
  const runs = [
    ...CASES.map(([, events], i) => ({ id: `2026-11-01T10-00-${String(i).padStart(2, '0')}-000Z`, events })),
    { id: '2026-11-02T10-00-00-000Z', events: [start({ kind: 'game' }), ev('game:spec', { spec: {} }), ev('app:start', { kind: 'game' }), ev('app:failed', { message: 'stopped' })] },
    { id: '2026-11-02T11-00-00-000Z', events: [start({ kind: 'app' }), ...plan(), ...every(built), done({ planned: 9, done: 9, failed: 0 }), ev('app:start', {}), ev('app:failed', { message: 'npm failed' })] },
    { id: '2026-11-02T12-00-00-000Z', events: [start({ kind: 'app' }), ...plan(), ...half(), done({ planned: 9, done: 3, failed: 6 })] },
    { id: '2026-11-02T13-00-00-000Z', events: [...first(), ev('publish:done', { target: 'local', url: 'http://127.0.0.1:4400/cedar/' })] },
    { id: '2026-11-02T14-00-00-000Z', events: [start(), ...plan(), ...every(broke), done({ planned: 9, done: 0, failed: 9 }), ev('publish:done', { target: 'local', url: 'http://127.0.0.1:4400/cedar/' })] }
  ]
  // one project of two versions: the first whole, the newest all failed (shot f-fail-projects)
  const projects = { p1: { runs: ['2026-11-01T10-00-00-000Z', '2026-11-01T10-00-02-000Z'], name: 'Cedar Cafe' } }
  const diffs = differences(runs, projects)
  assert.ok(diffs.length > 0)
  assert.deepEqual(diffs.filter(d => !d.ok), [])
  // whole builds, the app, the game and the Live cards are not in the list
  for (const id of ['2026-11-01T10-00-00-000Z', '2026-11-02T10-00-00-000Z', '2026-11-02T11-00-00-000Z', '2026-11-02T12-00-00-000Z', '2026-11-02T13-00-00-000Z', '2026-11-02T14-00-00-000Z'])
    assert.equal(diffs.some(d => d.what === 'version' && d.run === id), false, id)
  // hole B2: the project's card read the older version's "Designed"; now it reads its newest build's own word
  assert.deepEqual(diffs.filter(d => d.what === 'card' && d.run === '2026-11-01T10-00-02-000Z').map(d => [d.was, d.now]), [['Website · Designed', 'Website · Failed']])
})

test('a website card never borrows an older version\'s words; an empty version is still put away', () => {
  const P = (state, versions) => ({ id: 'p', title: 'p', head: 'r', count: versions.length, updated: 0, made: 0, state, versions })
  const whole = { kind: 'Website', status: 'Designed', host: null, site: 'done' }
  const dead = { kind: 'Website', status: 'Failed', host: null, site: 'failed', empty: true }
  const never = { kind: 'Website', status: 'Stopped', host: null, site: 'halted', empty: true }
  const partly = { kind: 'Website', status: 'Partly built', host: null, site: 'partly' }
  // the newest version failed: the card says so, and both versions are listed
  let p = working([P(dead, [{ id: 'v2', state: dead }, { id: 'v1', state: whole }])])[0]
  assert.equal(p.state.status, 'Failed'); assert.deepEqual(p.versions.map(v => v.id), ['v2', 'v1'])
  // an empty older version (failed, or stopped before any page) is not shown once a newer one works
  p = working([P(partly, [{ id: 'v3', state: partly }, { id: 'v2', state: never }, { id: 'v1', state: dead }])])[0]
  assert.equal(p.state.status, 'Partly built'); assert.deepEqual(p.versions.map(v => v.id), ['v3'])
  // a stopped version with sections standing is a version like any other
  p = working([P(whole, [{ id: 'v2', state: whole }, { id: 'v1', state: { kind: 'Website', status: 'Stopped', host: null, site: 'stopped' } }])])[0]
  assert.deepEqual(p.versions.map(v => v.id), ['v2', 'v1'])
})
