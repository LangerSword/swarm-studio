// The build state on its way to the screens (docs/ux/states/build.md, "Where the state should live"): the real
// server answers a saved website build's one state (GET /api/runs/<id>/state), sends it on the stream before the
// event it is said from (`build:state`), and takes the one way forward the state names: Resume
// (POST /api/runs/<id>/resume) or Try again (POST /api/runs/<id>/again), for every state that offers one, and
// refuses Try again everywhere else, so it is never a way around ask-before-build (decision 0020).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildState } from '../engine/buildstate.mjs'
import { reasonFromAbort, reasonFromFailure } from '../engine/stopreason.mjs'
import { runBoard } from '../server/board.mjs'
import { startStudio } from '../scripts/studio-child.mjs'

const HTTP500 = 'cb/deepseek-v4.1-flash: HTTP 500 {"error":"no model here"}'
const BRIEF = 'Cedar Cafe, a small cafe with a menu and opening hours'
const PAGES = ['home', 'menu'], ROLES = ['hero', 'footer']
let clock = 1000
const ev = (type, data = {}) => ({ type, t: (clock += 10), ...data })
const start = (more = {}) => ev('run:start', { brief: BRIEF, agents: [{ id: 'a0', name: 'Ada', color: '#d4d4d8' }], plannerModel: 'p', workerModel: 'w', paint: false, ...more })
const plan = () => [ev('theme', { name: 'Plain', direction: '', vars: { '--background': '#111111' } }), ...PAGES.map((id, index) => ev('page', { id, title: id, purpose: '', index })),
  ...PAGES.flatMap(page => ROLES.map(role => ev('layer:plan', { page, id: role, role, height: 500, links: [] })))]
const built = (page, layer) => ev('layer:done', { page, layer, agent: 'a0', ms: 400, html: `<section>${page} ${layer}</section>` })
const broke = (page, layer) => ev('layer:failed', { page, layer, agent: 'a0', message: HTTP500 })
const all = fn => PAGES.flatMap(page => ROLES.map(role => fn(page, role)))
const half = () => ROLES.map(role => built('home', role))
const done = counts => ev('run:done', { ms: 900, pages: 2, ...counts })
const stopped = (counts, reason) => ev('run:stopped', { ms: 900, pages: 2, ...counts, stopped: true, ...(reason ? { reason } : {}) })
const none = { planned: 0, done: 0, failed: 0 }

// every kind of saved website build, by the state it must read and the way forward it must offer
const SAVED = {
  whole: [[start(), ...plan(), ...all(built), done({ planned: 4, done: 4, failed: 0 })], 'done', null],
  partly: [[start(), ...plan(), ...half(), ...ROLES.map(r => broke('menu', r)), done({ planned: 4, done: 2, failed: 2 })], 'partly', 'resume'],
  failed: [[start(), ...plan(), ...all(broke), done({ planned: 4, done: 0, failed: 4 })], 'failed', 'resume'],
  stopped: [[start(), ...plan(), ...half(), stopped({ planned: 4, done: 2, failed: 0 }, reasonFromAbort('person'))], 'stopped', 'resume'],
  halted: [[start(), ...plan(), ...half(), stopped({ planned: 4, done: 2, failed: 0 }, reasonFromFailure('the model took too long', { resume: true }))], 'halted', 'resume'],
  // no end in the file: the server closes it when it starts (run:stopped, reason `interrupted`), so it reads halted
  unsure: [[start(), ...plan(), ...half()], 'halted', 'resume'],
  haltedAtStart: [[start(), ev('error', { where: 'planner', message: HTTP500 }), stopped(none, reasonFromFailure(HTTP500))], 'halted', 'again'],
  failedAtStart: [[start(), done({ ...none, pages: 0 })], 'failed', 'again'],
  cutOffAtStart: [[start()], 'halted', 'again'],
  stoppedAtStart: [[start(), stopped(none, reasonFromAbort('person'))], 'stopped', null]
}
const idOf = i => `2026-11-01T10-00-${String(i).padStart(2, '0')}-000Z`

async function startServer() {
  const dir = mkdtempSync(join(tmpdir(), 'bstate-srv-'))
  const runs = join(dir, 'data', 'runs')
  Object.values(SAVED).forEach(([events], i) => {
    mkdirSync(join(runs, idOf(i)), { recursive: true })
    writeFileSync(join(runs, idOf(i), 'events.jsonl'), events.map(e => JSON.stringify({ ...e, run: idOf(i) })).join('\n') + '\n')
  })
  const env = { ...process.env, SWARM_TOKEN: 't', SWARM_DATA_DIR: join(dir, 'data'), SWARM_RUNS_DIR: runs, SWARM_OUTPUT_DIR: join(dir, 'out'), HERMES_HOME: join(dir, 'hermes'), SWARM_HERMES_RUNNING: '0' }
  for (const k of Object.keys(env)) if (/_API_KEY$/.test(k) || /^SWARM_(PLANNER|WORKER|REVIEWER)_/.test(k)) delete env[k]
  const { child, base } = await startStudio({ env })
  const call = (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-swarm-token': 't', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const stop = () => { child.kill(); try { rmSync(dir, { recursive: true, force: true }) } catch {} }
  return { call, stop, base }
}
// a Hermes that says what pictures it offers (none) and holds every model call: a build started here plans for ever
async function holdingHermes(s) {
  const bridge = createServer((req, res) => { req.resume(); if (!req.url.includes('/v1/')) res.writeHead(200, { 'content-type': 'application/json' }).end('{"image":false,"video":false}') })
  await new Promise(r => bridge.listen(0, '127.0.0.1', r))
  await s.call('/api/hermes/attach', { url: `http://127.0.0.1:${bridge.address().port}`, token: 'bridge-token-0123456789', pid: 4250, code: 1e10 })
  return () => { bridge.closeAllConnections?.(); bridge.close() }
}
const eventsOf = async (s, run) => { const r = await s.call(`/api/runs/${run}/events`); return r.ok ? r.json() : [] }
async function until(fn, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end;) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)) }
  return null
}

test('a saved build answers its one state, and the server takes the way forward it names, for every state', { timeout: 90000 }, async () => {
  const s = await startServer()
  const unhold = await holdingHermes(s)
  try {
    for (const [i, [name, [events, state, next]]] of Object.entries(SAVED).entries()) {
      const id = idOf(i)
      // what the server answers is the engine's state of the same file, and the board carries the same one
      const res = await s.call(`/api/runs/${id}/state`)
      assert.equal(res.status, 200, name)
      const got = (await res.json()).state
      // a build saved with no end was given one when the server started: the one event the server adds
      const saved = await eventsOf(s, id)
      const cut = !events.some(e => e.type === 'run:done' || e.type === 'run:stopped')
      assert.equal(saved.length, events.length + (cut ? 1 : 0), `${name}: events in the file`)
      if (cut) {
        assert.equal(saved.at(-1).type, 'run:stopped', name)
        assert.deepEqual(saved.at(-1).reason, { code: 'interrupted', message: 'This run stopped before it finished.', action: '' }, name)
        assert.equal(buildState(events).state, 'unsure', `${name}: as it was saved`)
      }
      assert.deepEqual(got, buildState(saved), name)
      assert.deepEqual([got.state, got.next], [state, next], name)
      assert.deepEqual((await (await s.call(`/api/runs/${id}/board`)).json()).build, got, `${name}: the board`)

      // Try again: taken only where the state names it, and then it is the same words in a build of its own
      const again = await s.call(`/api/runs/${id}/again`, {})
      const aj = await again.json()
      if (next === 'again') {
        assert.equal(again.status, 200, `${name}: Try again ${JSON.stringify(aj)}`)
        assert.equal(aj.from, id)
        assert.notEqual(aj.run, id)
        const begun = await until(async () => (await eventsOf(s, aj.run)).find(e => e.type === 'run:start'))
        assert.equal(begun?.brief, BRIEF, `${name}: the same words`)
        assert.ok(!begun.extend, `${name}: a build of its own, nothing carried`)
        await s.call('/api/stop', { run: aj.run })
      } else {
        assert.equal(again.status, 400, `${name}: no Try again here`)
        assert.match(aj.error, next === 'resume' ? /resume it instead/ : /nothing to try again/)
      }

      // Resume: taken where the state names it; where Try again is named there is nothing to resume from
      const resume = await s.call(`/api/runs/${id}/resume`, {})
      const rj = await resume.json()
      if (next === 'resume') {
        assert.equal(resume.status, 200, `${name}: Resume ${JSON.stringify(rj)}`)
        assert.equal(rj.from, id)
        const begun = await until(async () => (await eventsOf(s, rj.run)).find(e => e.type === 'run:start'))
        assert.ok(begun?.extend && begun.resume, `${name}: the resumed build keeps what is built`)
        // the top bar's chip and the card's bar read the same state as the deck: a next version that has planned
        // nothing is planning, with an empty bar, never full from the sections it was handed (hole B7)
        const job = (await (await s.call('/api/work')).json()).jobs.find(j => j.run === rj.run)
        const state = (await (await s.call(`/api/runs/${rj.run}/state`)).json()).state
        assert.equal(state.done, 0, `${name}: none of its own sections built (the model is held)`)
        if (name === 'partly') assert.ok(state.kept > 0, 'partly: sections were handed over, and the bar does not count them')
        assert.deepEqual([job?.what, job?.stage, job?.pct], ['site', state.state === 'building' ? 'building pages' : 'planning', 0], `${name}: the chip`)
        const card = (await (await s.call('/api/runs')).json()).find(r => r.id === rj.run)
        assert.deepEqual([card?.live, card?.progress, card?.state?.status], [true, 0, 'Building'], `${name}: the card`)
        await s.call('/api/stop', { run: rj.run })
      } else if (next === 'again') assert.equal(resume.status, 400, `${name}: nothing to resume`)
      await new Promise(r => setTimeout(r, 150))
    }
    // no such build
    assert.equal((await s.call('/api/runs/2020-01-01T00-00-00-000Z/state')).status, 404)
    assert.equal((await s.call('/api/runs/2020-01-01T00-00-00-000Z/again', {})).status, 404)
  } finally { unhold(); s.stop() }
})

test('the stream sends the build state before the event it is said from, and never saves it', { timeout: 60000 }, async () => {
  const s = await startServer()
  const unhold = await holdingHermes(s)
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
    // a build that plans for ever (the model is held), then Stop
    const made = await (await s.call('/api/run', { brief: BRIEF, sure: true })).json()
    assert.ok(made.run, JSON.stringify(made))
    const of = type => seen.findIndex(e => e.type === type && e.run === made.run)
    assert.ok(await until(() => of('run:start') >= 0), 'the build started')
    const planning = seen.find(e => e.type === 'build:state' && e.run === made.run)
    assert.equal(planning?.state.state, 'planning')
    assert.ok(seen.indexOf(planning) < of('run:start'), 'the state comes before the start it is read from')
    await s.call('/api/stop', { run: made.run })
    assert.ok(await until(() => of('run:stopped') >= 0), 'the build stopped')
    const states = seen.filter(e => e.type === 'build:state' && e.run === made.run)
    assert.equal(states.at(-1).state.state, 'stopped')
    assert.equal(states.at(-1).state.reason.code, 'person')
    assert.ok(seen.indexOf(states.at(-1)) < of('run:stopped'), 'the page holds the end state before the end event')
    // sent only when it changed
    assert.equal(states.length, 2)
    // read from the events, never one of them
    const saved = await eventsOf(s, made.run)
    assert.ok(saved.some(e => e.type === 'run:stopped'))
    assert.ok(!saved.some(e => e.type === 'build:state'))
    // and what the saved build answers is the state the stream ended on
    assert.deepEqual((await (await s.call(`/api/runs/${made.run}/state`)).json()).state, states.at(-1).state)
    // someone who joins late is told the state first
    const late = await fetch(`${s.base}/events`, { headers: { 'x-swarm-token': 't' }, signal: stream.signal })
    const first = await (async () => { let buf = ''; for await (const chunk of late.body) { buf += Buffer.from(chunk).toString('utf8'); const m = buf.match(/data: (\{.*\})\n\n/); if (m) return JSON.parse(m[1]) } })()
    assert.deepEqual([first.type, first.run, first.state.state], ['build:state', made.run, 'stopped'])
  } finally { stream.abort(); unhold(); s.stop() }
})

test('the board marks the sections the state lists as failed', () => {
  const [events] = SAVED.partly
  const b = runBoard('r1', events, tmpdir(), false)
  assert.equal(b.build.state, 'partly')
  assert.deepEqual(b.pages.map(p => [p.id, p.plan.map(l => [l.id, l.done, !!l.failed])]), [['home', [['hero', true, false], ['footer', true, false]]], ['menu', [['hero', false, true], ['footer', false, true]]]])
  // a stop leaves sections unbuilt, not failed; a game has no website state
  assert.ok(runBoard('r2', SAVED.stopped[0], tmpdir(), false).pages.every(p => p.plan.every(l => !l.failed)))
  assert.equal(runBoard('r3', [start({ kind: 'game' })], tmpdir(), false).build, null)
})

test('a site whose repository moved: the card and the publish answer give the address kept in github.json, and ask nobody', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bstate-moved-'))
  const data = join(dir, 'data'), runs = join(data, 'runs')
  const moved = idOf(50), stays = idOf(51), again = idOf(52)
  const was = 'https://me.github.io/cedar-cafe/', now = 'https://crew.github.io/cedar-cafe/'
  const whole = () => [start(), ...plan(), ...all(built), done({ planned: 4, done: 4, failed: 0 })]
  const save = (id, events) => { mkdirSync(join(runs, id), { recursive: true }); writeFileSync(join(runs, id, 'events.jsonl'), events.map(e => JSON.stringify({ ...e, run: id })).join('\n') + '\n') }
  save(moved, [...whole(), ev('publish:done', { target: 'github', url: was, repo: 'me/cedar-cafe' })])
  // no entry for this one: its saved address stands
  save(stays, [...whole(), ev('publish:done', { target: 'github', url: 'https://me.github.io/other/', repo: 'me/other' })])
  // found moved, then published again to another address: the newer publish is never overruled
  save(again, [...whole(), ev('publish:done', { target: 'github', url: was, repo: 'me/cedar-cafe' }), ev('publish:done', { target: 'github', url: 'https://me.github.io/cedar-cafe-2/', repo: 'me/cedar-cafe-2' })])
  writeFileSync(join(data, 'github.json'), JSON.stringify({ sites: { [moved]: { repo: 'crew/cedar-cafe', url: now, from: was }, [again]: { repo: 'crew/cedar-cafe', url: now, from: was } } }))
  const env = { ...process.env, SWARM_TOKEN: 't', SWARM_DATA_DIR: data, SWARM_RUNS_DIR: runs, SWARM_OUTPUT_DIR: join(dir, 'out'), HERMES_HOME: join(dir, 'hermes'), SWARM_HERMES_RUNNING: '0' }
  const { child, base } = await startStudio({ env })
  const get = path => fetch(base + path, { headers: { 'x-swarm-token': 't' } }).then(r => r.json())
  try {
    const cards = await get('/api/runs')
    const card = id => cards.find(r => r.id === id)
    assert.equal(card(moved).sites.github, now)
    assert.deepEqual([card(moved).state.status, card(moved).state.host], ['Live', 'crew.github.io'])
    assert.equal(card(stays).state.host, 'me.github.io')
    assert.equal(card(again).sites.github, 'https://me.github.io/cedar-cafe-2/')
    // what Publish reads for that build (asked without sync: GitHub is not called)
    assert.equal((await get(`/api/runs/${moved}/publish`)).live.github, now)
    assert.equal((await get(`/api/runs/${stays}/publish`)).live.github, 'https://me.github.io/other/')
    // the build's own file still holds what was saved: nothing was written for the move
    assert.equal((await get(`/api/runs/${moved}/events`)).findLast(e => e.type === 'publish:done').url, was)
  } finally { child.kill(); try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})
