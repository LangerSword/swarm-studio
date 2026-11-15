// What an empty picture on a game's Plan board says, and the board's next step (web/plantiles.js; the owner's game
// board, 2026-11-15: the Mocks and Backdrops were blank grey and nothing said what to do after the plan). The plan
// routes serve the next step (the game chat's own line) and, on a read, whether an image model is signed in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planTileStop, planNextHtml, planTileChip, planTileNoPainter } from '../web/plantiles.js'
import { planRoutes } from '../server/plans.mjs'
import { studioModules } from '../server/page.mjs'

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const say = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

test('every empty picture says why, with the one action that makes it', () => {
  const o = { noPainter: false, esc }
  assert.equal(say(planTileStop(null, { paint: 'mock:combat' }, o)), 'Not painted Draw')
  assert.match(planTileStop(null, { paint: 'mock:combat' }, o), /data-paint="mock:combat"/)
  assert.equal(say(planTileStop({ state: 'failed', error: 'no picture' }, { paint: 'sheet:cast' }, o)), "Didn't paint · no picture Try again")
  assert.equal(say(planTileStop(null, { style: true }, o)), 'Style not locked Lock style')
  assert.equal(say(planTileStop(null, { build: true }, o)), 'Not painted Build')
  // no image model signed in: every picture says so, and the action is Set up
  for (const does of [{ paint: 'mock:boss' }, { style: true }, { build: true }]) assert.equal(say(planTileStop(null, does, { noPainter: true, esc })), 'No image model Set up')
  // a picture nothing can make yet says nothing
  assert.equal(planTileStop(null, null, o), '')
})

test('the next step: the chat\'s own line, or the stop when no image model is signed in', () => {
  assert.equal(say(planNextHtml({ next: 'Next: the Cast sketch sheet, 20 options to pick from.' }, { noPainter: false, writing: false, esc })), 'Next: the Cast sketch sheet, 20 options to pick from.')
  assert.equal(say(planNextHtml({ next: 'x' }, { noPainter: true, writing: false, esc })), 'Pictures need an image model. Set up')
  assert.equal(planNextHtml({ next: 'x' }, { noPainter: false, writing: true, esc }), '', 'not while the crew write the cards in')
  assert.equal(planNextHtml({}, { noPainter: false, writing: false, esc }), '')
})

test('an action runs its own thing and keeps the tile from being selected; the 503 is read as no image model', () => {
  const ran = []
  const run = { setup: () => ran.push('setup'), build: () => ran.push('build'), lockStyle: () => ran.push('style'), paint: what => ran.push(`paint ${what}`) }
  const chip = attrs => ({ closest: () => ({ hasAttribute: a => a in attrs, dataset: attrs }) })
  // a stand-in for an element: planTileChip asks for Element, so give it one when the DOM is not there
  globalThis.Element ??= class {}
  const el = attrs => Object.assign(Object.create(globalThis.Element.prototype), chip(attrs))
  assert.equal(planTileChip(el({ 'data-setup': '' }), run), true)
  planTileChip(el({ 'data-build': '' }), run)
  planTileChip(el({ 'data-style-lock': '' }), run)
  planTileChip(el({ paint: 'mock:ult' }), run)
  assert.deepEqual(ran, ['setup', 'build', 'style', 'paint mock:ult'])
  assert.equal(planTileChip(null, run), false)
  assert.equal(planTileNoPainter({ status: 503, message: 'sign in an image model first' }), true)
  assert.equal(planTileNoPainter({ status: 503, message: 'the build is running' }), false)
  assert.equal(planTileNoPainter({ status: 400, message: 'sign in an image model first' }), false)
})

test('the plan routes serve the next step, and a read says whether an image model is signed in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'plantiles-'))
  let signedIn = false
  const paint = Object.assign(async () => ({ ok: false }), { ready: async () => signedIn })
  const handle = planRoutes({ dataDir: dir, paint, godot: () => false })
  const srv = createServer((req, res) => { if (!handle(req, res, new URL(req.url, 'http://x'))) res.writeHead(404).end() })
  await new Promise(r => srv.listen(0, r))
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const made = await fetch(`${base}/api/plans`, { method: 'POST', body: JSON.stringify({ idea: 'a small action RPG: rats with swords defend a night market' }) }).then(r => r.json())
    assert.match(made.next, /not locked yet/, made.next)
    const read = await fetch(`${base}/api/plans/${made.id}`).then(r => r.json())
    assert.equal(read.painter, false)
    signedIn = true
    assert.equal((await fetch(`${base}/api/plans/${made.id}`).then(r => r.json())).painter, true)
    // a paint with no image model is the 503 the board reads
    signedIn = false
    const r = await fetch(`${base}/api/plans/${made.id}/mocks`, { method: 'POST', body: '{}' })
    assert.equal(r.status, 503)
    assert.equal(planTileNoPainter({ status: r.status, message: (await r.json()).error }), true)
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('the studio joins plantiles.js before plan.js', () => {
  const list = studioModules('web')
  assert.ok(list.indexOf('plantiles.js') >= 0 && list.indexOf('plantiles.js') < list.indexOf('plan.js'))
})
