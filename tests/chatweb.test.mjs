// The app builder's web tools in the chat (decision 0025 c and e; docs/specs/48-chat-helper.md): web_search,
// web_fetch and clone_site through the helper runner, with stand-ins for Hermes's web tools and the site walk.
// They only read; cloning is a card's press, which starts one change to the app.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { helperKit } from '../engine/helpers.mjs'
import { chatTools } from '../server/chattools.mjs'
import { webReads } from '../engine/enginetools.mjs'
import { publicUrl } from '../engine/chatmedia.mjs'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])
const RUN = '2026-11-15T10-00-00-000Z'
function kit({ walkNote = '' } = {}) {
  const runsDir = mkdtempSync(join(tmpdir(), 'swarm-chatweb-'))
  const asked = { web: [], walk: [], change: [] }
  const reads = webReads({
    web: async body => {
      asked.web.push(body)
      if (body.search) return { ok: true, res: { data: { web: [1, 2, 3, 4].map(i => ({ title: `Result ${i}`, url: `https://r${i}.example/`, description: `About ${i}` })) } } }
      return { ok: true, res: { results: body.urls.map(url => ({ url, title: 'Boulder Club', content: '# Boulder Club\n\nClimbing in Cornwall, open late every night.' })) } }
    },
    walk: async url => { asked.walk.push(url); return walkNote ? { pages: [], note: walkNote } : { pages: [{ url, shots: [JPEG] }] } },
    check: url => publicUrl(url, { lookup: async host => [{ address: host.endsWith('.example') ? '93.184.216.34' : '10.0.0.7', family: 4 }] })
  })
  const helpers = helperKit(chatTools({ reads, runsDir, change: async (run, ask) => { asked.change.push({ run, ask }) } }))
  return { helpers, asked, runsDir, done: () => rmSync(runsDir, { recursive: true, force: true }) }
}

test('the three tools are offered in an app\'s talk only', () => {
  const k = kit()
  try {
    for (const name of ['web_search', 'web_fetch', 'clone_site']) assert.ok(k.helpers.has(name), name)
    assert.match(k.helpers.lines('app'), /web_search/)
    for (const kind of ['site', 'game', 'film']) assert.doesNotMatch(k.helpers.lines(kind) || '', /web_search|web_fetch|clone_site/, kind)
  } finally { k.done() }
})

test('web_search: three results at most, each with its address, and nothing to press', async () => {
  const k = kit()
  try {
    const r = await k.helpers.run('web_search', { q: 'climbing gym booking apps' }, { kind: 'app', run: RUN })
    assert.match(r.text, /climbing gym booking apps/)
    assert.deepEqual(r.cards.map(c => [c.title, c.source, c.note]), [1, 2, 3].map(i => [`Result ${i}`, `https://r${i}.example/`, `About ${i}`]))
    assert.ok(r.cards.every(c => !c.act), 'a search changes nothing')
    assert.deepEqual(k.asked.web, [{ search: 'climbing gym booking apps', limit: 3 }])
  } finally { k.done() }
})

test('web_fetch: the page\'s first line and its address; a private address is refused before Hermes is asked', async () => {
  const k = kit()
  try {
    const r = await k.helpers.run('web_fetch', { url: 'https://boulder.example/' }, { kind: 'app', run: RUN })
    assert.equal(r.text, 'Boulder Club says: Climbing in Cornwall, open late every night.')
    assert.deepEqual(r.cards.map(c => [c.title, c.source]), [['Boulder Club', 'https://boulder.example/']])
    const no = await k.helpers.run('web_fetch', { url: 'http://127.0.0.1:4319/api/state' }, { kind: 'app', run: RUN })
    assert.match(no.text, /^I could not read a web page .*: (only public web pages|only ordinary web links|that is not a link).$/)
    assert.deepEqual(no.cards, [])
    assert.equal(k.asked.web.length, 1)
  } finally { k.done() }
})

test('clone_site: a look at the site with its picture on disk; the press is what clones it, once', async () => {
  const k = kit()
  try {
    const r = await k.helpers.run('clone_site', { url: 'https://boulder.example/' }, { kind: 'app', run: RUN })
    const [card] = r.cards
    assert.equal(card.source, 'https://boulder.example/')
    assert.equal(card.pick, 'Clone it')
    assert.deepEqual(card.act, { do: 'clone', url: 'https://boulder.example/', run: RUN })
    // the picture is a file the Studio serves without the token, written before the card is shown
    assert.match(card.img, new RegExp(`^/img/${RUN}/clone-[a-f0-9]{12}\\.jpg$`))
    assert.deepEqual(readFileSync(join(k.runsDir, RUN, 'img', card.img.split('/').pop())), JPEG)
    assert.deepEqual(k.asked.change, [], 'looking clones nothing')
    // the press: one change to that run's app, asking the engine to crawl the address
    const turn = { cards: r.cards }
    const done = await k.helpers.pick(turn, card.id, { kind: 'app', run: RUN })
    assert.match(done.text, /cloning boulder\.example/)
    assert.equal(k.asked.change.length, 1)
    assert.equal(k.asked.change[0].run, RUN)
    assert.match(k.asked.change[0].ask, /https:\/\/boulder\.example\/.*web_crawl/)
    await assert.rejects(k.helpers.pick(turn, card.id, {}), /already done/)
  } finally { k.done() }
})

test('clone_site before there is an app, or with no browser: a look, nothing to press, no picture', async () => {
  const k = kit({ walkNote: 'Reading a site needs the film tools, which install with your first film.' })
  try {
    const r = await k.helpers.run('clone_site', { url: 'https://boulder.example/' }, { kind: 'app', run: null })
    assert.match(r.text, /Once the app has been built/)
    assert.equal(r.cards.length, 1)
    assert.ok(!r.cards[0].act && !r.cards[0].img)
    const noShot = await k.helpers.run('clone_site', { url: 'https://boulder.example/' }, { kind: 'app', run: RUN })
    assert.ok(!noShot.cards[0].img, 'no picture without a browser, and the card still says where it is from')
    assert.ok(!existsSync(join(k.runsDir, RUN, 'img')))
  } finally { k.done() }
})
