// A research step before the planner plans (any kind: a website, app, game, film, deck or brand). It never runs on
// every build: only when the person's own words name something to look up ("look up…", "look at how X does it",
// "research…"), or when they press Research.
//
//   wantsResearch(typed)            -> the asking line, or ''        (pure: no network)
//   research({ ask, kind, web, … }) -> { findings: [{ url, title, took, query }], searched, read, note }
//
// It searches the web through Hermes (bridge.py POST /web: Hermes's own web_search / web_extract, its backend, its
// keys and its refusal of private addresses), reads the few pages that matter, and keeps from each one what the
// crew can use. Each finding lands in the project's References (engine/refs.mjs, source `research`) with its link
// and what was taken, where the person keeps or removes it.
//
// Limits, per build: RESEARCH.searches searches, RESEARCH.pages pages read, RESEARCH.ms for the whole step; every
// address is checked public here too (engine/chatmedia.mjs publicUrl) before it is passed on.

import { publicUrl } from './chatmedia.mjs'

export const RESEARCH = { searches: 3, pages: 4, results: 6, ms: 60000, findings: 6 }

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

// the person asks for it in their own words: the line that asks, else ''
const ASKS = /\b(?:look(?:ing)?\s+(?:up|into|around)|look\s+at\s+(?:how|what|the\s+way)|research(?:ing)?|find\s+out|search\s+(?:for|the\s+web|online)|see\s+how\s+\S+(?:\s+\S+)?\s+(?:does|do|did|handles?|shows?)|check\s+(?:how|what)\s+\S+(?:\s+\S+)?\s+(?:does|do|did|has|have|shows?|charges?))\b/i
export function wantsResearch(typed = '') {
  const text = String(typed || '')
  const m = ASKS.exec(text)
  if (!m) return ''
  // the sentence that asks, so the queries are about what was asked and not the whole brief
  const start = Math.max(text.lastIndexOf('.', m.index) + 1, text.lastIndexOf('\n', m.index) + 1, 0)
  const end = text.slice(m.index).search(/[.!?\n]/)
  return clip(text.slice(start, end < 0 ? undefined : m.index + end), 300)
}

// The model's answer: the JSON in it, or null
function jsonIn(text) {
  const s = String(text ?? '')
  for (const re of [/\{[\s\S]*\}/, /\[[\s\S]*\]/]) { const m = re.exec(s); if (m) try { return JSON.parse(m[0]) } catch {} }
  return null
}

export const QUERY_SYSTEM = 'You plan a short web search for a design studio crew about to plan a project. Return JSON only: {"queries":["<a web search, under 12 words>"]}, at most 3, each a different angle on what the person asked to look up. Search for facts the crew can use (what a named product or place offers, how a named site or app does something, prices, opening hours, features); never search for the person or their own business.'
export const NOTES_SYSTEM = 'You read web pages for a design studio crew about to plan a project, and keep only what helps with what the person asked. Return JSON only: {"findings":[{"url":"<the page address, as given>","took":"<what to take from this page, in your own words, under 60 words: facts, names of features, how it is laid out or how it works; never copied sentences>"}]}. Leave out a page that does not help.'

// The research step. ask: what the person asked to look up (wantsResearch, or the brief when they pressed
// Research); web(body): bridge.py /web; chat(messages): the planner's model, or null (then the ask is searched as it
// is and each page's opening is kept). Never throws: a step that could not run says why in `note`.
export async function research({ ask, kind = 'site', web, chat = null, limits = {}, signal = null, isPublic = u => publicUrl(u), log = () => {} } = {}) {
  const L = { ...RESEARCH, ...limits }
  const out = { findings: [], searched: [], read: [], note: '' }
  ask = clip(ask, 500)
  if (!ask) return { ...out, note: 'nothing to look up' }
  if (!web) return { ...out, note: 'Hermes is not open, so nothing was looked up' }
  const stop = AbortSignal.any([AbortSignal.timeout(L.ms), ...(signal ? [signal] : [])])
  const live = () => !stop.aborted
  try {
    // 1. what to search for
    let queries = []
    if (chat) try {
      const got = jsonIn(await chat([{ role: 'system', content: QUERY_SYSTEM }, { role: 'user', content: `Making: a ${kind}.\nThe person asked: ${ask}` }], { signal: stop }))
      queries = (Array.isArray(got?.queries) ? got.queries : []).map(q => clip(q, 120)).filter(Boolean)
    } catch {}
    if (!queries.length) queries = [clip(ask.replace(ASKS, ' '), 120) || ask.slice(0, 120)]
    // 2. the searches, at most L.searches
    const hits = []
    for (const q of queries.slice(0, L.searches)) {
      if (!live()) break
      const r = await web({ search: q, limit: L.results }, stop).catch(err => ({ ok: false, error: String(err?.message || err) }))
      out.searched.push(q)
      if (!r?.ok) { out.note = clip(r?.error || 'the search failed', 200); continue }
      for (const h of r.res?.data?.web || []) if (h?.url && !hits.some(x => x.url === h.url)) hits.push({ url: String(h.url), title: clip(h.title, 120), description: clip(h.description, 300), query: q })
    }
    // 3. the pages that matter: the top hits across the searches, public addresses only, at most L.pages
    const pick = []
    for (const h of interleave(hits)) {
      if (pick.length >= L.pages || !live()) break
      try { await isPublic(h.url); pick.push(h) } catch {}
    }
    if (!pick.length) return { ...out, note: out.note || (hits.length ? 'no public page among the results' : 'the search found nothing') }
    const r = live() ? await web({ urls: pick.map(h => h.url) }, stop).catch(err => ({ ok: false, error: String(err?.message || err) })) : null
    const pages = (r?.ok ? r.res?.results || [] : []).filter(p => p?.url && p.content && !p.error)
    out.read = pages.map(p => String(p.url))
    if (!r?.ok && r) out.note = clip(r.error || 'the pages could not be read', 200)
    // 4. what to take from each page (the model's notes; with none, the search result's own description)
    const byUrl = new Map(pick.map(h => [h.url, h]))
    let notes = null
    if (chat && pages.length && live()) try {
      const text = pages.map(p => `PAGE ${p.url}\nTitle: ${clip(p.title || byUrl.get(p.url)?.title, 120)}\n${clip(p.content, 4000)}`).join('\n\n')
      const got = jsonIn(await chat([{ role: 'system', content: NOTES_SYSTEM }, { role: 'user', content: `Making: a ${kind}.\nThe person asked: ${ask}\n\n${text}` }], { signal: stop }))
      notes = Array.isArray(got?.findings) ? got.findings : null
    } catch {}
    const made = notes
      ? notes.map(n => ({ url: String(n?.url || ''), took: clip(n?.took, 400) })).filter(n => n.took && byUrl.has(n.url))
      : pick.filter(h => !pages.length || out.read.includes(h.url)).map(h => ({ url: h.url, took: h.description || clip(pages.find(p => p.url === h.url)?.content, 300) })).filter(n => n.took)
    out.findings = made.slice(0, L.findings).map(n => ({ url: n.url, title: byUrl.get(n.url)?.title || hostOf(n.url), took: n.took, query: byUrl.get(n.url)?.query || '' }))
    if (!out.findings.length && !out.note) out.note = 'nothing in the pages helped'
  } catch (err) {
    out.note = clip(err?.message || err, 200)
  }
  if (stop.aborted && !signal?.aborted && !out.findings.length) out.note = `stopped after ${Math.round(L.ms / 1000)} s`
  log(out)
  return out
}

// the first hit of each search, then the second of each, …: one search's results never crowd out another's
function interleave(hits) {
  const by = new Map()
  for (const h of hits) by.set(h.query, [...(by.get(h.query) || []), h])
  const lists = [...by.values()], out = []
  for (let i = 0; lists.some(l => l[i]); i++) for (const l of lists) if (l[i]) out.push(l[i])
  return out
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return clip(u, 80) } }

// The findings as the crew's brief reads them, when there is no project to keep them in (a build outside one)
export function researchBrief(findings = []) {
  if (!findings.length) return ''
  return `What the crew looked up on the web before planning. Use these facts where they fit; never copy a source's wording, layout, logo or pictures, and never present a fact as the owner's unless the brief says so:\n${findings.map(f => `- ${f.title} (${f.url}): ${f.took}`).join('\n')}`
}
