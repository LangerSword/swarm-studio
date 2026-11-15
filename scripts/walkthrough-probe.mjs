// What the walkthrough measures on a page besides the picture (scripts/walkthrough.mjs runs these after every
// step; scripts/walkthrough-checks.mjs judges what they return). Nothing here fails a step: a probe that cannot
// measure says so and the step stays reached.
//
//   watch(ctx, page)        once per page: layout shift, DOM changes and the last click (in the page), requests (here)
//   acted(page, fn, name)   for a step file: wraps one click or key press, and notes a dead click or a silent wait
//   afterStep(page, opts)   the truth checks of one captured state
//   axe(page, AxeBuilder)   the standard rules (axe-core) on the Studio's own UI
import { stateDisagrees, RAW_ZONES } from './walkthrough-checks.mjs'

// what says "something is on its way": the kit's skeletons and busy marks (tools/dev/audit/audit.spec.mjs), a
// crew cursor, Hermia thinking, a progress bar, and the strip or the work chip while agents work
const BUSY = '[aria-busy="true"], [role="progressbar"], .sk, .skeleton, .sk-lines, .wait-in, .spin, .ui-progress, .ui-badge-busy, .app-loading, .think, .item.working, .cursor, .pj-cursors > *, .rv-cursor, .pl-work, .gh-work, .work-stop, #status[data-state="working"], #status[data-state="planning"]'
// requests that stay open by design, or that nobody waits for: the event stream, and what this file asks itself
const QUIET = /\/events\b|\/api\/(stream|events|state|heartbeat|presence)\b|\/api\/runs\/[\w-]+\/state$/
const SLOW = 1000
const wait = ms => new Promise(r => setTimeout(r, ms))
const within = (p, ms) => Promise.race([p, wait(ms).then(() => { throw new Error(`took over ${ms / 1000} s`) })])

// in the page, from its first script on: the layout shift so far (as CLS counts it: none within half a second of
// the person's own input), every DOM change, and where the last click landed. A shift in the page's first three
// seconds is its load settling (the Studio's top bar moves as it fills, on every load): that is kept apart as
// `load`, so `shift` is what moved in the state the step shows
const INIT = `(() => {
  if (window.__walk) return
  const w = window.__walk = { shift: 0, load: 0, boxes: [], muts: 0, click: null }
  try {
    new PerformanceObserver(list => { for (const e of list.getEntries()) { if (e.hadRecentInput) continue; if (e.startTime < 3000) { w.load += e.value; continue } w.shift += e.value; for (const s of e.sources || []) { const r = s.currentRect; if (r && w.boxes.length < 6) w.boxes.push([Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]) } } }).observe({ type: 'layout-shift', buffered: true })
  } catch {}
  const start = () => new MutationObserver(l => { w.muts += l.length }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true })
  addEventListener('click', e => { const r = e.target?.getBoundingClientRect?.(); w.click = r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null }, true)
  // (focus landing on the control that was pressed is not an answer, so it is not counted)
  for (const t of ['scroll', 'input', 'change', 'toggle']) addEventListener(t, () => { w.muts++ }, true)
})()`

export async function watch(ctx, page) {
  await ctx.addInitScript(INIT)
  const st = page.__walk = { open: new Map(), started: 0, acts: [], watched: 0 }
  page.on('request', r => {
    // a new page: what the last one was waiting for went with it
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) st.open.clear()
    if (!['fetch', 'xhr'].includes(r.resourceType())) return
    let path = ''
    try { path = new URL(r.url()).pathname } catch {}
    if (QUIET.test(path)) return
    st.started++
    st.open.set(r, { path, t: Date.now(), asks: r.method() !== 'GET' })
  })
  const end = r => st.open.delete(r)
  page.on('requestfinished', end)
  page.on('requestfailed', end)
}

const busyShown = page => page.evaluate(sel => [...document.querySelectorAll(sel)].some(el => el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false && el.getBoundingClientRect().width > 0), BUSY).catch(() => true)
const pageMark = page => page.evaluate(() => (window.__walk ? { muts: window.__walk.muts, click: window.__walk.click } : null)).catch(() => null)

/**
 * One action of a step (a click, a key press), watched for a second: `await acted(page, () => button.click(), 'Resume')`.
 * A dead click is one after which nothing in the page changed, no request started and the address stayed. A silent
 * wait is a request the action started that is still going a second later with nothing on screen saying so. Both
 * are noted on the step (shots.json `checks.dead`, `checks.wait`); neither throws. The action's own error does.
 * `env.acted(fn, name)` is the same with the step's page.
 */
export async function acted(page, fn, name = '') {
  const st = page.__walk
  if (!st) return fn()
  st.watched++
  const before = await pageMark(page), url = page.url(), started = st.started, t0 = Date.now()
  const out = await fn()
  let changed = false, mine = [], after = before
  while (Date.now() - t0 < SLOW + 150) {
    await wait(100)
    after = await pageMark(page)
    // a page that went away (a load, a new address) is a change
    changed ||= !after || !before || after.muts > before.muts || page.url() !== url || st.started > started
    mine = [...st.open.values()].filter(r => r.t >= t0)
    if (changed && !mine.length) break
  }
  const rec = { name: String(name || '').slice(0, 60), ...(after?.click ? { box: after.click } : {}) }
  if (!changed) st.acts.push({ ...rec, dead: true })
  const slow = mine.filter(r => Date.now() - r.t >= SLOW)
  if (slow.length && !(await busyShown(page))) st.acts.push({ ...rec, wait: slow.map(r => ({ path: r.path, ms: Date.now() - r.t, during: 'act' })) })
  return out
}

// ---------- the build's state against the words on screen
const SEEN = () => {
  const vis = el => !!el && el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false && el.getBoundingClientRect().width > 1
  const box = el => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
  const one = (sel, text = el => el.innerText) => { const el = [...document.querySelectorAll(sel)].filter(vis).at(-1); return el ? { text: text(el) || '', box: box(el) } : null }
  const status = document.querySelector('#status')
  return {
    token: (window.SWARM || {}).token || '',
    // a replay's strip reads Replay on purpose: it is a recording, not the build's state
    replay: status?.dataset.replay === 'true',
    strip: one('#status .st-txt'),
    // the planner's newest finished line in the chat (not one still being written)
    chat: one('#feed .item.bot:not(.working) .txt'),
    // the Overview's own words: the tags on its pages, the live line and the work chip, never the built pages
    page: one('.project:not(.plan) .pj-world', () => [...document.querySelectorAll('.pj-world .pt-tag, .project .pj-now, .topbar .work-chip')].filter(vis).map(x => x.innerText).join(' · ')),
    cards: [...document.querySelectorAll('.home .card[data-id]')].filter(vis).map(c => ({ id: c.dataset.id, text: c.querySelector('.st')?.innerText || '', box: box(c) }))
  }
}
async function stateCheck(page) {
  const url = new URL(page.url()), q = url.searchParams
  if (!/^https?:$/.test(url.protocol)) return null
  const seen = await page.evaluate(SEEN)
  const get = path => fetch(url.origin + path, { headers: { 'x-swarm-token': seen.token }, signal: AbortSignal.timeout(4000) }).then(r => (r.ok ? r.json() : null)).catch(() => null)
  const wrong = []
  const judge = (b, parts) => { for (const w of stateDisagrees(b, Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v?.text ?? null])))) wrong.push({ ...w, box: parts[w.where]?.box }) }
  // the open build: its strip, its chat and its Overview
  const run = q.get('room') === 'game' || q.get('replay') ? null : q.get('version') || q.get('run')
  let state = null
  if (run && /^[\w-]{1,64}$/.test(run)) {
    const a = (await get(`/api/runs/${run}/state`))?.state || null
    const parts = { strip: seen.replay ? null : seen.strip, chat: seen.chat, page: seen.page }
    // a build going on may move between the two reads: only a state that held still is judged
    const b = (await get(`/api/runs/${run}/state`))?.state || null
    if (a && b && a.state === b.state) { state = a.state; judge(a, parts) }
  }
  // Projects: every card against its newest build
  if (seen.cards.length) {
    const list = await get('/api/projects')
    for (const c of seen.cards) {
      const p = list?.projects?.find(x => x.id === c.id)
      if (p?.state?.site) judge({ state: p.state.site }, { card: c })
    }
  }
  return run || seen.cards.length ? { ...(run ? { run, state } : {}), ...(seen.cards.length ? { cards: seen.cards.length } : {}), wrong } : null
}

/**
 * The truth checks of the state the step left on screen. `audit` is what scripts/walkthrough-audit.js returned
 * for it (the raw errors, each with its zone).
 * @returns {Promise<{ raw: any[], state: any, wait: any[], dead: any[], shift: number, loadShift: number, shiftBoxes?: number[][], acts: number, errors?: Record<string, string> }>}
 */
export async function afterStep(page, { audit } = {}) {
  const st = page.__walk, errors = {}
  const safe = async (name, fn, or) => { try { return await within(fn(), 8000) } catch (err) { errors[name] = String(err.message || err).split('\n')[0].slice(0, 160); return or } }
  const out = { raw: (audit?.raw || []).filter(r => RAW_ZONES.includes(r.zone)), state: null, wait: [], dead: [], shift: 0, loadShift: 0, acts: 0 }
  out.state = await safe('state', () => stateCheck(page), null)
  const mark = await safe('shift', () => page.evaluate(() => (window.__walk ? { shift: window.__walk.shift, load: window.__walk.load, boxes: window.__walk.boxes } : null)), null)
  if (mark) { out.shift = Math.round(mark.shift * 1000) / 1000; out.loadShift = Math.round(mark.load * 1000) / 1000; if (mark.boxes.length) out.shiftBoxes = mark.boxes }
  if (st) {
    // how many actions the step had watched (env.acted)
    out.acts = st.watched
    out.dead = st.acts.filter(a => a.dead).map(({ name, box }) => ({ name, box }))
    out.wait = st.acts.flatMap(a => a.wait || [])
    // what the person asked for (a POST, not what the page fetches for itself in the background) and is still
    // on its way now, a second or more later, with nothing saying so
    const slow = [...st.open.values()].filter(r => r.asks && Date.now() - r.t >= SLOW)
    if (slow.length && !(await busyShown(page))) out.wait.push(...slow.map(r => ({ path: r.path, ms: Date.now() - r.t, during: 'step' })))
  }
  if (Object.keys(errors).length) out.errors = errors
  return out
}
/** Before a step: what the last one left is forgotten (the page's own counts start again with its next load too). */
export async function beforeStep(page) {
  if (page.__walk) { page.__walk.acts.length = 0; page.__walk.watched = 0 }
  await page.evaluate(() => { if (window.__walk) { window.__walk.shift = 0; window.__walk.load = 0; window.__walk.boxes = [] } }).catch(() => {})
}

// ---------- the standard rules: axe-core, WCAG 2.0 to 2.2 A and AA, as CI's ui-audit runs it (docs/ux/AUDIT.md)
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
// built pages, pictures and art are the person's content, not the Studio's UI (scripts/walkthrough-audit.js CONTENT)
const CONTENT = ['iframe', '.ab', '.frame', '.slot', '.pj-world .sk', '[data-content]']
const NODES = 5
/**
 * @param {any} AxeBuilder the default export of @axe-core/playwright
 * @returns {Promise<{ violations: { id: string, impact: string, help: string, count: number, nodes: { target: string, box?: number[] }[] }[], incomplete: number }>}
 */
export async function axe(page, AxeBuilder) {
  // legacy mode: axe runs in this page alone and opens no second page in the context (a step may go on from
  // where the last one left the page); target-size is the hand audit's (40 px, 44 on touch)
  let b = new AxeBuilder({ page }).withTags(TAGS).disableRules(['target-size']).setLegacyMode(true)
  for (const sel of CONTENT) b = b.exclude(sel)
  const res = await within(b.analyze(), 20000)
  const violations = res.violations.map(v => ({ id: v.id, impact: v.impact || '', help: v.help, count: v.nodes.length, nodes: v.nodes.slice(0, NODES).map(n => ({ target: n.target.flat().join(' ').slice(0, 120), sel: n.target.length === 1 && typeof n.target[0] === 'string' ? n.target[0] : null })) }))
  const boxes = await page.evaluate(sels => sels.map(s => { try { const el = s && document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null } catch { return null } }), violations.flatMap(v => v.nodes.map(n => n.sel))).catch(() => [])
  let i = 0
  for (const v of violations) for (const n of v.nodes) { const box = boxes[i++]; delete n.sel; if (box) n.box = box }
  return { violations, incomplete: res.incomplete.length }
}
