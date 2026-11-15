// The walkthrough's checks as plain rules (no browser): what the words on a screen may say for each state of a
// website build, which findings of a captured step count as defects, and the ratchet that compares them with the
// accepted baseline (docs/ux/walkthrough/defects-baseline.json). scripts/walkthrough.mjs measures, this file
// judges, scripts/walkthrough-board.mjs shows; tests/walkthrough-checks.test.mjs holds the rules.
import { buildStrip } from '../web/replaytalk.js'

// ---------- one build state, one set of words. The words are web/replaytalk.js's (the strip, through buildStrip)
// and server/projects.mjs's SITE_WORD (the Projects card); this table only says which of them go with which
// state of engine/buildstate.mjs, and what a screen may never say in that state.
const BUILT = /\bAll \d+ pages? (?:is|are) built\b|\b\d+ pages? built\b/i
const NOT_WHOLE = /\bPartly built\b|\bNone of the \d+ sections are built\b|\b\d+ of \d+ sections are built and kept; \d+ failed\b/i
const LEFT = { card: ['Partly built', 'Failed', 'Stopped'], never: BUILT }
export const BUILD_SAYS = {
  planning: { card: ['Building'], never: BUILT },
  building: { card: ['Building'], never: BUILT },
  done: { card: ['Designed'], never: NOT_WHOLE },
  unchanged: { card: ['Designed'], never: NOT_WHOLE },
  partly: { ...LEFT, card: ['Partly built'] },
  failed: { ...LEFT, card: ['Failed'] },
  stopped: { ...LEFT, card: ['Stopped'] },
  halted: { ...LEFT, card: ['Stopped'] },
  replaced: { ...LEFT, card: ['Stopped'] },
  unsure: { ...LEFT, card: ['Stopped'] }
}
// the words a card says of a website build at rest: one of these that is not the state's own is a disagreement
// (Building, Live, Draft and the app and game words say something else, and are left alone)
const CARD_WORDS = ['Designed', 'Partly built', 'Failed', 'Stopped']

const rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The strip's words for this state, as web/replaytalk.js writes them (with 1 for every count).  @param {{ state: string }} b */
export function stripWords(b) {
  return buildStrip(/** @type {any} */ ({ done: 1, planned: 1, kept: 0, failed: [], reason: null, next: null, ...b }), { working: 1, pages: 1 }).text
}
/** The same words as a pattern, whatever the counts.  @param {{ state: string }} b */
export const stripSays = b => new RegExp(`^${rx(stripWords(b)).replace(/\d+/g, '\\d+').replace(/\b(agent|page)s?\b/g, '$1s?')}$`, 'i')

/**
 * Where what is on screen disagrees with the build's one state. `seen` is what the runner read off the page:
 * the deck's strip (null when it is not on screen, or a replay plays), the chat's last line from the planner,
 * the page's own words (the Overview's tags and bars), and the card's state word.
 * @param {{ state: string } | null} b  the server's state (GET /api/runs/<id>/state), null for an app or a game
 * @param {{ strip?: string | null, chat?: string | null, page?: string | null, card?: string | null }} seen
 * @returns {{ where: string, text: string, why: string }[]}
 */
export function stateDisagrees(b, seen = {}) {
  const says = b && BUILD_SAYS[b.state]
  if (!says) return []
  const out = [], tidy = t => String(t).replace(/\s+/g, ' ').trim()
  const strip = seen.strip == null ? '' : tidy(seen.strip)
  if (strip && !stripSays(b).test(strip)) out.push({ where: 'strip', text: strip, why: `the build is ${b.state}: “${stripWords(b).replace(/\d+/g, 'N')}”` })
  for (const where of ['chat', 'page']) {
    const hit = seen[where] ? tidy(seen[where]).match(says.never) : null
    if (hit) out.push({ where, text: hit[0], why: `the build is ${b.state}` })
  }
  const card = seen.card == null ? '' : tidy(seen.card)
  const word = CARD_WORDS.find(w => new RegExp(`\\b${rx(w)}\\b`).test(card))
  if (word && !says.card.includes(word)) out.push({ where: 'card', text: card, why: `the build is ${b.state}: “${says.card[0]}”` })
  return out
}

// ---------- defects: what a captured step's record (shots.json) holds that breaks a rule a machine can check
export const KINDS = {
  raw: { letter: 'E', name: 'Raw error in the chat or a toast', gate: true },
  state: { letter: 'S', name: 'A screen disagrees with the build’s state', gate: true },
  dead: { letter: 'D', name: 'A click that did nothing', gate: true },
  axe: { letter: 'A', name: 'Standard rule (axe-core)', gate: true },
  wait: { letter: 'W', name: 'A wait with no crew cursor', gate: false },
  shift: { letter: 'L', name: 'Layout shift over 0.1', gate: false }
}
export const SHIFT_MAX = 0.1
// raw text is a defect in the chat and in a toast; the Log and a Details panel may print it
export const RAW_ZONES = ['chat', 'toast']

/**
 * The defects of one captured step, one entry per kind (per rule for axe), each with how many and where.
 * @param {any} shot a record of shots.json
 * @returns {{ key: string, kind: string, count: number, text: string, marks: { box?: number[], text: string }[] }[]}
 */
export function defectsOf(shot) {
  if (!shot?.reached) return []
  const out = [], c = shot.checks || {}
  const add = (key, marks, text) => { if (marks.length) out.push({ key, kind: key.split(':')[0], count: marks.length, text: text || marks[0].text, marks }) }
  add('raw', (c.raw || []).map(r => ({ box: r.box, text: `${r.zone}: ${r.text}` })))
  add('state', (c.state?.wrong || []).map(w => ({ box: w.box, text: `${w.where} reads “${w.text}” (${w.why})` })))
  add('dead', (c.dead || []).map(d => ({ box: d.box, text: d.name || 'a click' })))
  for (const v of shot.axe?.violations || []) {
    const marks = (v.nodes || []).map(n => ({ box: n.box, text: n.target }))
    // every node counts, though only the first few carry a box
    out.push({ key: `axe:${v.id}`, kind: 'axe', count: v.count ?? marks.length, text: `${v.help || v.id}${v.impact ? ` (${v.impact})` : ''}`, marks })
  }
  add('wait', (c.wait || []).map(w => ({ text: `${w.path} for ${(w.ms / 1000).toFixed(1)} s${w.during === 'act' ? ' after a click' : ''}` })))
  if (typeof c.shift === 'number' && c.shift > SHIFT_MAX) out.push({ key: 'shift', kind: 'shift', count: 1, text: `layout shift ${c.shift.toFixed(3)}`, marks: (c.shiftBoxes || []).map(box => ({ box, text: 'moved' })) })
  return out
}

export const stepKey = shot => `${shot.width}:${shot.id}`
/** { 'desk:home': { raw: 1, 'axe:color-contrast': 3 } } for the reached steps given.  @param {any[]} shots */
export function countsOf(shots) {
  const steps = {}
  for (const s of shots) if (s.reached) steps[stepKey(s)] = Object.fromEntries(defectsOf(s).map(d => [d.key, d.count]))
  return steps
}

/**
 * The ratchet: a count per kind per step may go down, never up. A step the baseline does not have counts from
 * nothing, so a defect on a new step is new. Only the steps given are compared (a run of a few steps says
 * nothing of the rest), and only the kinds that gate (KINDS[...].gate): waits and layout shift are reported.
 * An axe rule is new on a step only when the step had none of it: a state caught while a build runs shows one
 * node more or less from run to run, so its node count is recorded and not held.
 * @param {{ steps?: Record<string, Record<string, number>> } | null} baseline  @param {any[]} shots
 * @returns {{ fresh: { step: string, key: string, was: number, now: number, text: string }[], fixed: { step: string, key: string, was: number, now: number }[] }}
 */
export function ratchet(baseline, shots) {
  const base = baseline?.steps || {}, fresh = [], fixed = []
  for (const s of shots) {
    if (!s.reached) continue
    const step = stepKey(s), was = base[step] || {}, found = defectsOf(s)
    for (const d of found) if (KINDS[d.kind]?.gate && (d.kind === 'axe' ? !was[d.key] : d.count > (was[d.key] || 0))) fresh.push({ step, key: d.key, was: was[d.key] || 0, now: d.count, text: d.text })
    for (const [key, n] of Object.entries(was)) { const now = found.find(d => d.key === key)?.count || 0; if (key.startsWith('axe:') ? !now : now < n) fixed.push({ step, key, was: n, now }) }
  }
  return { fresh, fixed }
}

/** The baseline with these steps' counts taken as they are now; the steps not run keep theirs.  @param {any} baseline  @param {any[]} shots */
export function accept(baseline, shots) {
  const steps = { ...(baseline?.steps || {}) }
  for (const [k, v] of Object.entries(countsOf(shots))) { if (Object.keys(v).length) steps[k] = v; else delete steps[k] }
  return { note: 'Accepted defects per walkthrough step (scripts/walkthrough.mjs): a count may go down, never up. Written by --update-baseline; see docs/ux/walkthrough/README.md.', steps: Object.fromEntries(Object.entries(steps).sort(([a], [b]) => a.localeCompare(b))) }
}

/** defects.json: every defect of every step, the totals per kind, and which are new against the baseline.  @param {any[]} shots  @param {any} baseline */
export function report(shots, baseline) {
  const { fresh, fixed } = ratchet(baseline, shots)
  const isNew = (step, key) => fresh.some(f => f.step === step && f.key === key)
  const defects = shots.flatMap(s => defectsOf(s).map(d => ({ step: stepKey(s), width: s.width, id: s.id, title: s.title, flow: s.flow, file: s.file, ...d, gate: !!KINDS[d.kind]?.gate, new: isNew(stepKey(s), d.key) })))
  const totals = {}
  for (const d of defects) { const t = (totals[d.kind] ||= { steps: 0, count: 0 }); t.count += d.count }
  for (const k of Object.keys(totals)) totals[k].steps = new Set(defects.filter(d => d.kind === k).map(d => d.step)).size
  const rules = {}
  for (const d of defects) if (d.kind === 'axe') { const r = (rules[d.key.slice(4)] ||= { steps: 0, nodes: 0 }); r.steps++; r.nodes += d.count }
  return { steps: shots.filter(s => s.reached).length, totals, axe: rules, fresh, fixed, defects }
}
