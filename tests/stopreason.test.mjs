// No raw error reaches a person (docs/ux/states/README.md, root 4): every failure goes through the one table
// (web/stopreason.js, handed on by engine/stopreason.mjs) and comes out as {code, message, action} in plain words.
// Run: node --test tests/stopreason.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CODES, RAW, isRaw, reasonFromFailure, reasonFromTalk, reasonFromError, reasonFromAbort, reasonLine } from '../engine/stopreason.mjs'
import * as page from '../web/stopreason.js'
import { CANVAS_MODULES } from '../server/page.mjs'
import { buildState } from '../engine/buildstate.mjs'
import { endWords } from '../web/replaytalk.js'
import { diagnose, actionsFor, plainReply, factLines, troubleOf, DOCTOR_PROMPT } from '../engine/doctor.mjs'

// what the walkthrough's failure steps refuse in the chat (scripts/walkthrough-errors.mjs), and the table's own rule
const WALK = /HTTP \d{3}|\{"error"|ECONN|\[object Object\]|undefined/
const plain = (text, name) => { assert.ok(!WALK.test(text) && !isRaw(text), `${name}: raw text got through: ${text}`); assert.ok(String(text).trim(), `${name}: no words`) }

// every raw failure the Studio has been seen to pass on, as it is thrown or written to a build's events
const HTTP500 = 'cb/deepseek-v4.1-flash: HTTP 500 {"error":"no model here"}'
const RAWS = [
  HTTP500,
  'planner: MODEL: HTTP 500 {"error":"no model here"}',
  'planner: HTTP 402 {"error":{"message":"Budget cap reached for this key","type":"budget"}}',
  'gpt-x: HTTP 429 {"error":{"message":"Rate limit: slow down","code":42,"more":"xxxxxxxx',
  'gpt-x: HTTP 401 {"error":{"message":"{\\"detail\\":\\"bad\\"}"}}',
  'gpt-x: HTTP 503 <html><body>Service Unavailable</body></html>',
  'gpt-x: HTTP 500 {"error":{"message":"TypeError: undefined is not a function"}}',
  'gpt-x: HTTP 404 ',
  'connect ECONNREFUSED 127.0.0.1:4319',
  'fetch failed',
  'read ECONNRESET',
  'socket hang up',
  'terminated',
  'The operation was aborted due to timeout',
  'the planner took too long (timed out)',
  'This operation was aborted',
  'the site plan came back empty, trying once more',
  'no layers parsed, replanning',
  'the planner did not answer',
  'the planner did not write a brief',
  'nothing to add from that message: name a page or a section',
  'No planner model yet: pick one in Models.',
  'No model key yet. Start a build from Hermes once (/swarm, the chat tool or `hermes swarm`) so it can pass its model settings, or set SWARM_STUDIO_API_KEY.',
  "Hermes isn't connected. Open Hermes Desktop, or run `hermes swarm`, then try again.",
  'planner: HTTP 503 {"error":{"message":"Hermes isn\'t connected. Open…","code":"hermes_closed"}}',
  "TypeError: Cannot read properties of undefined (reading 'pages')",
  '[object Object]',
  'undefined',
  ''
]
const OPTS = [{}, { viaHermes: true }, { ended: true }, { resume: true }, { talk: true }, { talk: true, viaHermes: true }, { ended: true, resume: true, viaHermes: true }]

test('one table: the engine hands on the page\'s own, and the page loads it before the chat', () => {
  assert.equal(reasonFromFailure, page.reasonFromFailure)
  assert.ok(CANVAS_MODULES.indexOf('stopreason.js') >= 0 && CANVAS_MODULES.indexOf('stopreason.js') < CANVAS_MODULES.indexOf('canvas/core.js'))
  assert.match(readFileSync(new URL('../engine/stopreason.mjs', import.meta.url), 'utf8'), /^export \* from '\.\.\/web\/stopreason\.js'$/m)
})

test('every raw failure comes out as a code from the closed set, with plain words and no raw text', () => {
  for (const raw of RAWS) for (const o of OPTS) {
    for (const [by, r] of [['failure', reasonFromFailure(raw, o)], ['talk', reasonFromTalk(new Error(raw), o)], ['error', reasonFromError({ where: 'planner', message: raw }, o)]]) {
      const name = `${by} ${JSON.stringify(o)} ${raw.slice(0, 50)}`
      assert.ok(CODES.includes(r.code), `${name}: code ${r.code}`)
      assert.deepEqual(Object.keys(r).sort(), ['action', 'code', 'message'], name)
      plain(r.message, name)
      if (r.action) plain(r.action, name)
      plain(reasonLine(r), name)
    }
  }
})

test('the mapping: the model, a timeout, Hermes, no model, nothing to add, the Studio itself, a retry', () => {
  const code = (t, o) => reasonFromFailure(t, o).code
  assert.equal(code(HTTP500), 'model')
  assert.equal(reasonFromFailure(HTTP500).message, "Stopped: the model didn't answer (no model here).")
  assert.equal(reasonFromFailure(HTTP500, { talk: true }).message, "The model didn't answer (no model here).")
  assert.equal(reasonFromFailure(HTTP500, { talk: true }).action, 'Try again, or pick another model in `hermes model`.')
  // a status with no words of the provider's own is said in words, never as "HTTP 404"
  assert.equal(reasonFromFailure('gpt-x: HTTP 404 ', { talk: true }).message, "The model didn't answer (no such model).")
  assert.equal(reasonFromFailure('gpt-x: HTTP 503 <html>', { talk: true }).message, "The model didn't answer.")
  // the provider's own words are kept only when they are words
  assert.equal(reasonFromFailure('gpt-x: HTTP 500 {"error":{"message":"TypeError: undefined is not a function"}}', { talk: true }).message, "The model didn't answer.")
  assert.match(reasonFromFailure('planner: HTTP 402 {"error":{"message":"Budget cap reached for this key"}}').message, /Budget cap reached for this key/)
  assert.equal(code('The operation was aborted due to timeout', { talk: true }), 'timeout')
  assert.equal(reasonFromFailure('The operation was aborted due to timeout', { talk: true }).message, 'The model took too long to answer.')
  // a connection that broke: Hermes when the call goes through it, else the model's provider
  assert.equal(code('connect ECONNREFUSED 127.0.0.1:4319', { viaHermes: true }), 'hermes')
  assert.equal(code('connect ECONNREFUSED 127.0.0.1:4319'), 'model')
  // in a talk nothing was being built: nothing is "kept", nothing "goes on"
  assert.deepEqual(reasonFromFailure('fetch failed', { viaHermes: true, talk: true }), { code: 'hermes', message: "Hermes isn't connected.", action: 'Open Hermes Desktop, or run `hermes swarm`, then try again.' })
  assert.match(reasonFromFailure('fetch failed', { viaHermes: true }).message, /What was built is kept/)
  assert.deepEqual(reasonFromFailure('No planner model yet: pick one in Models.'), { code: 'setup', message: 'No planner model yet.', action: 'Pick one in Models.' })
  assert.equal(code('No model key yet. Start a build from Hermes once'), 'setup')
  assert.deepEqual(reasonFromFailure('nothing to add from that message: name a page or a section', { ended: true }), { code: 'nothing', message: 'Nothing to add from that message.', action: 'Name a page or a section.' })
  assert.equal(code('the planner did not answer', { talk: true }), 'model')
  // not the model, not Hermes: the Studio's own, and it does not blame the model
  assert.equal(code("TypeError: Cannot read properties of undefined (reading 'pages')", { talk: true }), 'studio')
  assert.equal(code('nothing to write a brief from', { talk: true }), 'studio')
  // a retry in progress is not a failure: one plain line
  assert.deepEqual(reasonFromError({ where: 'planner', message: 'the site plan came back empty, trying once more' }), { code: 'retry', message: 'The plan came back empty. Trying once more.', action: '' })
  assert.equal(reasonFromError({ where: 'planner:menu', message: 'no layers parsed, replanning' }).code, 'retry')
  assert.equal(reasonFromError({ where: 'planner', message: HTTP500 }).message, "The model didn't answer (no model here).")
  // Hermes's own answer through the bridge keeps Hermes's words
  assert.deepEqual(reasonFromTalk(Object.assign(new Error('x: HTTP 503 {"error":{}}'), { hermes: { code: 'hermes_closed', message: "Hermes isn't connected.", action: 'Open Hermes Desktop.' } })), { code: 'hermes', message: "Hermes isn't connected.", action: 'Open Hermes Desktop.' })
  assert.equal(reasonFromAbort('person').code, 'person')
  // the rule itself: what the walkthrough refuses is raw here too
  for (const t of ['HTTP 500', '{"error":"x"}', 'ECONNREFUSED', '[object Object]', 'undefined']) assert.ok(RAW.test(t), t)
  for (const t of ["The model didn't answer (no model here).", 'Try again, or pick another model in `hermes model`.', "Hermes isn't connected."]) assert.ok(!isRaw(t), t)
})

// ---------- the build's state and Fix mode say the same plain reason
const ev = (type, d = {}) => ({ type, t: 1, run: 'r', ...d })
const start = (d = {}) => ev('run:start', { brief: 'Harbor Bakery, a bakery by the docks', agents: [], ...d })
const theme = ev('theme', { theme: { name: 'x' } })
const page1 = [ev('page', { id: 'home', title: 'Home', purpose: '', index: 0 }), ev('layer:plan', { page: 'home', id: 'hero', role: 'hero' }), ev('layer:plan', { page: 'home', id: 'menu', role: 'list' })]
const partly = [start(), theme, ...page1, ev('layer:done', { page: 'home', layer: 'hero', html: '<section></section>' }), ev('layer:failed', { page: 'home', layer: 'menu', message: HTTP500 }), ev('run:done', { planned: 2, done: 1, failed: 1, pages: 1, ms: 5 })]
const haltedAtStart = [start(), ev('error', { where: 'planner', message: 'the site plan came back empty, trying once more' }), ev('error', { where: 'planner', message: HTTP500 }), ev('run:stopped', { stopped: true, reason: reasonFromFailure(HTTP500) })]
const factsOf = (events, parts = []) => ({ parts, run: { id: 'r', kind: 'site', working: false, built: false, failures: [], build: buildState(events) }, hermes: { attached: false, message: "Hermes isn't connected." }, models: { planner: '', worker: '', reviewer: '', image: '', video: '' } })
const hermesOff = { k: 'hermes', name: 'Hermes', group: 'core', groupName: 'Core', need: true, st: 'fail', why: 'not attached', fix: null }
const picturesOff = { k: 'pictures', name: 'Pictures', group: 'media', groupName: 'Media', need: true, st: 'fail', why: 'out of quota', fix: null }

test('a next version that added nothing because the model failed has its reason; one with nothing to add says so', () => {
  const base = [start(), theme, ...page1, ev('layer:done', { page: 'home', layer: 'hero', html: '<section></section>', kept: true }), ev('layer:done', { page: 'home', layer: 'menu', html: '<section></section>', kept: true })]
  const next = d => [{ ...base[0], extend: true, kept: 1 }, ...base.slice(1), ev('error', { where: 'planner', message: d }), ev('run:done', { extend: true, planned: 0, done: 0, failed: 0, pages: 1, kept: 1, added: [], changed: [], ms: 6400 })]
  const failed = buildState(next(HTTP500))
  assert.deepEqual([failed.state, failed.reason.code, failed.reason.message], ['unchanged', 'model', "The model didn't answer (no model here)."])
  assert.equal(buildState(next('nothing to add from that message: name a page or a section')).reason.code, 'nothing')
  // a retry that then went well is not a reason
  assert.equal(buildState(next('the site plan came back empty, trying once more')).reason, null)
})

test('Fix mode: a build that did not finish is led by the one reason and the one way on, never by Setup or a dump', async () => {
  for (const [name, events, way, label] of [['partly built', partly, 'resume', 'Resume'], ['halted at the start', haltedAtStart, 'again', 'Try again']]) {
    // Hermes is away and Pictures are out of quota: neither is why this build stopped
    const facts = factsOf(events, [hermesOff, picturesOff])
    assert.ok(troubleOf(facts), name)
    const acts = actionsFor(facts)
    assert.equal(acts[0].kind, way, `${name}: the way on comes first`)
    assert.equal(acts[0].label, label, name)
    const r = await diagnose({ facts, text: 'Why did the build stop?', chat: null })
    assert.equal(r.by, 'facts')
    assert.deepEqual(r.actions.map(a => a.kind), [way], name)
    const lines = r.reply.split('\n')
    assert.equal(lines[0], endWords(facts.run.build), `${name}: the build's own words lead`)
    assert.match(lines[0], /didn't answer \(no model here\)/, name)
    assert.ok(lines.length <= 5, `${name}: a short list, not a dump (${lines.length} lines)`)
    assert.doesNotMatch(r.reply, /Nothing failed|Models: planner|Python for cutting/, name)
    plain(r.reply, name)
    // what the model is given to word is plain too
    plain(factLines(facts).join('\n'), `${name}: the facts`)
    plain(DOCTOR_PROMPT(facts, acts).split('\nFacts:\n')[1], `${name}: the prompt's facts and actions`)
    // a model that answers with the provider's raw text is not quoted, and the way on is kept whatever it offers
    const rawSay = await diagnose({ facts, text: 'why?', chat: async () => JSON.stringify({ say: `It failed: ${HTTP500}`, offer: ['setup:hermes'] }) })
    assert.equal(rawSay.by, 'facts')
    plain(rawSay.reply, name)
    const worded = await diagnose({ facts, text: 'why?', chat: async () => JSON.stringify({ say: 'The model did not answer, so part of the site is not built.', offer: ['setup:pictures'] }) })
    assert.equal(worded.by, 'model')
    assert.equal(worded.actions[0].kind, way, name)
  }
  // B11: a build the model stopped is not "Nothing failed"
  assert.doesNotMatch(plainReply(factsOf(haltedAtStart)), /Nothing failed/)
  assert.match(plainReply(factsOf(haltedAtStart)), /^Stopped: the model didn't answer \(no model here\)\.\nTry again, or pick another model in hermes model\.$/)
})

test('Fix mode: Setup comes first only when the reason is setup', () => {
  // Hermes closed mid-build: opening Hermes is the thing to do, then Resume
  const gone = [...partly.slice(0, -2), ev('run:stopped', { stopped: true, reason: reasonFromFailure('terminated', { viaHermes: true }) })]
  assert.deepEqual(actionsFor(factsOf(gone, [picturesOff, hermesOff])).map(a => a.id), ['setup:hermes', 'resume', 'setup:pictures'])
  // the model failed: Resume first, though Hermes shows as away
  assert.deepEqual(actionsFor(factsOf(partly, [picturesOff, hermesOff])).map(a => a.id).slice(0, 1), ['resume'])
  // a build that is whole, or running, is not trouble
  assert.equal(troubleOf({ run: { id: 'r', working: true, build: buildState(partly) } }), null)
  assert.equal(troubleOf({ run: { id: 'r', working: false, build: buildState(partly.slice(0, 6).concat(ev('layer:done', { page: 'home', layer: 'menu', html: '<section></section>' }), ev('run:done', { planned: 2, done: 2, failed: 0, pages: 1, ms: 5 }))) } }), null)
})
