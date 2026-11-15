// Research before planning (engine/research.mjs): only when asked, within its limits, public pages only, and each
// finding kept in the project's References with its link and what was taken (engine/refs.mjs, source research).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wantsResearch, research, researchBrief, RESEARCH } from '../engine/research.mjs'
import { refStore } from '../engine/refs.mjs'

// a stand-in for bridge.py /web: Hermes's web_search and web_extract answers, and every call it got
function standInWeb({ hits = n => [1, 2, 3, 4, 5, 6].map(i => ({ title: `${n} result ${i}`, url: `https://site${i}.example/${encodeURIComponent(n)}`, description: `about ${n} ${i}` })), page = u => `The page at ${u} says useful things.`, slow = 0 } = {}) {
  const calls = []
  const web = async body => {
    calls.push(body)
    if (slow) await new Promise(r => setTimeout(r, slow))
    if (body.search) return { ok: true, res: { data: { web: hits(body.search).slice(0, body.limit) } } }
    return { ok: true, res: { results: body.urls.map(url => ({ url, title: `Title of ${url}`, content: page(url) })) } }
  }
  return { web, calls }
}
const isPublic = async u => { if (/\/\/(10\.|127\.|localhost|192\.168\.)/.test(u)) throw new Error('only public web pages') }

test('it runs only when the person asks: a plain brief looks nothing up', () => {
  for (const plain of ['A website for a ramen bar in Osaka', 'An app to track my running, with a dark theme', 'A game where a cat explores a lighthouse', 'Make the hero bigger and look nicer']) assert.equal(wantsResearch(plain), '', plain)
  assert.equal(wantsResearch('A tea room site. Look at how Notion does its pricing page, and copy nothing.'), 'Look at how Notion does its pricing page, and copy nothing')
  assert.match(wantsResearch('Research what bike shops in Leeds charge for a service'), /^Research what bike shops/)
  assert.match(wantsResearch('A cafe site.\nLook up the opening hours of Kew Gardens'), /^Look up the opening hours/)
  assert.match(wantsResearch('see how Duolingo does streaks'), /Duolingo/)
})

test('within its limits: three searches, four pages, the model picks what to take', async () => {
  const { web, calls } = standInWeb()
  const said = []
  const chat = async messages => {
    said.push(messages[0].content)
    if (messages[0].content.includes('plan a short web search')) return '{"queries":["notion pricing page","notion plans compared","notion free plan limits","one too many"]}'
    const urls = [...messages[1].content.matchAll(/^PAGE (\S+)/gm)].map(m => m[1])
    return JSON.stringify({ findings: urls.map(url => ({ url, took: `What ${url} shows about pricing.` })).concat([{ url: 'https://not-read.example', took: 'made up' }]) })
  }
  const got = await research({ ask: 'Look at how Notion does its pricing page', kind: 'site', web, chat, isPublic })
  assert.equal(calls.filter(c => c.search).length, RESEARCH.searches)
  const reads = calls.filter(c => c.urls)
  assert.equal(reads.length, 1)
  assert.equal(reads[0].urls.length, RESEARCH.pages)
  // the first hit of each search before the second of any
  assert.deepEqual(reads[0].urls.slice(0, 3).map(u => decodeURIComponent(u.split('/').pop())), ['notion pricing page', 'notion plans compared', 'notion free plan limits'])
  assert.equal(got.findings.length, RESEARCH.pages, 'a page it did not read is never a finding')
  assert.ok(got.findings.every(f => f.url.startsWith('https://') && f.took && f.title && f.query))
  assert.ok(calls.every(c => (c.limit || 0) <= RESEARCH.results))
})

test('nothing private: a result on a private address is never read', async () => {
  const { web, calls } = standInWeb({ hits: () => [{ title: 'router', url: 'http://192.168.1.1/admin', description: 'x' }, { title: 'local', url: 'http://localhost:4319/api/projects', description: 'x' }, { title: 'ok', url: 'https://public.example/a', description: 'a public page' }] })
  const got = await research({ ask: 'look up something', web, isPublic, limits: { searches: 1 } })
  assert.deepEqual(calls.find(c => c.urls).urls, ['https://public.example/a'])
  assert.deepEqual(got.findings.map(f => f.url), ['https://public.example/a'])
  // with the real check: an address that is not a public web page is refused before it is passed on
  const real = await research({ ask: 'look up x', web: standInWeb({ hits: () => [{ title: 'a', url: 'http://127.0.0.1:9/x', description: 'd' }] }).web, limits: { searches: 1 } })
  assert.equal(real.findings.length, 0)
  assert.match(real.note, /no public page/)
})

test('with no model, the search is the ask and each page keeps its result description; with no Hermes, it says why', async () => {
  const { web, calls } = standInWeb()
  const got = await research({ ask: 'Look up the opening hours of Kew Gardens', web, isPublic, limits: { searches: 2 } })
  assert.equal(calls.filter(c => c.search).length, 1, 'one search: the ask itself')
  assert.match(calls[0].search, /opening hours of Kew Gardens/)
  assert.ok(got.findings.length > 0 && got.findings.every(f => /^about /.test(f.took)))
  const none = await research({ ask: 'look up x', web: null })
  assert.deepEqual(none.findings, [])
  assert.match(none.note, /Hermes is not open/)
  const absent = await research({ ask: 'look up x', web: async () => ({ ok: false, absent: true, error: "Hermes isn't connected" }), isPublic })
  assert.match(absent.note, /Hermes isn't connected/)
})

test('a time limit: a slow web stops the step, and the build goes on', async () => {
  const { web } = standInWeb({ slow: 400 })
  const t0 = Date.now()
  const got = await research({ ask: 'look up x', web, isPublic, limits: { ms: 300 } })
  assert.ok(Date.now() - t0 < 2500, `stopped in time (${Date.now() - t0} ms)`)
  assert.deepEqual(got.findings, [])
  assert.match(got.note, /stopped after|nothing/)
})

test('a finding lands in References with its link and what was taken; the person keeps or removes it', () => {
  const projectsDir = mkdtempSync(join(tmpdir(), 'research-'))
  mkdirSync(join(projectsDir, 'p1'))
  const refs = refStore({ projectsDir })
  const r = refs.addFinding('p1', { url: 'https://notion.example/pricing', title: 'Notion pricing', took: 'Four plans side by side; the free one first.', query: 'notion pricing' })
  assert.equal(r.kind, 'link'); assert.equal(r.source, 'research'); assert.equal(r.url, 'https://notion.example/pricing')
  assert.equal(r.found.took, 'Four plans side by side; the free one first.')
  assert.match(refs.brief('p1'), /What the crew looked up on the web before planning[\s\S]*- Notion pricing \(https:\/\/notion\.example\/pricing\): Four plans side by side/)
  assert.doesNotMatch(refs.brief('p1'), /Links the owner gave/, 'a finding is not a link the owner gave')
  assert.deepEqual(refs.used('p1'), [{ id: r.id, name: 'Notion pricing', kind: 'link', what: ['what was looked up'] }])
  // looked up again: the same page is updated, not added twice
  const again = refs.addFinding('p1', { url: 'https://notion.example/pricing', title: 'Notion pricing', took: 'Three plans now.', query: 'notion plans' })
  assert.equal(again.id, r.id)
  assert.equal(refs.list('p1').length, 1)
  assert.match(refs.brief('p1'), /Three plans now/)
  // removed by the person: no longer in the brief or the build's list
  refs.remove('p1', r.id)
  assert.equal(refs.brief('p1'), '')
  assert.deepEqual(refs.used('p1'), [])
})

test('outside a project the findings go in the brief, with the same rule', () => {
  assert.equal(researchBrief([]), '')
  assert.match(researchBrief([{ url: 'https://a.example', title: 'A', took: 'B' }]), /never copy a source's wording[\s\S]*- A \(https:\/\/a\.example\): B/)
})

test('a real Studio: Research on a project with no Hermes says why and keeps nothing', { timeout: 60000 }, async () => {
  const { studio } = await import('../scripts/walkthrough-fixtures.mjs')
  const s = await studio()
  try {
    const made = await s.api('/api/studio', { kind: 'site', idea: 'Cedar Cafe, a small cafe by the river' })
    const pid = made.project.id
    const call = body => fetch(`${s.BASE}/api/projects/${pid}/research`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-swarm-token': 'walkthrough' }, body: JSON.stringify(body) })
    const res = await call({ ask: 'look up cafes by the river in York' })
    assert.equal(res.status, 200)
    const got = await res.json()
    assert.deepEqual(got.findings, [])
    assert.match(got.note, /Hermes/)
    assert.equal(got.refs.filter(r => r.source === 'research').length, 0)
    assert.equal((await fetch(`${s.BASE}/api/projects/nope/research`, { method: 'POST', headers: { 'x-swarm-token': 'walkthrough' }, body: '{}' })).status, 404)
  } finally { s.stop() }
})

test('a real Studio with a stand-in Hermes: a build that asks stops with what it found; the person removes one; the build uses only the rest', { timeout: 90000 }, async () => {
  const { createServer } = await import('node:http')
  const { startStudio } = await import('../scripts/studio-child.mjs')
  const { rmSync, readFileSync, existsSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'research-srv-'))
  const env = { ...process.env, SWARM_TOKEN: 't', SWARM_DATA_DIR: join(dir, 'data'), SWARM_RUNS_DIR: join(dir, 'data', 'runs'), SWARM_OUTPUT_DIR: join(dir, 'out'), HERMES_HOME: join(dir, 'hermes'), SWARM_HERMES_RUNNING: '0' }
  for (const k of Object.keys(env)) if (/_API_KEY$/.test(k) || /^SWARM_(PLANNER|WORKER|REVIEWER)_/.test(k)) delete env[k]
  const { child, base } = await startStudio({ env })
  const call = (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-swarm-token': 't', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  // the stand-in bridge: /web answers as Hermes's web tools do; every model call is held (never answered)
  const web = []
  const bridge = createServer((req, res) => {
    let b = ''
    req.on('data', c => (b += c))
    req.on('end', () => {
      if (req.url.includes('/v1/')) return
      if (req.url === '/web') {
        const body = JSON.parse(b || '{}')
        web.push(body)
        const out = body.search
          ? { ok: true, res: { data: { web: [{ title: 'Notion pricing', url: 'https://example.com/pricing', description: 'Four plans, the free one first.' }, { title: 'Plans compared', url: 'https://example.org/compare', description: 'A table of what each plan has.' }] } } }
          : { ok: true, res: { results: body.urls.map(url => ({ url, title: url, content: `The page ${url}.` })) } }
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out))
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"image":false,"video":false}')
    })
  })
  await new Promise(r => bridge.listen(0, '127.0.0.1', r))
  try {
    await call('/api/hermes/attach', { url: `http://127.0.0.1:${bridge.address().port}`, token: 'bridge-token-0123456789', pid: 4260, code: 1e10 })
    const made = await (await call('/api/studio', { kind: 'site', idea: 'Cedar Cafe, a small cafe by the river' })).json()
    const pid = made.project.id
    // a plain build looks nothing up
    let res = await call('/api/run', { project: pid, brief: 'A site for Cedar Cafe' })
    assert.equal(res.status, 200, 'a Studio project builds')
    assert.equal(web.length, 0, 'no /web call for a brief that does not ask')
    // a brief that asks: the build stops with what was found, kept in References
    res = await call('/api/run', { project: pid, brief: 'A site for Cedar Cafe. Look at how Notion does its pricing page' })
    let j = await res.json()
    assert.equal(res.status, 409)
    assert.equal(j.error, 'research')
    assert.deepEqual(j.findings.map(f => f.url).sort(), ['https://example.com/pricing', 'https://example.org/compare'])
    assert.ok(web.some(c => c.search) && web.some(c => c.urls), 'it searched, then read the pages')
    const found = (await (await call(`/api/projects/${pid}/refs`)).json()).refs.filter(r => r.source === 'research')
    assert.equal(found.length, 2)
    // the person removes one, and sends the build again
    const gone = found.find(r => r.url === 'https://example.org/compare')
    assert.equal((await call(`/api/projects/${pid}/refs/${gone.id}/remove`, {})).status, 200)
    const calls = web.length
    res = await call('/api/run', { project: pid, brief: 'A site for Cedar Cafe. Look at how Notion does its pricing page', researched: true })
    j = await res.json()
    assert.equal(res.status, 200, JSON.stringify(j))
    assert.equal(web.length, calls, 'nothing is looked up again')
    const used = JSON.parse(readFileSync(join(dir, 'data', 'runs', j.run, 'refs-used.json'), 'utf8'))
    assert.deepEqual(used.filter(r => r.what.includes('what was looked up')).map(r => r.name), ['Notion pricing'], 'the build was given only the one kept')
    assert.ok(existsSync(join(dir, 'data', 'runs', j.run)))
  } finally { bridge.close(); child.kill(); try { rmSync(dir, { recursive: true, force: true }) } catch {} }
})
