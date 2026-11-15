// A planner that does not answer, on the real server (docs/ux/states/chat-turn.md S13, S14): the talk routes answer
// with the reason in plain words and the one thing to do, never the provider's text, and the same message sent
// again (what Try again does) is answered once the model is back.
// Run: node --test tests/failroutes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startStudio } from '../scripts/studio-child.mjs'
import { CODES, isRaw } from '../engine/stopreason.mjs'

const WALK = /HTTP \d{3}|\{"error"|ECONN|\[object Object\]|undefined/
const plain = (text, name) => assert.ok(text && !WALK.test(text) && !isRaw(text), `${name}: ${text}`)

// a model endpoint the test steers: 'fail' (the provider's HTTP 500), 'ok' (one sentence), 'drop' (closes the socket)
async function fakeModel() {
  const ctl = { mode: 'fail', asked: [] }
  const srv = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      ctl.asked.push(body)
      if (ctl.mode === 'drop') return void req.socket.destroy()
      if (ctl.mode === 'fail') return void res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"no model here"}')
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Three pages would do: home, menu and visit.' } }] })}\n\ndata: [DONE]\n\n`)
    })
  })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  return { ctl, url: `http://127.0.0.1:${srv.address().port}`, close: () => { srv.closeAllConnections?.(); srv.close() } }
}

async function studio(model) {
  const dir = mkdtempSync(join(tmpdir(), 'fail-srv-'))
  const env = { ...process.env, SWARM_TOKEN: 't', SWARM_DATA_DIR: join(dir, 'data'), SWARM_RUNS_DIR: join(dir, 'data', 'runs'), SWARM_OUTPUT_DIR: join(dir, 'out'), HERMES_HOME: join(dir, 'hermes'), SWARM_HERMES_RUNNING: '0' }
  for (const k of Object.keys(env)) if (/_API_KEY$/.test(k) || /^SWARM_(PLANNER|WORKER|REVIEWER)_/.test(k) || /^SWARM_(STUDIO_)?BASE_URL$/.test(k)) delete env[k]
  if (model) Object.assign(env, { SWARM_API_KEY: 'test-key', SWARM_BASE_URL: model.url, SWARM_PLANNER_MODEL: 'cb/deepseek-v4.1-flash', SWARM_WORKER_MODEL: 'cb/deepseek-v4.1-flash' })
  const { child, base } = await startStudio({ env })
  const call = (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-swarm-token': 't', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { call, stop: () => { child.kill(); try { rmSync(dir, { recursive: true, force: true }) } catch {} } }
}

test('a talk the planner does not answer: the reason and the one thing to do, and the same message again is answered', { timeout: 60000 }, async () => {
  const model = await fakeModel()
  const s = await studio(model)
  try {
    const said = [{ who: 'you', text: 'A site for my bakery: what pages would you make?' }]
    for (const [name, body] of [['talk', { said, kind: 'site' }], ['ask', { said, kind: 'site', ask: true }], ['brief', { said, kind: 'site', brief: true }]]) {
      for (const mode of ['fail', 'drop']) {
        model.ctl.mode = mode
        const res = await s.call('/api/discuss', body)
        const j = await res.json()
        assert.equal(res.status, 502, `${name} ${mode}`)
        assert.ok(CODES.includes(j.reason?.code), `${name} ${mode}: ${JSON.stringify(j)}`)
        assert.equal(j.reason.code, 'model', `${name} ${mode}`)
        plain(j.error, `${name} ${mode}: error`)
        plain(j.reason.message, `${name} ${mode}: message`)
        plain(j.reason.action, `${name} ${mode}: action`)
        assert.ok(!j.reply && !j.brief && !j.chat, `${name} ${mode}: nothing is answered or saved as Hermia's`)
      }
    }
    // the provider's own words are kept when they are words
    model.ctl.mode = 'fail'
    assert.equal((await (await s.call('/api/discuss', { said, kind: 'site' })).json()).reason.message, "The model didn't answer (no model here).")
    // Try again: the same message, sent again, is asked of the model again, and answered
    const before = model.ctl.asked.length
    model.ctl.mode = 'ok'
    const again = await s.call('/api/discuss', { said, kind: 'site' })
    const aj = await again.json()
    assert.equal(again.status, 200)
    assert.match(aj.reply, /Three pages would do/)
    assert.ok(model.ctl.asked.length > before && model.ctl.asked.at(-1).includes('what pages would you make'), 'the model was asked the same message again')
    // and it is saved once, as one turn of the person's and one of the planner's
    const chat = await (await s.call(`/api/chats/${aj.chat}`)).json()
    assert.deepEqual(chat.turns.map(t => t.who), ['person', 'planner'])

    // a game chat's turn: the plan's own next step is still said, and the failure goes beside it, never into the chat
    model.ctl.mode = 'fail'
    const game = await s.call('/api/talk', { kind: 'game', said: 'a tiny platformer with one hero' })
    const gj = await game.json()
    assert.equal(game.status, 200)
    assert.equal(gj.failed?.code, 'model', JSON.stringify(gj.failed))
    plain(gj.failed.message, 'game: message')
    plain(gj.turn.text, 'game: the turn')
    assert.ok(!JSON.stringify(gj.chat).includes('no model here'), 'the failure is not written into the chat')
    // an unknown chat is refused in words
    plain((await (await s.call('/api/talk/c-0000000000', { said: 'hello' })).json()).error, 'no such chat')
  } finally { s.stop(); model.close() }
})

test('no planner model: the talk says so, with the Models action', { timeout: 30000 }, async () => {
  const s = await studio(null)
  try {
    const res = await s.call('/api/discuss', { said: [{ who: 'you', text: 'hello' }], kind: 'site' })
    const j = await res.json()
    assert.equal(res.status, 503)
    // with no Hermes and no key the gate may answer first (Hermes away); either way it is a reason, in words
    if (j.hermes) { plain(j.message, 'hermes'); plain(j.action, 'hermes action') } else assert.deepEqual(j.reason, { code: 'setup', message: 'No planner model yet.', action: 'Pick one in Models.' })
    plain(j.error, 'error')
  } finally { s.stop() }
})
