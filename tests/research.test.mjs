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
