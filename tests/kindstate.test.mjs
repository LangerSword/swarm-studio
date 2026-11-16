// The one state of an app, a game and a film (engine/kindstate.mjs; docs/ux/states/build.md, A1 to A7 and F1 to
// F6): what a build is comes from its own facts at its start, each kind has a small closed set of states, a
// failure has a plain reason, and `next` names only what the app's own start (engine/appjob.mjs startRefusal)
// would take. The Projects card's words (server/projects.mjs stateOf) are made from the same state.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { APP_STATES, FILM_STATES, FILM_CUT_OFF, appState, filmState, kindOf, kindState } from '../engine/kindstate.mjs'
import { startRefusal } from '../engine/appjob.mjs'
import { stateOf } from '../server/projects.mjs'
import { kindDifferences } from '../scripts/build-state-diff.mjs'

let clock = 1000
const ev = (type, data = {}) => ({ type, t: (clock += 10), ...data })
const start = (more = {}) => ev('run:start', { brief: 'Shift Log, an app where nurses swap shifts', agents: [], ...more })
const design = () => [ev('page', { id: 'home', title: 'Home' }), ev('layer:plan', { page: 'home', id: 'hero', role: 'hero' }), ev('layer:done', { page: 'home', layer: 'hero', html: '<section>hi</section>' }), ev('run:done', { planned: 1, done: 1, failed: 0 })]
const spec = () => ev('game:spec', { spec: { title: 'Lantern Run' } })
const step = text => ev('app:step', { step: { kind: 'setup', text } })
const HTTP500 = 'cb/deepseek: HTTP 500 {"error":"no model here"}'

const APP = [start({ kind: 'app' }), ...design()]
const GAME = [start({ kind: 'game' }), spec()]
// every app and game build there is, by the state it must read and the way forward it must offer
const CASES = {
  'an app designed, not built': [APP, 'designed', 'build'],
  'an app with no section built': [[start({ kind: 'app' })], 'designed', null],
  'an app being built elsewhere': [[...APP, ev('app:start', { kind: 'app', pid: 7 })], 'building', null, { alive: () => true }],
  'an app whose Studio went away': [[...APP, ev('app:start', { kind: 'app', pid: 7 })], 'stopped', 'resume'],
  'an app built': [[...APP, ev('app:start'), ev('app:done', { result: {} })], 'built', null],
  'an app whose first build failed': [[...APP, ev('app:start'), ev('app:failed', { message: HTTP500 })], 'failed', 'again'],
  'an app stopped by the person': [[...APP, ev('app:start'), ev('app:failed', { message: 'stopped' })], 'stopped', 'resume'],
  'a change to a built app that failed': [[...APP, ev('app:start'), ev('app:done'), ev('app:start'), ev('app:failed', { message: 'tsc: 3 errors\nsrc/a.ts' })], 'failed', null],
  'a game with its spec, not built': [GAME, 'designed', 'build'],
  'a game with no spec': [[start({ kind: 'game' })], 'designed', null],
  'a game waiting after a slice': [[...GAME, ev('app:start', { kind: 'game' }), step('stage 2 of 5: the market'), ev('app:paused', { slice: { i: 2 } })], 'waiting', 'resume'],
  'a game built': [[...GAME, ev('app:start', { kind: 'game' }), ev('app:done')], 'built', null],
  'a project brought in': [[start({ kind: 'app', intake: true }), ev('intake', { shape: 'vite' }), ev('app:failed', { message: 'no' })], 'failed', null]
}

test('what a build is comes from its own facts at its start, not from what finished', () => {
  assert.equal(kindOf([]), null)
  assert.equal(kindOf([start()]), 'site')
  assert.equal(kindOf([start({ kind: 'app' })]), 'app')
  assert.equal(kindOf([start()], { piece: 'app' }), 'app', 'the brief says app')
  assert.equal(kindOf([start(), ev('app:start')]), 'app', 'an app build was asked for')
  assert.equal(kindOf([start({ kind: 'game' })]), 'game')
  assert.equal(kindOf([start(), spec()], { piece: 'app' }), 'game')
  assert.equal(kindOf([start({ kind: 'film' })]), 'film')
  assert.equal(appState([start(), ...design()]), null, 'a website has no app state')
})

for (const [name, [events, state, next, opts]] of Object.entries(CASES)) {
  test(`${name}: ${state}, next ${next}`, () => {
    const s = appState(events, { self: 1, now: clock + 60 * 60e3, ...opts })
    assert.ok(APP_STATES.includes(s.state))
    assert.deepEqual([s.state, s.next], [state, next])
    // the way forward is what the app's own start takes with nothing typed: the server fills a game's prompt
    // from its saved spec when no build has finished (server/server.mjs, POST /api/runs/<id>/app)
    const hasSpec = events.some(e => e.type === 'game:spec')
    const refused = startRefusal(events, { hasApp: s.hasApp, kind: s.kind === 'game' ? 'game' : 'site', prompt: hasSpec && !s.hasApp ? 'the spec' : '' })
    if (s.next) assert.equal(refused, null, `${name}: start takes it`)
    else if (['designed', 'failed', 'stopped', 'waiting'].includes(s.state)) assert.ok(refused, `${name}: start refuses, so no way forward is named`)
    assert.equal(!!s.reason, s.state === 'failed')
  })
}

test('a failure says why in plain words: the stop reasons for a model, the first line otherwise', () => {
  const model = appState(CASES['an app whose first build failed'][0])
  assert.deepEqual(model.reason, { code: 'model', message: "The model didn't answer (no model here).", action: 'Try again, or pick another model in `hermes model`.' })
  assert.equal(model.detail, HTTP500)
  const engine = appState(CASES['a change to a built app that failed'][0])
  assert.deepEqual(engine.reason, { code: 'engine', message: 'tsc: 3 errors', action: '' })
  assert.equal(appState([...APP, ev('app:start'), ev('app:failed', {})]).reason.message, 'The engine stopped before the app built.')
  const game = appState(CASES['a game waiting after a slice'][0])
  assert.deepEqual(game.at, [2, 5])
  // this server's own job at work wins over the file
  assert.equal(appState(CASES['an app built'][0], { working: true, stage: 'turn 2' }).state, 'building')
  // a step written in a wrong shape (no text) is read, not thrown on
  assert.equal(appState([...APP, ev('app:step', { step: 'design', state: 'done' })]).state, 'designed')
})

test('a film: none, making, done, failed with its reason, stopped, cut off', () => {
  const SITE = [start(), ...design()]
  assert.equal(filmState(SITE), null)
  assert.equal(filmState(SITE, { job: { state: 'working', pct: 40, stage: 'rendering' } }).state, 'making')
  assert.deepEqual(filmState([...SITE, ev('video:start'), ev('video:done', { seconds: 20 })]), { state: 'done', pct: 100, stage: '', reason: null, next: null })
  const failed = filmState([...SITE, ev('video:start'), ev('video:failed', { message: 'no footage model' })])
  assert.deepEqual(failed, { state: 'failed', pct: 0, stage: '', reason: { code: 'film', message: 'no footage model', action: '' }, next: 'again' })
  assert.equal(filmState([...SITE, ev('video:start'), ev('video:failed', { message: "Hermes isn't connected." })]).reason.code, 'hermes')
  assert.equal(filmState([...SITE, ev('video:start'), ev('video:failed', { message: 'stopped' })]).state, 'stopped')
  assert.equal(filmState([...SITE, ev('video:start')]).reason.message, FILM_CUT_OFF)
  assert.equal(filmState([...SITE, ev('video:failed', { message: FILM_CUT_OFF })]).reason.code, 'restart')
  // Try again is named only where the server would make a film: a film run, or a build with a section built
  assert.equal(filmState([start(), ev('video:failed', { message: 'x' })]).next, null)
  assert.equal(filmState([start({ kind: 'film' }), ev('video:failed', { message: 'x' })]).next, 'again')
  // a fixture's wrong shape (`error`, no message) is still a failed film, never the empty form
  assert.equal(filmState([...SITE, ev('video:start'), ev('video:failed', { error: 'x' })]).state, 'failed')
  for (const e of [[...SITE, ev('video:start')], [...SITE, ev('video:failed', { message: 'stopped' })]]) assert.ok(FILM_STATES.includes(filmState(e).state))
})

test('all parts of a build at once', () => {
  const p = kindState([...APP, ev('video:start'), ev('video:failed', { message: 'x' })])
  assert.equal(p.kind, 'app')
  assert.equal(p.site.state, 'done', 'the design is a website build until the app is built')
  assert.equal(p.app.state, 'designed')
  assert.equal(p.game, null)
  assert.equal(p.film.state, 'failed')
  assert.equal(kindState(GAME).game.state, 'designed')
  assert.equal(kindState([start(), ...design()], { piece: 'app' }).app.state, 'designed')
})

// the Projects card: its words are made from the same parts
const card = (events, more = {}) => {
  const parts = kindState(events, { piece: more.piece, self: 1, now: clock + 60 * 60e3 })
  const b = events.findLast(e => ['app:start', 'app:done', 'app:failed'].includes(e.type))
  return { kind: events[0].kind || 'site', pages: events.filter(e => e.type === 'page').length, planned: 1, layers: events.filter(e => e.type === 'layer:done').length, game: events.some(e => e.type === 'game:spec'), app: events.some(e => e.type === 'app:done'),
    build: (b?.type === 'app:failed' && b.message === 'stopped') || b?.type === 'app:start' ? 'stopped' : ({ 'app:done': 'built', 'app:failed': 'failed' })[b?.type] || null, buildState: parts.site, parts, updated: clock, ...more }
}
const words = s => `${s.kind} · ${s.status}`
test('the Projects card reads the one state: an unbuilt app is an App, a waiting game says so, a stopped app is Stopped', () => {
  assert.equal(words(stateOf(card(APP))), 'App · Designed')
  assert.equal(words(stateOf(card([start(), ...design()], { piece: 'app' }))), 'App · Designed')
  assert.equal(words(stateOf(card([start({ kind: 'app' }), ev('page', { id: 'home' }), ev('layer:plan', { page: 'home', id: 'hero' }), ev('layer:failed', { page: 'home', layer: 'hero', message: HTTP500 }), ev('run:done', { planned: 1, done: 0, failed: 1 })]))), 'App · Failed', 'an app whose design failed is not Designed')
  assert.equal(words(stateOf(card(CASES['a game waiting after a slice'][0]))), 'Game · Your turn')
  assert.equal(words(stateOf(card(CASES['an app stopped by the person'][0]))), 'App · Stopped')
  assert.equal(words(stateOf(card(CASES['an app whose Studio went away'][0]))), 'App · Stopped')
  assert.equal(words(stateOf(card(CASES['an app built'][0]))), 'App built'.replace(/^/, 'App · '))
  assert.equal(words(stateOf(card(CASES['an app whose first build failed'][0]))), 'App · App failed')
  assert.equal(words(stateOf(card(CASES['a game built'][0]))), 'Game · Game built')
  assert.equal(words(stateOf(card([start({ kind: 'film' }), ev('video:start'), ev('video:failed', { message: 'x' })]))), 'Video · Failed')
  assert.equal(words(stateOf(card([start(), ...design()]))), 'Website · Designed')
  // Live still comes first, whatever the build's state
  assert.equal(stateOf({ ...card(CASES['an app whose first build failed'][0]), deployed: 'https://a.example.app' }).status, 'Live')
})

test('old against new over a runs folder: only the truthful changes, never a Live card or a built app or game', () => {
  const id = i => `2026-11-03T10-00-${String(i).padStart(2, '0')}-000Z`
  const runs = [
    APP, CASES['an app built'][0], CASES['a game built'][0], CASES['a game waiting after a slice'][0], CASES['an app stopped by the person'][0],
    [...APP, ev('publish:done', { target: 'local', url: 'http://127.0.0.1:4400/shift/' })], [start({ brief: 'Cedar Cafe, a small cafe' }), ...design()],
    [start({ brief: 'Cedar Cafe, a small cafe' }), ...design(), ev('video:start'), ev('video:failed', { message: 'x' })]
  ].map((events, i) => ({ id: id(i), events }))
  const diffs = kindDifferences(runs)
  assert.deepEqual(diffs.filter(d => !d.ok), [])
  const of = i => diffs.filter(d => d.what === 'version' && d.run === id(i)).map(d => [d.was, d.now])
  assert.deepEqual(of(0), [['Website · Designed', 'App · Designed']])
  assert.deepEqual(of(1), [], 'a built app reads as before')
  assert.deepEqual(of(2), [], 'a built game reads as before')
  assert.deepEqual(of(3), [['Game · Stopped', 'Game · Your turn']])
  assert.deepEqual(of(4), [['App · Designed', 'App · Stopped']])
  assert.deepEqual(of(5), [['Website · Live', 'App · Live']], 'Live stays Live: only what it is changes')
  assert.deepEqual(of(6), [])
  // a website with a failed film keeps its own words and says the film failed beside them (#647: it said nothing)
  assert.deepEqual(of(7), [['Website · Designed', 'Website · Designed · Film failed']], 'a website with a failed film keeps its words and names the film')
})
