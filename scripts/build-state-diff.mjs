// The Projects card's words before and after the one state of an app, a game and a film (engine/kindstate.mjs),
// over every build in a runs folder: `kindDifferences`, what running this prints. Before is the card as it read
// once a website had its one build state (engine/buildstate.mjs, `siteStateOf` below). It prints only the cards
// and versions whose words change, and exits 1 when a change is not one of the truthful ones: an app that is
// designed and not built (it read Website), an app or game build that stopped or waits for its person, a film
// run that failed. A card that read Live, or an app or game that read built, and changes is a regression.
//
// `differences` is the step before, kept with its test: the words before and after the website's build state
// (only a website that failed, stopped or was left unfinished may change).
//
//   SWARM_RUNS_DIR=~/.hermes/swarm-studio/runs node scripts/build-state-diff.mjs
//   node scripts/build-state-diff.mjs <runs folder>
//
// It only reads: each build's events.jsonl, and folders.json for which builds make a project. It writes nothing
// (so it does not go through server/projects.mjs makeProjects, which keeps folders.json up to date).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildState } from '../engine/buildstate.mjs'
import { kindState } from '../engine/kindstate.mjs'
import { pieceKind } from '../engine/naming.mjs'
import { gameProgress, stateOf } from '../server/projects.mjs'

const RUN_ID = /^[\w-]{1,64}$/
const hostOf = url => { try { return new URL(url).host } catch { return null } }

// stateOf as it was before the build state (server/projects.mjs at a317bd0), word for word
export function oldStateOf(card, cards = [card]) {
  const game = card.kind === 'game' || card.game
  const kind = game ? 'Game' : card.build || card.app ? 'App' : card.pages > 0 || card.planned > 0 ? 'Website' : card.video ? 'Video' : 'Website'
  const made = game ? 'Game' : 'App'
  const out = [...cards].reverse().map(c => c.deployed || Object.values(c.sites || {})[0]).find(Boolean)
  const busy = game && card.build === 'working' && Date.now() - (card.updated || 0) < 600000
  const g = game ? card.work?.progress || (busy ? card.gameAt : null) : null
  const status = out ? 'Live'
    : g?.art ? `Painting art · ${g.art[0]} of ${g.art[1]}`
    : g?.stage ? `Building · stage ${g.stage[0]} of ${g.stage[1]}`
    : card.intake === 'coming' ? (card.work || busy || card.build === 'working' ? 'Coming in' : 'Did not come in')
    : card.intake === 'in' && card.build === 'built' ? 'Brought in'
    : card.live || card.work ? 'Building'
    : busy ? 'Building'
    : game && (card.build === 'working' || card.build === 'stopped') ? 'Stopped'
    : card.build === 'failed' ? `${made} failed`
    : card.build === 'built' || (card.app && !card.build) ? `${made} built`
    : card.layers > 0 || card.video ? 'Designed'
    : 'Draft'
  return { kind, status, host: out ? hostOf(out) : null }
}
// the two clients' rule, before: a dead newest version takes an older working version's words
const oldDead = v => /failed|^Draft$/i.test(String(v?.state?.status || ''))
const oldCard = (state, versions) => (oldDead({ state }) && versions.find(v => !oldDead(v))?.state) || state
// and now (web/home.js, ui/src/screens/projects/model.ts): a website's card never borrows
const newDead = v => v?.state?.site ? !!v.state.empty : oldDead(v)
const newCard = (state, versions) => (newDead({ state }) && !state?.site && versions.find(v => !newDead(v))?.state) || state

// stateOf as it was with the website's build state and before the kinds' states (server/projects.mjs at 48037dd),
// word for word
const SITE_WORD = { done: 'Designed', unchanged: 'Designed', partly: 'Partly built', failed: 'Failed', stopped: 'Stopped', halted: 'Stopped', replaced: 'Stopped', unsure: 'Stopped' }
export function siteStateOf(card, cards = [card]) {
  const game = card.kind === 'game' || card.game
  const kind = game ? 'Game' : card.build || card.app ? 'App' : card.pages > 0 || card.planned > 0 ? 'Website' : card.video ? 'Video' : 'Website'
  const made = game ? 'Game' : 'App'
  // (then a run whose start said it was an app had no website state)
  const site = kind === 'Website' && !card.intake && card.kind !== 'app' ? card.buildState || null : null
  const word = site ? SITE_WORD[site.state] || null : null
  const out = [...cards].reverse().map(c => c.deployed || Object.values(c.sites || {})[0]).find(Boolean)
  const busy = game && card.build === 'working' && Date.now() - (card.updated || 0) < 600000
  const g = game ? card.work?.progress || (busy ? card.gameAt : null) : null
  const status = out ? 'Live'
    : g?.art ? `Painting art · ${g.art[0]} of ${g.art[1]}`
    : g?.stage ? `Building · stage ${g.stage[0]} of ${g.stage[1]}`
    : card.intake === 'coming' ? (card.work || busy || card.build === 'working' ? 'Coming in' : 'Did not come in')
    : card.intake === 'in' && card.build === 'built' ? 'Brought in'
    : card.live || card.work ? 'Building'
    : busy ? 'Building'
    : game && (card.build === 'working' || card.build === 'stopped') ? 'Stopped'
    : card.build === 'failed' ? `${made} failed`
    : card.build === 'built' || (card.app && !card.build) ? `${made} built`
    : word ? word
    : card.layers > 0 || card.video ? 'Designed'
    : 'Draft'
  return { kind, status, host: out ? hostOf(out) : null, ...(site ? { site: site.state, ...(status === word && site.done + site.kept === 0 ? { empty: true } : {}) } : {}) }
}

/**
 * A build's card from its events, at rest: the fields stateOf reads (server/server.mjs runCard, cut down).
 * piece: what the run's meta.json says it is, when it says.
 */
export function cardOf(id, events, { video = false, piece = null } = {}) {
  const start = events.find(e => e.type === 'run:start')
  if (!start) return null
  const pages = events.filter(e => e.type === 'page')
  const done = events.find(e => e.type === 'run:done')
  const isApp = events.some(e => typeof e.type === 'string' && e.type.startsWith('app:'))
  const sites = {}
  for (const e of events) if (e.type === 'publish:done' && e.url) sites[e.target] = e.url
  const deployed = events.findLast(e => e.type === 'app:deployed' && e.url && !e.pending)
  if (deployed && !sites.vercel) sites.vercel = deployed.url
  const b = events.findLast(e => ['app:start', 'app:done', 'app:failed'].includes(e.type))
  return {
    id, brief: String(start.brief || ''), kind: start.kind || (isApp ? 'app' : 'site'), from: start.from || null,
    intake: start.intake ? (events.some(e => e.type === 'intake') ? 'in' : 'coming') : null,
    t: start.t, updated: events.at(-1)?.t || start.t, pages: pages.length,
    layers: done?.done ?? events.filter(e => e.type === 'layer:done').length,
    sites, video,
    game: events.some(e => e.type === 'game:spec') || pages.some(p => /\b(play|game|arcade|trial)\b/i.test(`${p.id} ${p.title}`)),
    app: events.some(e => e.type === 'app:ready' || e.type === 'app:done'),
    planned: events.filter(e => e.type === 'layer:plan').length,
    // a build left at app:start is read as stopped here: this reads files, it asks no process
    build: (b?.type === 'app:failed' && b.message === 'stopped') || b?.type === 'app:start' ? 'stopped' : ({ 'app:done': 'built', 'app:failed': 'failed' })[b?.type] || null,
    gameAt: events.some(e => e.type === 'game:spec') ? gameProgress(events.filter(e => e.type === 'app:step').map(e => e.step)) : null,
    deployed: events.findLast(e => e.type === 'app:deployed' && e.url)?.url || null,
    live: false, work: null,
    buildState: buildState(events, { live: false }),
    // what it is and its app's, game's and film's state, as the server reads them at rest: this asks no process,
    // so a build left at its start is read as stopped (as `build` above)
    parts: kindState(events, { piece: pieceKind({ piece, kind: start.kind, brief: start.brief, pages: pages.length, video }), alive: () => false, self: -1, now: Infinity })
  }
}

const words = s => (s ? `${s.kind} · ${s.status}` : '(no card)')
// A change is allowed when the card is a website's whose build is not whole: failed, stopped, partly built, or
// with no end. `unchanged` is a next version that added nothing: it read Draft, and its sections are all there.
const ALLOWED = new Set(['partly', 'failed', 'stopped', 'halted', 'replaced', 'unsure', 'unchanged'])
const allowed = (was, now) => was.kind === 'Website' && now.kind === 'Website' && ALLOWED.has(now.site)

/**
 * Every card and version whose words change, old against new.
 * @param {{ id: string, events: object[], video?: boolean }[]} runs
 * @param {Record<string, { runs: string[], name?: string, title?: string }>} [projects] folders.json's projects
 */
export function differences(runs, projects = {}) {
  const cards = new Map(runs.map(r => [r.id, cardOf(r.id, r.events, r)]).filter(([, c]) => c))
  const out = []
  const homes = new Map()
  for (const [pid, p] of Object.entries(projects)) for (const id of p.runs || []) homes.set(id, pid)
  const nameOf = (pid, c) => String(projects[pid]?.name || projects[pid]?.title || c.brief.split(/[,.:—–-]/)[0]).trim().slice(0, 48)
  for (const [id, c] of cards) {
    const was = oldStateOf(c), now = siteStateOf(c)
    if (words(was) !== words(now)) out.push({ what: 'version', project: nameOf(homes.get(id), c), run: id, was: words(was), now: words(now), state: now.site || null, ok: allowed(was, now) })
  }
  // the project's card: its newest build's words, over all its builds (a game made from a site is a part of it)
  const groups = new Map(Object.entries(projects).map(([pid, p]) => [pid, (p.runs || []).filter(id => cards.has(id))]))
  for (const id of cards.keys()) if (!homes.has(id)) groups.set(id, [id])
  for (const [pid, ids] of groups) {
    const all = ids.map(id => cards.get(id))
    const own = all.filter(c => !(c.from && c.from !== c.id && ids.includes(c.from)))
    if (!own.length) continue
    const newest = own.at(-1)
    const versions = f => [...own].reverse().map(c => ({ state: f(c) }))
    const was = oldCard(oldStateOf(newest, own), versions(oldStateOf)), now = newCard(siteStateOf(newest, own), versions(siteStateOf))
    if (words(was) !== words(now)) out.push({ what: 'card', project: nameOf(pid, newest), run: newest.id, was: words(was), now: words(now), state: now.site || null, ok: allowed(was, now) })
  }
  return out
}

// A change the kinds' states may make: never to the word Live or its host, or to an app or a game that read
// built; and only into what the state says: an app from its start (designed, or its design's own word), a build that
// stopped or waits, a film run that failed or stopped.
const partOf = c => c.parts?.game || c.parts?.app || null
function kindAllowed(was, now, c) {
  // a website's or an app's own film failed: the card keeps its own word and adds the film's failure beside it
  // (#647: a card said nothing about its failed film). Only that suffix may be added, to the word it already had.
  if (c.parts?.film?.state === 'failed' && now.kind !== 'Video' && String(now.status).endsWith(' · Film failed') && String(now.status).slice(0, -' · Film failed'.length) === String(was.status)) return true
  // Live stays Live, on the same host: of a Live card only what it is may change (a designed app that was published)
  if ((was.status === 'Live') !== (now.status === 'Live') || was.host !== now.host || / built$/.test(was.status)) return false
  const part = partOf(c)?.state, film = c.parts?.film?.state
  if (was.kind === 'Website' && now.kind === 'App') return part === 'designed'
  if (was.status === 'Live') return false
  if (was.kind === now.kind && part === 'stopped') return now.status === 'Stopped'
  if (was.kind === now.kind && part === 'waiting') return now.status === 'Your turn'
  if (now.kind === 'Video') return c.parts?.kind === 'film' && ['Failed', 'Stopped', 'Designed', 'Draft', 'Building'].includes(now.status) && (was.kind !== 'Video' || film === 'failed' || film === 'stopped')
  return false
}
/**
 * Every card and version whose words change with the kinds' states: the website-state card against today's.
 * @param {{ id: string, events: object[], video?: boolean, piece?: string | null }[]} runs
 * @param {Record<string, { runs: string[], name?: string, title?: string }>} [projects] folders.json's projects
 */
export function kindDifferences(runs, projects = {}) {
  const cards = new Map(runs.map(r => [r.id, cardOf(r.id, r.events, r)]).filter(([, c]) => c))
  const out = []
  const homes = new Map()
  for (const [pid, p] of Object.entries(projects)) for (const id of p.runs || []) homes.set(id, pid)
  const nameOf = (pid, c) => String(projects[pid]?.name || projects[pid]?.title || c.brief.split(/[,.:—–-]/)[0]).trim().slice(0, 48)
  const said = (c, now) => partOf(c)?.state || (now.kind === 'Video' ? c.parts?.film?.state : null) || now.site || null
  for (const [id, c] of cards) {
    const was = siteStateOf(c), now = stateOf(c)
    if (words(was) !== words(now)) out.push({ what: 'version', project: nameOf(homes.get(id), c), run: id, was: words(was), now: words(now), state: said(c, now), ok: kindAllowed(was, now, c) })
  }
  const groups = new Map(Object.entries(projects).map(([pid, p]) => [pid, (p.runs || []).filter(id => cards.has(id))]))
  for (const id of cards.keys()) if (!homes.has(id)) groups.set(id, [id])
  for (const [pid, ids] of groups) {
    const all = ids.map(id => cards.get(id))
    const own = all.filter(c => !(c.from && c.from !== c.id && ids.includes(c.from)))
    if (!own.length) continue
    const newest = own.at(-1)
    const versions = f => [...own].reverse().map(c => ({ state: f(c), c }))
    const pick = (state, vs) => (newDead({ state }) && !state?.site && vs.find(v => !newDead(v))) || { state, c: newest }
    const was = pick(siteStateOf(newest, own), versions(siteStateOf)), now = pick(stateOf(newest, own), versions(stateOf))
    if (words(was.state) !== words(now.state)) out.push({ what: 'card', project: nameOf(pid, newest), run: now.c.id, was: words(was.state), now: words(now.state), state: said(now.c, now.state), ok: kindAllowed(was.state, now.state, now.c) })
  }
  return out
}

/** Read a runs folder, and nothing else: events.jsonl per build, folders.json, and whether a film file is there. */
export function readRuns(dir) {
  const runs = readdirSync(dir).filter(id => RUN_ID.test(id) && existsSync(join(dir, id, 'events.jsonl'))).sort().map(id => ({
    id,
    events: readFileSync(join(dir, id, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } }),
    video: existsSync(join(dir, id, 'video', 'promo.mp4')),
    piece: (() => { try { return JSON.parse(readFileSync(join(dir, id, 'meta.json'), 'utf8')).piece || null } catch { return null } })()
  }))
  let projects = {}
  try { projects = JSON.parse(readFileSync(join(dir, 'folders.json'), 'utf8')).projects || {} } catch {}
  return { runs, projects }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = (process.argv[2] || process.env.SWARM_RUNS_DIR || '').replace(/^~(?=\/)/, process.env.HOME || '~')
  if (!dir || !existsSync(dir)) { console.error('name a runs folder: node scripts/build-state-diff.mjs <runs folder>'); process.exit(2) }
  const { runs, projects } = readRuns(dir)
  const diffs = kindDifferences(runs, projects)
  for (const d of diffs) console.log(`${d.ok ? '  ' : '! '}${d.what.padEnd(7)} ${d.project.padEnd(28)} ${d.run}  ${d.was}  ->  ${d.now}${d.state ? `  (${d.state})` : ''}`)
  const bad = diffs.filter(d => !d.ok)
  console.log(`${runs.length} builds, ${diffs.length} changed, ${bad.length} not allowed`)
  process.exit(bad.length ? 1 : 0)
}
