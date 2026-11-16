// The kinds' states on their way to the screens (docs/ux/states/build.md, "Where the state should live"): the real
// server answers every part of a saved build with the website's state (GET /api/runs/<id>/state, `parts`), puts
// the same parts on the card (/api/runs) and the Overview's board, sends them on the stream before a film's own
// event (`build:state`), and takes or refuses the way forward a part names: a film's Try again
// (POST /api/runs/<id>/video), an app's build (POST /api/runs/<id>/app) where nothing is there to build from.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { kindState } from '../engine/kindstate.mjs'
import { startStudio } from '../scripts/studio-child.mjs'

let clock = Date.parse('2026-11-01T10:00:00Z')
const ev = (type, data = {}) => ({ type, t: (clock += 1000), ...data })
const start = (brief, more = {}) => ev('run:start', { brief, agents: [], ...more })
const design = () => [ev('theme', { name: 'Plain', direction: '', vars: { '--background': '#111111' } }), ev('page', { id: 'home', title: 'Home', index: 0 }), ev('layer:plan', { page: 'home', id: 'hero', role: 'hero', height: 500 }), ev('layer:done', { page: 'home', layer: 'hero', agent: 'a0', html: '<section>hi</section>' }), ev('run:done', { planned: 1, done: 1, failed: 0, pages: 1 })]
const SITE = 'Cedar Cafe, a small cafe by the river'
// name: [events, what it is, its part's state, the card's words]
const SAVED = {
  designedApp: [[start('Shift Log, an app where nurses swap shifts'), ...design()], 'app', 'designed', 'App · Designed'],
  bareApp: [[start('Ward Swap', { kind: 'app' })], 'app', 'designed', 'App · Stopped'],
  waitingGame: [[start('Lantern Run', { kind: 'game', title: 'Lantern Run' }), ev('game:spec', { spec: { title: 'Lantern Run' } }), ev('app:start', { kind: 'game' }), ev('app:step', { step: { kind: 'setup', text: 'stage 2 of 5: the market' } }), ev('app:paused', { slice: { i: 2 } })], 'game', 'waiting', 'Game · Your turn'],
  stoppedApp: [[start(SITE), ...design(), ev('app:start', { kind: 'site' }), ev('app:failed', { message: 'stopped' })], 'app', 'stopped', 'App · Stopped'],
  failedFilm: [[start(SITE), ...design(), ev('video:start', { prompt: 'a film' }), ev('video:failed', { message: 'no footage model' })], 'site', 'failed', 'Website · Designed'],
  filmRun: [[start('River Hours', { kind: 'film', title: 'River Hours' }), ev('video:start', { prompt: 'a film' }), ev('video:failed', { message: 'no footage model' })], 'film', 'failed', 'Video · Failed'],
  bareFilm: [[start(SITE), ev('video:failed', { message: 'no footage model' })], 'site', 'failed', 'Website · Stopped']
}
const names = Object.keys(SAVED)
const idOf = name => `2026-11-01T10-00-${String(names.indexOf(name)).padStart(2, '0')}-000Z`

async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), 'kstate-srv-'))
  const runs = join(dir, 'data', 'runs')
  for (const name of names) {
    mkdirSync(join(runs, idOf(name)), { recursive: true })
    writeFileSync(join(runs, idOf(name), 'events.jsonl'), SAVED[name][0].map(e => JSON.stringify({ ...e, run: idOf(name) })).join('\n') + '\n')
  }
  const env = { ...process.env, SWARM_TOKEN: 't', SWARM_DATA_DIR: join(dir, 'data'), SWARM_RUNS_DIR: runs, SWARM_OUTPUT_DIR: join(dir, 'out'), HERMES_HOME: join(dir, 'hermes'), SWARM_HERMES_RUNNING: '0' }
  for (const k of Object.keys(env)) if (/_API_KEY$/.test(k) || /^SWARM_(PLANNER|WORKER|REVIEWER)_/.test(k)) delete env[k]
  const { child, base } = await startStudio({ env })
  const call = (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-swarm-token': 't', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const stop = () => { child.kill(); try { rmSync(dir, { recursive: true, force: true }) } catch {} }
  return { call, stop, base }
}
async function until(fn, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end;) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)) }
  return null
}

test('a saved build answers every part, and the card and the board read the same ones', { timeout: 60000 }, async () => {
  const s = await startServer()
  try {
    const cards = await (await s.call('/api/runs')).json()
    for (const name of names) {
      const [events, kind, state, words] = SAVED[name], id = idOf(name)
      const res = await s.call(`/api/runs/${id}/state`)
      assert.equal(res.status, 200, name)
      const { parts, state: site } = await res.json()
      assert.equal(parts.kind, kind, name)
      const part = parts.app || parts.game || parts.film
      assert.equal(part.state, state, name)
      assert.deepEqual(site, parts.site, `${name}: the website's state is the same one`)
      // the engine's own reading of the same file (the brief says what the first one is)
      const own = kindState(events, { piece: kind === 'app' ? 'app' : null, now: Date.now() })
      assert.deepEqual([parts.kind, (parts.app || parts.game)?.next ?? null, parts.film?.next ?? null], [own.kind, (own.app || own.game)?.next ?? null, own.film?.next ?? null], name)
      const card = cards.find(c => c.id === id)
      assert.equal(`${card.state.kind} · ${card.state.status}`, words, `${name}: the card`)
      assert.deepEqual(card.parts, parts, `${name}: the card carries the parts`)
      const board = await (await s.call(`/api/runs/${id}/board`)).json()
      assert.deepEqual(board.parts, parts, `${name}: the board`)
      assert.equal(!!board.app, kind === 'app', `${name}: an app is on the board from its start`)
    }
    // an app's build with nothing to build from is refused, as its state says (no way forward named)
    const bare = await (await s.call(`/api/runs/${idOf('bareApp')}/state`)).json()
    assert.equal(bare.parts.app.next, null)
    const refused = await s.call(`/api/runs/${idOf('bareApp')}/app`, {})
    assert.equal(refused.status, 400)
    assert.match((await refused.json()).error, /nothing built yet/)
    assert.equal((await (await s.call(`/api/runs/${idOf('designedApp')}/state`)).json()).parts.app.next, 'build')
  } finally { s.stop() }
})

// 600 s: the film's first one in a fresh data folder installs the video renderer (engine/video.mjs `videoTools`,
// whose own `npm ci` is allowed ten minutes), and the wait below is that install's, not a race against it
test('a film: Try again is taken where its state names it, refused where it does not, and the pages are told at once', { timeout: 620000 }, async () => {
  const s = await startServer()
  const stream = new AbortController()
  try {
    const seen = []
    const res = await fetch(`${s.base}/events`, { headers: { 'x-swarm-token': 't' }, signal: stream.signal })
    void (async () => {
      let buf = ''
      try {
        for await (const chunk of res.body) {
          buf += Buffer.from(chunk).toString('utf8')
          for (let at; (at = buf.indexOf('\n\n')) >= 0; buf = buf.slice(at + 2)) { const line = buf.slice(0, at); if (line.startsWith('data: ')) seen.push(JSON.parse(line.slice(6))) }
        }
      } catch {}
    })()
    // nothing built: the state names no way forward, and the server refuses
    const bare = idOf('bareFilm')
    assert.equal((await (await s.call(`/api/runs/${bare}/state`)).json()).parts.film.next, null)
    assert.equal((await s.call(`/api/runs/${bare}/video`, {})).status, 400)
    // a failed film on a built site: its reason, Try again, and the server takes it
    const id = idOf('failedFilm')
    const was = (await (await s.call(`/api/runs/${id}/state`)).json()).parts.film
    assert.deepEqual(was, { state: 'failed', pct: 0, stage: '', reason: { code: 'film', message: 'no footage model', action: '' }, next: 'again' })
    const again = await s.call(`/api/runs/${id}/video`, { prompt: 'a film', music: false, voice: 'off' })
    assert.equal(again.status, 200)
    assert.equal((await again.json()).state, 'working')
    // told at once, on the stream, with no event of the film's yet: the room never waits on the form
    const told = await until(() => seen.find(e => e.type === 'build:state' && e.run === id && e.parts?.film))
    assert.equal(told?.parts.film.state, 'making')
    const first = seen.findIndex(e => e.run === id && String(e.type).startsWith('video:'))
    assert.ok(first < 0 || seen.indexOf(told) < first, 'the state comes before the film\'s own events')
    // however it ends here (no model, no Hermes), it ends with a state: failed with a reason, or stopped.
    // The wait is the film's own, not a race: a stop is read where the film next looks (engine/video.mjs
    // `videoTools` has already been asked for the renderer by then), and in a fresh data folder that is the
    // renderer's first `npm ci`, which is allowed ten minutes. A 60 s wait here failed on Windows first
    // (tests/kindstateroutes.test.mjs, run 43784909538): the renderer's install, not the film, ran out the clock.
    await s.call('/api/stop', { run: id })
    const end = await until(async () => { const f = (await (await s.call(`/api/runs/${id}/state`)).json()).parts.film; return f.state !== 'making' ? f : null }, 600000)
    assert.ok(end && ['failed', 'stopped'].includes(end.state), JSON.stringify(end))
    if (end.state === 'failed') assert.ok(end.reason?.message)
    assert.ok(seen.some(e => e.type === 'build:state' && e.run === id && e.parts?.film?.state === end.state), 'and the pages were told')
  } finally { stream.abort(); s.stop() }
})
