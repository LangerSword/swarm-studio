// Research from the chat (decision 0025 e, docs/specs/48-chat-helper.md; #606): the tool's run only reads and shows
// at most three pages, each with its source; a press keeps that one finding in the project's References.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { researchTool } from '../server/researchtool.mjs'
import { refStore } from '../engine/refs.mjs'

// a stand-in for bridge.py /web: Hermes's web_search and web_extract answers (example.com and .org resolve publicly)
const hits = [1, 2, 3, 4].map(i => ({ title: `Page ${i}`, url: `https://example.${i % 2 ? 'com' : 'org'}/p${i}`, description: `What page ${i} says about pricing.` }))
const web = async body => body.search ? { ok: true, res: { data: { web: hits } } } : { ok: true, res: { results: body.urls.map(url => ({ url, title: url, content: `The page ${url}.` })) } }

function project() {
  const projectsDir = mkdtempSync(join(tmpdir(), 'research-tool-'))
  mkdirSync(join(projectsDir, 'p1'))
  return { projectsDir, refs: refStore({ projectsDir }) }
}

test('the shape the chat helper asks for: a name, one line, string args, run and act', () => {
  const t = researchTool({ refs: null, web })
  assert.match(t.name, /^[a-z][a-z0-9_]{1,39}$/)
  assert.equal(typeof t.about, 'string')
  assert.ok(Object.values(t.args).every(v => typeof v === 'string'))
  assert.equal(typeof t.run, 'function'); assert.equal(typeof t.act, 'function')
})

test('run only reads: three cards at most, each with its source and what was taken; nothing is kept', async () => {
  const { projectsDir, refs } = project()
  const t = researchTool({ refs, web, limits: { searches: 1 } })
  const got = await t.run({ ask: 'how Notion lays out its pricing page' }, { kind: 'site', project: 'p1' })
  assert.ok(got.cards.length > 0 && got.cards.length <= 3, String(got.cards.length))
  for (const c of got.cards) {
    assert.match(c.source, /^https:\/\/example\.(com|org)\//)
    assert.match(c.note, /What page \d says about pricing/)
    assert.equal(c.pick, 'Keep this')
    assert.equal(c.act.project, 'p1'); assert.equal(c.act.finding.url, c.source)
  }
  assert.match(got.text, /Press one to keep it in the project's References/)
  assert.deepEqual(refs.list('p1'), [], 'the run kept nothing')
  assert.ok(!existsSync(join(projectsDir, 'p1', 'refs')) || readdirSync(join(projectsDir, 'p1', 'refs')).length === 0)
})

test('a press keeps that one finding in References; outside a project the cards are only to look at', async () => {
  const { refs } = project()
  const t = researchTool({ refs, web, limits: { searches: 1 } })
  const got = await t.run({ ask: 'notion pricing' }, { kind: 'site', project: 'p1' })
  const said = await t.act(got.cards[1].act, {})
  assert.match(said.text, /^Kept .+ in the project's References/)
  const kept = refs.list('p1')
  assert.equal(kept.length, 1)
  assert.equal(kept[0].source, 'research'); assert.equal(kept[0].url, got.cards[1].source)
  assert.match(refs.brief('p1'), /What the crew looked up on the web/)
  const loose = await t.run({ ask: 'notion pricing' }, { kind: 'site', project: null })
  assert.ok(loose.cards.every(c => !c.act && !c.pick))
  await assert.rejects(t.act({}, {}), /nothing to keep/)
})

test('nothing found, or no Hermes: one plain line and no cards', async () => {
  const t = researchTool({ refs: null, web: async () => ({ ok: false, absent: true, error: "Hermes isn't connected" }) })
  const got = await t.run({ ask: 'notion pricing' }, { project: 'p1' })
  assert.deepEqual(got.cards, [])
  assert.match(got.text, /^I could not find anything to use for "notion pricing": Hermes isn't connected/)
})

test('end to end: "look up how Notion does its pricing page" in a project\'s talk shows cards from the web; a press keeps one in References', { timeout: 90000 }, async () => {
  const { createServer } = await import('node:http')
  const { studio } = await import('../scripts/walkthrough-fixtures.mjs')
  const s = await studio({ model: ask => {
    const last = ask.messages?.at(-1)?.content || ''
    return /look up how Notion/i.test(last) ? 'I\'ll look that up.\n{"tool": "web_research", "args": {"ask": "how Notion lays out its pricing page"}}' : 'Tell me more.'
  } })
  // the stand-in Hermes: /web answers; it is attached as a bridge
  const calls = []
  const bridge = createServer((req, res) => {
    let b = ''
    req.on('data', c => (b += c))
    req.on('end', async () => {
      if (req.url !== '/web') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"image":false,"video":false}')
      const body = JSON.parse(b || '{}')
      calls.push(body)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await web(body)))
    })
  })
  await new Promise(r => bridge.listen(0, '127.0.0.1', r))
  const head = { 'content-type': 'application/json', 'x-swarm-token': 'walkthrough' }
  try {
    await s.api('/api/hermes/attach', { url: `http://127.0.0.1:${bridge.address().port}`, token: 'bridge-token-0123456789', pid: 4270, code: 1e10 })
    const made = await s.api('/api/studio', { kind: 'site', idea: 'A tea subscription' })
    const pid = made.project.id
    const j = await fetch(`${s.BASE}/api/discuss`, { method: 'POST', headers: head, body: JSON.stringify({ kind: 'site', project: pid, chat: made.chat?.id, said: [{ who: 'you', text: 'look up how Notion does its pricing page' }] }) }).then(r => r.json())
    assert.match(j.reply, /I'll look that up\. Here are 3 pages I read\. Press one to keep it in the project's References for the crew\./, JSON.stringify(j))
    assert.equal(j.cards.length, 3)
    assert.ok(j.cards.every(c => /^https:\/\/example\./.test(c.source) && c.note && c.pick === 'Keep this' && c.act === undefined))
    assert.ok(calls.some(c => c.search) && calls.some(c => c.urls), 'it searched and read through Hermes')
    assert.equal((await s.api(`/api/projects/${pid}/refs`)).refs.length, 0, 'the run kept nothing')
    const kept = await fetch(`${s.BASE}/api/helper/pick`, { method: 'POST', headers: head, body: JSON.stringify({ chat: j.chat, turn: j.turn, card: 'c2' }) }).then(r => r.json())
    assert.match(kept.text, /^Kept .+ in the project's References/)
    const { refs } = await s.api(`/api/projects/${pid}/refs`)
    assert.equal(refs.length, 1)
    assert.equal(refs[0].source, 'research'); assert.equal(refs[0].url, j.cards[1].source)
  } finally { bridge.close(); s.stop() }
})
