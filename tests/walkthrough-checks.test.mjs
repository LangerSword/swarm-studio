// The walkthrough's checks as rules (scripts/walkthrough-checks.mjs): which words go with which state of a website
// build, what counts as a defect in a captured step, and the ratchet against the accepted baseline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BUILD_STATES } from '../engine/buildstate.mjs'
import { buildStrip, endWords } from '../web/replaytalk.js'
import { BUILD_SAYS, stateDisagrees, stripSays, defectsOf, countsOf, ratchet, accept, report, KINDS } from '../scripts/walkthrough-checks.mjs'

const b = (state, o = {}) => ({ state, done: 4, planned: 9, kept: 0, failed: [], reason: null, next: null, ...o })

test('the table has every build state, and its card words are the server’s', () => {
  assert.deepEqual(Object.keys(BUILD_SAYS).sort(), [...BUILD_STATES].sort())
  // server/projects.mjs keeps SITE_WORD to itself: read it where it is written
  const src = readFileSync(new URL('../server/projects.mjs', import.meta.url), 'utf8').match(/const SITE_WORD = (\{[^}]*\})/)
  assert.ok(src, 'SITE_WORD is in server/projects.mjs')
  const word = Function(`return ${src[1]}`)()
  for (const [state, w] of Object.entries(word)) assert.deepEqual(BUILD_SAYS[state].card, [w], `${state} reads ${w} on its card`)
})

test('the strip’s own words agree with every state, whatever the counts', () => {
  for (const state of BUILD_STATES) {
    for (const o of [{ working: 0, pages: 1 }, { working: 1, pages: 3 }, { working: 12, pages: 40 }]) {
      const s = b(state)
      assert.match(buildStrip(s, o).text, stripSays(s), `${state} with ${JSON.stringify(o)}`)
      assert.deepEqual(stateDisagrees(s, { strip: buildStrip(s, o).text.toUpperCase() }), [])
    }
  }
  // a next version planning: its own words
  assert.deepEqual(stateDisagrees(b('planning', { kept: 9, planned: 0, done: 0 }), { strip: 'Planning what to add' }), [])
})

test('what the chat says of a build that is not whole never disagrees with its state', () => {
  for (const state of ['partly', 'failed', 'stopped', 'halted', 'replaced', 'unsure']) {
    const s = b(state, { done: state === 'failed' ? 0 : 4, failed: [{}, {}], reason: { code: 'model', message: 'The model gave no answer.', action: 'Resume' }, next: 'resume' })
    assert.deepEqual(stateDisagrees(s, { chat: endWords(s) }), [], state)
  }
})

test('a failed or partly built build that reads as built is a disagreement, wherever it is said', () => {
  const wrong = stateDisagrees(b('partly'), { strip: '3 pages built', chat: 'All 3 pages are built.', page: 'Plans · 3 pages built', card: 'Website · Designed' })
  assert.deepEqual(wrong.map(w => w.where), ['strip', 'chat', 'page', 'card'])
  assert.equal(stateDisagrees(b('failed'), { card: 'Website · Designed' }).length, 1)
  assert.equal(stateDisagrees(b('failed'), { strip: 'Ready' }).length, 1)
  assert.equal(stateDisagrees(b('building'), { chat: 'All 3 pages are built.' }).length, 1)
  // and a whole one that reads as failed
  assert.equal(stateDisagrees(b('done'), { strip: 'Partly built' }).length, 1)
  assert.equal(stateDisagrees(b('done'), { card: 'Website · Failed' }).length, 1)
  assert.equal(stateDisagrees(b('done'), { chat: '4 of 9 sections are built and kept; 5 failed.' }).length, 1)
})

test('what is not the build’s word is left alone', () => {
  // an app or a game has no state; a strip not on screen and a replay's strip are not read
  assert.deepEqual(stateDisagrees(null, { strip: '3 pages built' }), [])
  assert.deepEqual(stateDisagrees(b('partly'), { strip: null, chat: null, card: null }), [])
  // a card that says something else: live at an address, being built, an app's own word
  for (const card of ['Website · Live · alpha.example', 'Website · Building', 'App · App failed', 'Website · Draft']) assert.deepEqual(stateDisagrees(b('partly'), { card }), [], card)
  assert.deepEqual(stateDisagrees(b('done'), { chat: 'A repair shop site usually needs four things.' }), [])
})

const shot = (id, extra = {}) => ({ width: 'desk', id, title: id, flow: 'f', file: `img/${id}.jpg`, reached: true, w: 1440, h: 900, audit: {}, checks: { raw: [], state: null, wait: [], dead: [], shift: 0 }, ...extra })
const RAW = { zone: 'chat', text: 'cb/x: HTTP 500 {"error":"no model here"}', box: [1, 2, 3, 4] }

test('defects: one entry per kind, per rule for axe, with every node counted', () => {
  const s = shot('a', {
    checks: { raw: [RAW], state: { run: 'r', state: 'partly', wrong: [{ where: 'strip', text: '3 pages built', why: 'the build is partly', box: [0, 0, 9, 9] }] }, wait: [{ path: '/api/run', ms: 1400, during: 'act' }], dead: [{ name: 'Resume' }], shift: 0.25 },
    axe: { violations: [{ id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', count: 7, nodes: [{ target: '.x', box: [0, 0, 5, 5] }] }, { id: 'color-contrast', impact: 'serious', help: 'Contrast', count: 2, nodes: [] }] }
  })
  const d = defectsOf(s)
  assert.deepEqual(d.map(x => [x.key, x.count]), [['raw', 1], ['state', 1], ['dead', 1], ['axe:button-name', 7], ['axe:color-contrast', 2], ['wait', 1], ['shift', 1]])
  for (const x of d) assert.ok(KINDS[x.kind], x.kind)
  assert.deepEqual(defectsOf(shot('b')), [])
  assert.deepEqual(defectsOf(shot('c', { checks: { shift: 0.1 } })), [], 'a shift of 0.1 is the limit, not over it')
  assert.deepEqual(defectsOf({ ...s, reached: false }), [], 'a step not reached has nothing measured')
})

test('the ratchet: a count may go down, never up; a step with no entry counts from nothing', () => {
  const one = shot('a', { checks: { raw: [RAW] } }), two = shot('a', { checks: { raw: [RAW, RAW] } }), none = shot('a')
  const base = accept(null, [one])
  assert.deepEqual(base.steps, { 'desk:a': { raw: 1 } })
  assert.deepEqual(ratchet(base, [one]), { fresh: [], fixed: [] })
  assert.deepEqual(ratchet(base, [two]).fresh.map(f => [f.step, f.key, f.was, f.now]), [['desk:a', 'raw', 1, 2]])
  assert.deepEqual(ratchet(base, [none]).fixed.map(f => [f.key, f.was, f.now]), [['raw', 1, 0]])
  // a new step, and no baseline at all
  assert.equal(ratchet(base, [shot('new', { checks: { dead: [{ name: 'x' }] } })]).fresh.length, 1)
  assert.equal(ratchet(null, [one]).fresh.length, 1)
  // a step not reached is not compared: it says nothing of its defects
  assert.deepEqual(ratchet(base, [{ ...two, reached: false }]), { fresh: [], fixed: [] })
})

test('waits and layout shift are reported and never gate; the phone and the desk are counted apart', () => {
  const s = shot('a', { checks: { wait: [{ path: '/api/x', ms: 2000, during: 'step' }], shift: 0.4 } })
  assert.deepEqual(ratchet(null, [s]).fresh, [])
  assert.deepEqual(countsOf([s]), { 'desk:a': { wait: 1, shift: 1 } })
  const phone = { ...shot('a', { checks: { raw: [RAW] } }), width: 'phone' }
  assert.equal(ratchet(accept(null, [shot('a', { checks: { raw: [RAW] } })]), [phone]).fresh[0].step, 'phone:a')
})

test('accepting a run keeps the steps it did not capture, and drops a step that came clean', () => {
  const base = { steps: { 'desk:kept': { raw: 3 }, 'desk:a': { raw: 2 }, 'desk:b': { dead: 1 } } }
  const next = accept(base, [shot('a', { checks: { raw: [RAW] } }), shot('b'), { ...shot('c'), reached: false }])
  assert.deepEqual(next.steps, { 'desk:a': { raw: 1 }, 'desk:kept': { raw: 3 } })
})

test('the report: totals per kind, axe per rule, and which are new', () => {
  const shots = [shot('a', { checks: { raw: [RAW] }, axe: { violations: [{ id: 'label', impact: 'critical', help: 'Labels', count: 2, nodes: [] }] } }), shot('b', { axe: { violations: [{ id: 'label', impact: 'critical', help: 'Labels', count: 1, nodes: [] }] } })]
  const r = report(shots, { steps: { 'desk:a': { raw: 1, 'axe:label': 2 } } })
  assert.deepEqual(r.totals, { raw: { steps: 1, count: 1 }, axe: { steps: 2, count: 3 } })
  assert.deepEqual(r.axe, { label: { steps: 2, nodes: 3 } })
  assert.deepEqual(r.defects.filter(d => d.new).map(d => d.step), ['desk:b'])
})
