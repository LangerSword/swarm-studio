// @ts-check
// A build that looked something up stops with what it found (decision 0025: anything fetched is shown, with its
// source, before it is used; server/server.mjs /api/run answers 409 { error: 'research', … }). Both Studios show it
// the same way, from here (the next UI imports this file as @studio/researchstop): Hermia's line, each finding with
// its link and what was taken, a way to take one out, and Build. In a project the findings are already in its
// References, so taking one out removes it there; outside one, the build is sent again with the ones kept.

/** @typedef {{ url: string, title: string, took: string, query?: string }} Finding */
/** @typedef {{ error: 'research', ask: string, project?: string | null, findings: Finding[], note?: string, refs?: { id: string, url: string }[] }} Stop */
/** @typedef {{ key: string, url: string, title: string, took: string, host: string, ref: string | null }} Item */

/** @param {unknown} j @returns {j is Stop} */
export const isResearchStop = j => !!j && typeof j === 'object' && /** @type {any} */ (j).error === 'research' && Array.isArray(/** @type {any} */ (j).findings)

const hostOf = (/** @type {string} */ u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }

/** Hermia's line over the list. @param {Stop} j */
export function stopText(j) {
  const n = j.findings.length
  return `I looked up "${j.ask}" first and kept ${n === 1 ? 'one page' : `${n} pages`}. Take out any you don't want the crew to use, then build.`
}

/** The findings as the list shows them, each with its reference in the project (when there is one). @param {Stop} j @returns {Item[]} */
export function stopItems(j) {
  const refOf = new Map((j.refs || []).map(r => [r.url, r.id]))
  return j.findings.map((f, i) => ({ key: `${i}:${f.url}`, url: f.url, title: f.title || hostOf(f.url), took: f.took, host: hostOf(f.url), ref: refOf.get(f.url) || null }))
}

/**
 * What the build is sent again with, once the person has seen the findings: researched, and outside a project the
 * ones they kept (in a project, References already holds what is kept).
 * @param {Stop} j @param {Item[]} kept
 */
export function againBody(j, kept) {
  if (j.project) return { researched: true }
  const urls = new Set(kept.map(k => k.url))
  return { researched: true, found: j.findings.filter(f => urls.has(f.url)) }
}

/**
 * Take one out: in a project it is removed from References (undo is References' own); outside one it is only left out.
 * @param {Stop} j @param {Item} item @param {(path: string, body: object) => Promise<unknown>} post
 */
export async function takeOut(j, item, post) {
  if (j.project && item.ref) await post(`/api/projects/${encodeURIComponent(j.project)}/refs/${encodeURIComponent(item.ref)}/remove`, {})
}
