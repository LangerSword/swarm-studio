// A game's Plan board opens its plan's own chat, docked at the bottom (decision 0015; the owner, 2026-11-15:
// "i dont even see the chat anymore here"). Only a new game's talk opened the chat; a plan opened from its project
// card, the address or a reload showed the board alone. web/planchat.js, GET /api/talk/plan/:id, chats.forPlan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planRoutes } from '../server/plans.mjs'
import { talkRoutes } from '../server/talk.mjs'
import { chatStore } from '../engine/chats.mjs'
import { planChatOpen } from '../web/planchat.js'
import { studioModules } from '../server/page.mjs'

test('a plan\'s chat: the one that points at it, or one made for a plan that has none, and the same one after', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'planchat-'))
  const plans = planRoutes({ dataDir: dir, godot: () => false })
  const talks = talkRoutes({ dataDir: dir, plans, env: () => ({ godot: false }) })
  const srv = createServer((req, res) => { const url = new URL(req.url, 'http://x'); if (!plans(req, res, url) && !talks(req, res, url)) res.writeHead(404).end() })
  await new Promise(r => srv.listen(0, r))
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const plan = await fetch(`${base}/api/plans`, { method: 'POST', body: JSON.stringify({ idea: 'Rank Juggler, a stylish brawler with air juggles' }) }).then(r => r.json())
    const first = await fetch(`${base}/api/talk/plan/${plan.id}`).then(r => r.json())
    assert.equal(first.chat.kind, 'game')
    assert.equal(first.chat.plan, plan.id)
    assert.equal(first.chat.turns[0].text, 'Rank Juggler, a stylish brawler with air juggles', 'the idea is its first line')
    assert.ok(first.step?.text, 'the plan\'s next step comes with it')
    const again = await fetch(`${base}/api/talk/plan/${plan.id}`).then(r => r.json())
    assert.equal(again.chat.id, first.chat.id, 'one chat per plan')
    assert.equal((await fetch(`${base}/api/talk/plan/p-0000000000`)).status, 404)
    assert.equal((await fetch(`${base}/api/talk/plan/..%2F..%2Fetc`)).status, 404)
    // a chat that already points at the plan is the one given
    const store = chatStore({ dataDir: dir })
    assert.equal(store.forPlan(plan).id, first.chat.id)
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('the board docks the chat and opens the plan\'s talk, unless a talk about it is already there', async () => {
  const run = async (talk, id, answer = { chat: { id: 'c-0123456789', turns: [] } }) => {
    const did = { docked: 0, started: [] }
    const t = { ...talk, start: o => did.started.push(o.chat), saidOf: () => [] }
    const out = await planChatOpen(id, { chat: on => { if (on) did.docked++ }, api: async () => ({ ok: true, json: async () => answer }), talk: t })
    return { out, ...did }
  }
  const off = { on: false, kind: 'site', plan: null, chat: null }
  // a plan opened from Projects or the address: docked, and its own talk in it
  assert.deepEqual(await run(off, 'p-71f17ab5f5'), { out: 'opened', docked: 1, started: ['c-0123456789'] })
  // its talk is already open (Make › Game, a game chat from Chats): docked, nothing restarted
  assert.deepEqual(await run({ on: true, kind: 'game', plan: 'p-71f17ab5f5', chat: 'c-0123456789' }, 'p-71f17ab5f5'), { out: 'kept', docked: 1, started: [] })
  // a new game's talk, its chat handed over while the plan was asked for: kept
  assert.deepEqual(await run({ on: true, kind: 'game', plan: null, chat: 'c-0123456789' }, 'p-71f17ab5f5'), { out: 'kept', docked: 1, started: [] })
  // another game's talk was open: this plan's talk replaces it
  assert.deepEqual(await run({ on: true, kind: 'game', plan: 'p-aaaaaaaaaa', chat: 'c-9999999999' }, 'p-71f17ab5f5'), { out: 'opened', docked: 1, started: ['c-0123456789'] })
  // a new game with no plan yet: the dock only
  assert.deepEqual(await run(off, null), { out: 'docked', docked: 1, started: [] })
})

test('the studio joins planchat.js before plan.js and studio.js', () => {
  const list = studioModules('web')
  assert.ok(list.indexOf('planchat.js') >= 0 && list.indexOf('planchat.js') < list.indexOf('studio.js'))
})
