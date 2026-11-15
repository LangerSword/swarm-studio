// A game's art references (issue #543; the owner, 2026-11-15: "Game's art references"): a picture dropped on a
// game's Plan board is kept with the plan, given to the painter beside the picked sheets, named by the locked style
// and the game brief, can be removed or used as is, and joins the project's References (or Assets, used as is)
// when the plan's talk joins a project.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addPlanRef, removePlanRef, planRefAsIs, planRefs, planRefLines, carryPlanRefs, PLAN_REF_MAX } from '../engine/planrefs.mjs'
import { lockStyle, gameBrief } from '../engine/planart.mjs'
import { replan } from '../engine/plan.mjs'
import { planRoutes } from '../server/plans.mjs'
import { chatStore } from '../engine/chats.mjs'

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')

test('a picture joins the plan, is named by the style and the brief, and can be used as is or removed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planrefs-'))
  const plan = { id: 'p-abc123', cards: [], sheets: [], style: { name: '', locked: false, refs: [] } }
  const r = addPlanRef(plan, dir, { name: 'moody forest.png', buf: PNG })
  assert.match(r.id, /^ar[0-9a-f]{8}$/)
  assert.equal(r.src, `/plans/p-abc123/${r.file}`)
  assert.ok(existsSync(join(dir, r.file)))
  assert.throws(() => addPlanRef(plan, dir, { name: 'notes.pdf', buf: PNG }), /PNG, JPEG or WebP/)
  lockStyle(plan, true)
  assert.deepEqual(plan.style.refs, [r.src], 'like a picked sheet, the locked style names it')
  assert.match(planRefLines(plan), /match their look[\s\S]*moody forest\.png/)
  planRefAsIs(plan, r.id)
  lockStyle(plan, true)
  assert.deepEqual(plan.style.refs, [], 'one used as is is placed, not matched')
  assert.match(planRefLines(plan), /place as they are/)
  removePlanRef(plan, r.id)
  assert.equal(planRefs(plan).length, 0)
  assert.equal(planRefLines(plan), '')
  for (let i = 0; i < PLAN_REF_MAX; i++) addPlanRef(plan, dir, { name: `a${i}.png`, buf: PNG })
  assert.throws(() => addPlanRef(plan, dir, { name: 'one-more.png', buf: PNG }), /at most/)
})

test('a re-plan keeps the art references', () => {
  const plan = { id: 'p-abc123', v: 1, kind: 'game', created: 'x', idea: 'a forest brawler', answers: {}, cards: [], refs: [{ id: 'ar00000000', name: 'a.png', file: 'ar00000000.png', src: '/plans/p-abc123/ar00000000.png', asIs: false, removed: null, carried: [] }] }
  replan(plan, { note: 'smaller' })
  assert.equal(plan.refs?.length, 1)
  assert.match(gameBrief(plan), /The owner's art references/)
})

test('carried into a project once each: a look to References, one used as is to Assets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'planrefs-'))
  const plan = { id: 'p-abc123', cards: [] }
  const a = addPlanRef(plan, dir, { name: 'look.png', buf: PNG })
  const b = addPlanRef(plan, dir, { name: 'logo.png', buf: PNG })
  planRefAsIs(plan, b.id)
  const got = []
  assert.equal(carryPlanRefs(plan, dir, 'proj1', (pid, x) => got.push({ pid, name: x.name, asIs: x.asIs, bytes: x.buf.length })), 2)
  assert.deepEqual(got, [{ pid: 'proj1', name: 'look.png', asIs: false, bytes: PNG.length }, { pid: 'proj1', name: 'logo.png', asIs: true, bytes: PNG.length }])
  assert.equal(carryPlanRefs(plan, dir, 'proj1', () => got.push('again')), 0, 'never twice into one project')
  assert.deepEqual(plan.refs.find(r => r.id === a.id).carried, ['proj1'])
})

test('the routes: a drop answers like References, Use as is like Assets, and a talk joining a project carries them', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'planrefs-routes-'))
  const carried = []
  const plans = planRoutes({ dataDir, toProject: (pid, x) => carried.push({ pid, name: x.name, asIs: x.asIs }) })
  const srv = http.createServer((req, res) => { if (!plans(req, res, new URL(req.url, 'http://x'))) res.writeHead(404).end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const u = `http://127.0.0.1:${srv.address().port}`
  try {
    const plan = await fetch(`${u}/api/plans`, { method: 'POST', body: JSON.stringify({ idea: 'a forest brawler' }) }).then(r => r.json())
    const add = await fetch(`${u}/api/plans/${plan.id}/refs?name=mood.png&source=upload`, { method: 'POST', body: PNG }).then(r => r.json())
    assert.equal(add.ref.name, 'mood.png')
    assert.equal(add.refs.length, 1)
    assert.equal((await fetch(`${u}${add.ref.src}`)).status, 200, 'served like the plan\'s own pictures')
    const bad = await fetch(`${u}/api/plans/${plan.id}/refs?name=x.gif`, { method: 'POST', body: PNG })
    assert.equal(bad.status, 400)
    const asIs = await fetch(`${u}/api/plans/${plan.id}/assets`, { method: 'POST', body: JSON.stringify({ ref: add.ref.id }) }).then(r => r.json())
    assert.deepEqual(asIs.assets.map(r => r.name), ['mood.png'])
    const two = await fetch(`${u}/api/plans/${plan.id}/refs?name=second.png`, { method: 'POST', body: PNG }).then(r => r.json())
    const gone = await fetch(`${u}/api/plans/${plan.id}/refs/${two.ref.id}/remove`, { method: 'POST', body: '{}' }).then(r => r.json())
    assert.deepEqual(gone.refs.map(r => r.name), ['mood.png'])
    assert.equal((await fetch(`${u}/api/plans/p-nope00/refs?name=a.png`, { method: 'POST', body: PNG })).status, 404)
    // the talk carries the plan into a project
    const chats = chatStore({ dataDir, onMove: (chat, pid) => { if (chat?.plan) plans.carry(chat.plan, pid) } })
    const c = chats.create({ kind: 'game' })
    await chats.update(c.id, x => { x.plan = plan.id })
    await chats.moveTo(c.id, 'proj1')
    assert.deepEqual(carried, [{ pid: 'proj1', name: 'mood.png', asIs: true }])
    await chats.moveTo(c.id, 'proj1')
    assert.equal(carried.length, 1, 'once')
  } finally { srv.close() }
})

test('the studio page carries the Plan board\'s art references before the board, and their names say planRef', async () => {
  const { studioModules } = await import('../server/page.mjs')
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const list = studioModules(join(root, 'web'))
  assert.ok(list.indexOf('refdrop.js') >= 0 && list.indexOf('refdrop.js') < list.indexOf('planrefs.js') && list.indexOf('planrefs.js') < list.indexOf('plan.js'))
  const src = readFileSync(join(root, 'web', 'planrefs.js'), 'utf8')
  for (const m of src.matchAll(/^(?:export )?(?:const|let|function) (\w+)/gm)) assert.match(m[1], /planRef/i, m[1])
})
