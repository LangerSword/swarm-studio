// Reachability over the navigation state charts: the live one (web/nav.js) and the design of every screen
// (docs/ux/statechart/studio.machine.js). No browser: xstate/graph walks every state the charts can be in and
// this lists what a walk cannot see by pressing things:
//
//   no way in     a state no sequence of events reaches
//   dead ends     a state no event leaves; and the states only the chart's top-level moves leave (the logo, a new
//                 project opening), which have no move of their own
//   unhandled     an event the chart declares that no reachable state takes, and an event the Studio's code
//                 sends (nav.go({ type })) that the chart does not declare
//
//   node scripts/nav-reach.mjs            prints the report; exits 1 when it differs from the accepted findings
//   node scripts/nav-reach.mjs --update   accepts what it finds (docs/ux/statechart/reach-baseline.json)
//
// It needs xstate's graph tools (xstate/graph), which the vendored web copy leaves out: `npm ci --prefix tools/dev`.
// tests/property/nav-reach.property.mjs runs it in CI (the `property` job). A walker only follows what a chart
// declares: a screen the chart is missing is found by docs/ux/states/, not here.
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createActor } from '../web/vendor/xstate/xstate.mjs'
import { navMachine, ROOMS, STEPS } from '../web/nav.js'
import { studioMachine } from '../docs/ux/statechart/studio.machine.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const BASELINE = fileURLToPath(new URL('../docs/ux/statechart/reach-baseline.json', import.meta.url))

function graph() {
  try { return createRequire(new URL('../tools/dev/package.json', import.meta.url))('xstate/graph') } catch { return null }
}

// every state node of a chart (history nodes are a way back, not a place)
function nodesOf(machine) {
  const out = []
  const walk = n => { if (n.type !== 'history') out.push(n); for (const c of Object.values(n.states)) walk(c) }
  walk(machine.root)
  return out
}
const nameOf = n => n.path.join('.') || '(root)'
// the events a node handles itself, by name
const ownEvents = n => [...new Set(Object.keys(n.config.on || {}))]

/**
 * One chart's findings. `events` are the events to try, with what they carry (a guard reads it); `key` is what
 * tells two states apart: the state value and only the context a guard reads, so the walk ends.
 * @param {any} machine  @param {{ events: any[], key: (snap: any) => unknown, sent?: string[] }} o
 */
export function reach(machine, { events, key, sent = [] }) {
  const g = graph()
  if (!g) throw new Error('xstate/graph not found: npm ci --prefix tools/dev')
  // the chart's own rules decide each move (a real actor, so an action that reads `self` works); xstate/graph walks
  const logic = {
    getInitialSnapshot: () => createActor(machine).start().getSnapshot(),
    transition: (snapshot, event) => { const a = createActor(machine, { snapshot }).start(); a.send(event); return a.getSnapshot() }
  }
  const serializeState = snap => JSON.stringify([snap.value, key(snap)])
  const serializeEvent = e => JSON.stringify(e)
  const paths = g.getShortestPaths(logic, { events, serializeState, serializeEvent })
  const adj = g.getAdjacencyMap(logic, { events, serializeState, serializeEvent })

  const nodes = nodesOf(machine), leaves = nodes.filter(n => !Object.keys(n.states).length)
  const reached = new Set(), shortest = new Map()
  for (const p of paths) for (const n of p.state._nodes) { reached.add(n.id); const len = p.steps.length; if (!shortest.has(n.id) || len < shortest.get(n.id)) shortest.set(n.id, len) }
  const noWayIn = nodes.filter(n => !reached.has(n.id)).map(nameOf)

  // per leaf: can any event move the chart off it; does it (or a parent below the root) have a move of its own
  const leaves_ = new Map(leaves.map(n => [n.id, { out: false, own: false }]))
  const taken = new Set()
  for (const { state, transitions } of Object.values(adj)) {
    const here = serializeState(state)
    for (const { event, state: next } of Object.values(transitions)) {
      // taken: a transition answers it here, even one that re-enters the same state (the Feed's swipe)
      if (state.can(event)) taken.add(event.type)
      if (serializeState(next) === here) continue
      for (const n of state._nodes) {
        const l = leaves_.get(n.id)
        if (!l) continue
        if (!next._nodes.some(x => x.id === n.id)) l.out = true
        // a move declared on this leaf or on a parent that is not the root
        for (let p = n; p && p !== machine.root; p = p.parent) if (ownEvents(p).includes(event.type)) l.own = true
      }
    }
  }
  const live = leaves.filter(n => reached.has(n.id))
  const deadEnds = live.filter(n => !leaves_.get(n.id).out).map(nameOf)
  const onlyTopLevel = live.filter(n => leaves_.get(n.id).out && !leaves_.get(n.id).own).map(nameOf)

  const declared = new Set(nodes.flatMap(ownEvents))
  const tried = new Set(events.map(e => e.type))
  return {
    states: nodes.length - 1,
    reachable: nodes.filter(n => reached.has(n.id)).length - 1,
    configurations: Object.keys(adj).length,
    longestShortestPath: Math.max(0, ...shortest.values()),
    noWayIn: noWayIn.sort(),
    deadEnds: deadEnds.sort(),
    onlyTopLevelMovesLeave: onlyTopLevel.sort(),
    // declared and never taken from any reachable state with what the events here carry
    eventsNeverTaken: [...declared].filter(e => !taken.has(e)).sort(),
    // declared, and this script has no event for it: add one to the list above
    eventsNotTried: [...declared].filter(e => !tried.has(e)).sort(),
    // sent by the Studio's code, and the chart has no such event: the move is dropped (nav.go logs it)
    eventsSentNotDeclared: sent.filter(e => !declared.has(e)).sort()
  }
}

// ---------- the live chart (web/nav.js): the events and what they carry
const NAV_EVENTS = [
  { type: 'home' }, { type: 'draft' }, { type: 'brand' }, { type: 'back' }, { type: 'close' }, { type: 'stop' },
  { type: 'plan' }, { type: 'plan', plan: 'plan-1' },
  { type: 'open.project', project: 'p1', version: 'v1' }, { type: 'open.project', version: 'v1' }, { type: 'open.project', project: 'p1' }, { type: 'open.project' },
  { type: 'open.version', version: 'v2' }, { type: 'open.version' },
  { type: 'studio', project: 'p1' }, ...STEPS.map(step => ({ type: 'studio', project: 'p1', step })), { type: 'studio' },
  ...STEPS.map(step => ({ type: 'studio.step', step })), { type: 'studio.step', step: 'nowhere' },
  ...['overview', 'deck', 'app', 'video', undefined].flatMap(room => [{ type: 'started', run: 'r1', room }, { type: 'studio.built', run: 'r1', room }]), { type: 'started' },
  ...ROOMS.map(room => ({ type: 'room', room })), { type: 'room', room: 'game', run: 'g1' },
  { type: 'streamed', run: 'r1' }, { type: 'streamed', run: 'other' },
  { type: 'replay', on: true }, { type: 'replay', on: false },
  { type: 'play' }, { type: 'play', page: 'pg1' }, { type: 'play', pages: 0 }, { type: 'watch' }, { type: 'watch', page: 'pg1' }, { type: 'watch', pages: 0 }, { type: 'page', page: 'pg2' }
]
// the guards read: which step, where the brand sheet was opened from, and whether a project, a version, a game
// run and a wait are there (never which)
const navKey = s => [s.context.step, s.context.from, !!s.context.project, !!s.context.version, !!s.context.run, !!s.context.pending]

// the events the Studio's code sends the live chart: nav.go({ type: '…' }) anywhere in web/, and every event
// web/nav.js and web/route.js build from an address
function sentToNav() {
  const out = new Set()
  const files = [...readdirSync(`${ROOT}web`).filter(f => f.endsWith('.js')).map(f => `web/${f}`), ...readdirSync(`${ROOT}web/canvas`).filter(f => f.endsWith('.js')).map(f => `web/canvas/${f}`)]
  for (const f of files) {
    const src = readFileSync(ROOT + f, 'utf8')
    for (const m of src.matchAll(/\bgo\(\{ type: '([\w.]+)'/g)) out.add(m[1])
    if (f === 'web/route.js' || f === 'web/nav.js') for (const m of src.matchAll(/\{ type: '([\w.]+)'/g)) out.add(m[1])
  }
  return [...out].sort()
}

// ---------- the design chart (docs/ux/statechart): every event it declares, bare and with what a guard may read
function studioEvents() {
  const types = [...new Set(nodesOf(studioMachine).flatMap(ownEvents))]
  const carry = [{}, { project: 'p1', version: 'v1', run: 'r1', page: 'pg1' }, ...['just', 'design', 'develop', 'game', 'launch', 'mix'].map(lens => ({ lens })), ...['scaffold', 'plan', 'draft', 'build'].map(from => ({ from }))]
  return types.flatMap(type => carry.map(c => ({ type, ...c })))
}
const studioKey = s => [s.context.from, !!s.context.version, !!s.context.playing, !!s.context.pending]

export function findings() {
  return {
    nav: reach(navMachine, { events: NAV_EVENTS, key: navKey, sent: sentToNav() }),
    studio: reach(studioMachine, { events: studioEvents(), key: studioKey })
  }
}
export const hasGraph = () => !!graph()

const list = (title, a) => `  ${title}: ${a.length ? a.length : 'none'}${a.length ? `\n${a.map(x => `    ${x}`).join('\n')}` : ''}`
export function words(all) {
  return Object.entries(all).map(([name, r]) => [
    `${name === 'nav' ? 'web/nav.js (the live navigation)' : 'docs/ux/statechart/studio.machine.js (every screen, the design)'}`,
    `  ${r.reachable} of ${r.states} states reached, in ${r.configurations} configurations; the farthest is ${r.longestShortestPath} moves from the start`,
    list('no way in', r.noWayIn),
    list('dead ends (no event leaves)', r.deadEnds),
    list('left only by the chart’s top-level moves (no move of their own)', r.onlyTopLevelMovesLeave),
    list('events declared and never taken', r.eventsNeverTaken),
    list('events declared and not tried here', r.eventsNotTried),
    list('events the code sends and the chart does not declare', r.eventsSentNotDeclared)
  ].join('\n')).join('\n\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = findings()
  console.log(words(all))
  if (process.argv.includes('--update')) { writeFileSync(BASELINE, JSON.stringify(all, null, 1) + '\n'); console.log(`\naccepted → ${BASELINE}`) }
  else {
    let base = null
    try { base = JSON.parse(readFileSync(BASELINE, 'utf8')) } catch {}
    if (JSON.stringify(base) !== JSON.stringify(all)) { console.log('\nthe findings differ from the accepted ones (docs/ux/statechart/reach-baseline.json): fix the chart, or accept with --update'); process.exitCode = 1 }
  }
}
