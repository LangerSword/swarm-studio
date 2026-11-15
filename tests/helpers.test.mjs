// The chat as the helper (decision 0025 e, issue #617): the planner calls a tool, the chat shows at most three cards,
// each with its source, and only a press on a card saved in a turn does anything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helperKit, cardsView, cardsLine, MAX_CARDS } from '../engine/helpers.mjs'
import { discuss, say } from '../engine/talkplan.mjs'
import { chatStore } from '../engine/chats.mjs'
import { helperRoutes } from '../server/helpers.mjs'
import { studio } from '../scripts/walkthrough-fixtures.mjs'

const acted = []
const swords = {
  name: 'find_art', about: 'find pictures', args: { q: 'what to look for' },
  run: async ({ q }) => ({
    text: `Found some ${q}.`,
    cards: [
      { title: 'Iron sword', source: 'pack A, CC0', img: '/api/library/file?id=a', act: { id: 'a' } },
      { title: 'No source', act: { id: 'x' } },
      { title: 'Bone sword', source: 'pack B', img: 'javascript:alert(1)', act: { id: 'b' } },
      { title: 'Glass sword', source: 'pack C' },
      { title: 'Fourth', source: 'pack D', act: { id: 'd' } }
    ]
  }),
  act: async a => { acted.push(a); if (a.id === 'boom') throw new Error('no'); return { text: `Kept ${a.id}.` } }
}
const gameOnly = { name: 'cast_pick', about: 'pick a character', kinds: ['game'], args: {}, run: async () => ({ text: 'x', cards: [] }) }
const broken = { name: 'broken', about: 'Look things up', args: {}, run: async () => { throw new Error('the bridge is closed') } }

test('the runner keeps the rules: three cards, each with a source, a safe picture, the action kept back', async () => {
  const kit = helperKit([swords, gameOnly, broken])
  const got = await kit.run('find_art', { q: 'swords' }, { kind: 'site' })
  assert.equal(got.text, 'Found some swords.')
  assert.equal(got.cards.length, MAX_CARDS)
  assert.deepEqual(got.cards.map(c => c.title), ['Iron sword', 'Bone sword', 'Glass sword'], 'a card without its source is dropped')
  assert.equal(got.cards[1].img, undefined, 'only a path or an https picture')
  assert.deepEqual(got.cards[0].act, { id: 'a' })
  const seen = cardsView(got.cards)
  assert.equal(seen[0].act, undefined, 'the browser never gets the action')
  assert.equal(seen[0].pick, 'Use this')
  assert.equal(seen[2].pick, undefined, 'a card with no action is only to look at')
  assert.match(cardsLine(seen), /\[Shown: 1\. Iron sword \(pack A, CC0\); 2\. Bone sword/)
  assert.match((await kit.run('broken', {}, {})).text, /^I could not look things up: the bridge is closed\.$/)
  assert.match((await kit.run('cast_pick', {}, { kind: 'site' })).text, /not something I can do/, 'a tool offered only in a game')
  assert.match(kit.lines('site'), /- find_art: find pictures\. Args: "q" \(what to look for\)/)
  assert.doesNotMatch(kit.lines('site'), /cast_pick/)
  assert.match(kit.lines('game'), /cast_pick/)
  assert.equal(helperKit([]).lines('site'), '', 'no tools: the prompt is as before')
})

test('a reply calls a tool with prose before it, alone, or names one this talk does not have', async () => {
  const kit = helperKit([swords])
  assert.deepEqual(kit.toolOf('Let me look.\n{"tool": "find_art", "args": {"q": "pixel sword", "n": 3, "x": "y"}}', 'site'), { name: 'find_art', args: { q: 'pixel sword' }, say: 'Let me look.' })
  assert.deepEqual(kit.toolOf('{"tool":"find_art","args":{"q":"axe"}}'), { name: 'find_art', args: { q: 'axe' }, say: '' })
  assert.equal(kit.toolOf('{"tool": "rm_rf", "args": {}}').unknown, true)
  assert.equal(kit.toolOf('{"build": true, "brief": "A bakery"}'), null)
  assert.equal(kit.toolOf('Just words.'), null)
  // discuss(): the tools are in the prompt; a reply that is only the tool block is a tool, not "no answer"
  const sent = []
  const out = await discuss({ said: [{ who: 'you', text: 'find me a pixel sword' }], kind: 'site', helpers: kit, chat: async m => { sent.push(m); return '{"tool": "find_art", "args": {"q": "pixel sword"}}' } })
  assert.deepEqual(out, { tool: { name: 'find_art', args: { q: 'pixel sword' }, say: '' } })
  assert.match(sent[0][0].content, /find_art/)
  // without tools, the talk is what it was
  const plain = await discuss({ said: [{ who: 'you', text: 'hi' }], kind: 'site', chat: async m => { sent.push(m); return 'Hello! What are we making?' } })
  assert.deepEqual(plain, { reply: 'Hello! What are we making?' })
  assert.doesNotMatch(sent.at(-1)[0].content, /find_art/)
})

test('a game talk asks for a tool in its JSON: its cards are kept on the planner\'s turn, and the next turn sees them', async () => {
  const kit = helperKit([swords])
  const chat = { id: 'c1', kind: 'game', turns: [], decisions: {} }
  const asked = []
  const model = async m => { asked.push(m); return JSON.stringify({ say: 'Looking for swords.', decide: {}, ask: null, tool: { name: 'find_art', args: { q: 'swords' } } }) }
  const turn = await say(chat, { said: 'find me a pixel sword for a platformer' }, { model, helpers: { kit, ctx: { chat: 'c1' } } })
  assert.match(turn.text, /Found some swords\.$/, 'what the tool found closes the turn (a first turn opens with its own lead)')
  assert.equal(turn.cards.length, 3)
  assert.equal(turn.tool, undefined)
  assert.match(asked[0][0].content, /"tool": \{"name"/, 'the game prompt says how to ask for one')
  await say(chat, { said: 'the first one' }, { model: async m => { asked.push(m); return '{"say": "Good.", "decide": {}, "ask": null}' }, helpers: { kit, ctx: {} } })
  assert.match(asked[1][1].content, /\[Shown: 1\. Iron sword \(pack A, CC0\)/)
})

test('a press runs the action kept on the saved turn, once; what the browser sends is never the action', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'helpers-'))
  const chats = chatStore(dataDir)
  const kit = helperKit([swords])
  const c = chats.create({ kind: 'site' })
  await chats.say(c.id, { who: 'person', text: 'find me a sword' })
  const got = await kit.run('find_art', { q: 'swords' }, {})
  await chats.say(c.id, { who: 'planner', text: 'Here.', cards: got.cards })
  const turn = chats.get(c.id).turns.at(-1)
  assert.equal(turn.cards[0].act.id, 'a', 'the action is kept on the turn')
  const route = helperRoutes({ kit, chats })
  const srv = http.createServer((req, res) => { if (!route(req, res, new URL(req.url, 'http://x'))) res.writeHead(404).end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const pick = body => fetch(`http://127.0.0.1:${srv.address().port}/api/helper/pick`, { method: 'POST', body: JSON.stringify(body) })
  try {
    acted.length = 0
    const res = await pick({ chat: c.id, turn: turn.id, card: 'c1', act: { id: 'boom' } })
    assert.equal(res.status, 200)
    const j = await res.json()
    assert.equal(j.text, 'Kept a.')
    assert.deepEqual(acted, [{ id: 'a' }], 'the saved action ran, not the one sent')
    assert.equal(j.card.act, undefined)
    assert.ok(chats.get(c.id).turns.find(t => t.id === turn.id).cards[0].picked)
    assert.equal(chats.get(c.id).turns.at(-1).text, 'Kept a.', 'Hermia says it in the chat')
    assert.equal((await pick({ chat: c.id, turn: turn.id, card: 'c1' })).status, 409, 'once')
    assert.equal((await pick({ chat: c.id, turn: turn.id, card: 'c3' })).status, 400, 'a card only to look at')
    assert.equal((await pick({ chat: c.id, turn: turn.id, card: 'c9' })).status, 404)
    assert.equal((await pick({ chat: c.id, turn: 't1', card: 'c1' })).status, 404, 'only a planner turn')
    assert.equal(acted.length, 1)
  } finally { srv.close() }
})

test('end to end: "find me a pixel sword" in a project\'s talk shows cards from the library, and a press keeps one in References', async () => {
  const s = await studio({ model: ask => {
    const last = ask.messages?.at(-1)?.content || ''
    return /pixel sword/.test(last) ? 'I\'ll look in the library.\n{"tool": "library_search", "args": {"q": "sword"}}' : 'Tell me more.'
  } })
  const head = { 'content-type': 'application/json', 'x-swarm-token': 'walkthrough' }
  try {
    // a pack of one's own with two swords, so the library has something without a download
    const dir = mkdtempSync(join(tmpdir(), 'helpers-pack-'))
    mkdirSync(join(dir, 'weapons'), { recursive: true })
    const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
    writeFileSync(join(dir, 'weapons', 'pixel_sword.png'), PNG)
    writeFileSync(join(dir, 'weapons', 'iron_sword.png'), PNG)
    await s.api('/api/library/import', { path: dir, name: 'My Swords', credit: 'Ana', license: 'CC0' })
    const made = await s.api('/api/studio', { kind: 'site', idea: 'A shop for sword replicas' })
    const pid = made.project.id
    const j = await fetch(`${s.BASE}/api/discuss`, { method: 'POST', headers: head, body: JSON.stringify({ kind: 'site', project: pid, chat: made.chat?.id, said: [{ who: 'you', text: 'find me a pixel sword' }] }) }).then(r => r.json())
    assert.match(j.reply, /I'll look in the library\. Here are 2 from the asset library\. Press one to keep it with the project's References\./)
    assert.equal(j.cards.length, 2)
    assert.match(j.cards[0].source, /your pack my_swords: Ana, CC0/)
    assert.equal(j.cards[0].act, undefined)
    assert.equal(j.cards[0].pick, 'Keep this')
    assert.match(j.heard, /\[Shown: 1\./)
    const kept = await fetch(`${s.BASE}/api/helper/pick`, { method: 'POST', headers: head, body: JSON.stringify({ chat: j.chat, turn: j.turn, card: 'c1' }) }).then(r => r.json())
    assert.match(kept.text, /^Kept .* with the project's References\. Credit: Ana, CC0\.$/)
    const { refs } = await s.api(`/api/projects/${pid}/refs`)
    assert.equal(refs.length, 1)
    assert.equal(refs[0].source, 'chat')
    // a talk with no tool asked is as it was
    const plain = await fetch(`${s.BASE}/api/discuss`, { method: 'POST', headers: head, body: JSON.stringify({ kind: 'site', project: pid, chat: j.chat, said: [{ who: 'you', text: 'hello' }] }) }).then(r => r.json())
    assert.equal(plain.reply, 'Tell me more.')
    assert.equal(plain.cards, undefined)
  } finally { s.stop() }
})
