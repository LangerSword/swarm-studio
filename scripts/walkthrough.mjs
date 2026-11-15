// The screen walkthrough (docs/ux/walkthrough): every screen and state a person can reach, in the
// order they meet them, at 1440 and 390 wide, each with what scripts/walkthrough-audit.js finds on it.
//
//   node scripts/walkthrough.mjs [--out docs/ux/walkthrough] [--only desk|phone] [--steps id,id]
//                                [--no-hover] [--no-axe] [--update-baseline] [--baseline <file>]
//   (PLAYWRIGHT_DIR and CHROMIUM_PATH as for open-check)
//
// It starts its own throwaway Studio (scripts/walkthrough-fixtures.mjs) for each width, so the first
// open shows Setup, and writes img/<width>-<nn>-<id>.jpg and shots.json. A step it cannot reach is
// kept as "not reached" with the reason.
//
// It also finds defects by itself, on every state it captures (docs/ux/walkthrough/README.md):
//   axe      the standard rules (axe-core through @axe-core/playwright, from PLAYWRIGHT_DIR or tools/dev)
//   checks   no raw error in the chat or a toast, the screen agrees with the build's one state, a wait shows
//            a crew cursor, a click does something, the layout does not jump (scripts/walkthrough-probe.mjs)
// and writes them to shots.json and defects.json. It exits 1 only when a step has more of a defect than the
// baseline accepts (docs/ux/walkthrough/defects-baseline.json; --update-baseline accepts what this run found).
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { studio } from './walkthrough-fixtures.mjs'
import { STEPS as SCREENS } from './walkthrough-steps.mjs'
import { CHAT_STEPS } from './walkthrough-chat.mjs'
import { MORE_STEPS } from './walkthrough-more.mjs'
import { FLOW_STEPS } from './walkthrough-flows.mjs'
import { watch, acted, beforeStep, afterStep, axe } from './walkthrough-probe.mjs'
import { accept, ratchet, report, KINDS } from './walkthrough-checks.mjs'

// the newer sets come after the first screens, so those keep their numbers (a new set: one line here)
const STEPS = [
  ...SCREENS,
  ...CHAT_STEPS,
  ...MORE_STEPS,
  ...FLOW_STEPS
]

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const OUT = resolve(ROOT, arg('out', 'docs/ux/walkthrough'))
const ONLY = arg('only', '')
const PICK = arg('steps', '')
const flag = k => process.argv.includes(`--${k}`)
const HOVER = !flag('no-hover'), AXE = !flag('no-axe')
// the accepted defects: one committed file, wherever the pictures go
const BASELINE = resolve(ROOT, arg('baseline', 'docs/ux/walkthrough/defects-baseline.json'))
async function loadPlaywright() {
  try { return await import('playwright') } catch {}
  const dir = process.env.PLAYWRIGHT_DIR
  if (!dir) throw new Error('Playwright not found: set PLAYWRIGHT_DIR')
  const req = createRequire(join(resolve(dir), 'package.json'))
  try { return req('playwright') } catch { return req('playwright-core') }
}
// @axe-core/playwright is a development dependency pinned in tools/dev (CI's ui-audit uses the same one): beside
// Playwright when it is there, else from tools/dev. Without it the run goes on and says the rules were not checked.
function loadAxe() {
  for (const dir of [process.env.PLAYWRIGHT_DIR, join(ROOT, 'tools/dev')].filter(Boolean)) {
    try { const m = createRequire(join(resolve(dir), 'package.json'))('@axe-core/playwright'); return m.default || m.AxeBuilder || m } catch {}
  }
  return null
}
const { chromium } = await loadPlaywright()
const AxeBuilder = AXE ? loadAxe() : null
if (AXE && !AxeBuilder) console.warn('axe: @axe-core/playwright not found (npm ci --prefix tools/dev); the standard rules are not checked in this run')
const AUDIT = readFileSync(fileURLToPath(new URL('./walkthrough-audit.js', import.meta.url)), 'utf8')
const wait = ms => new Promise(r => setTimeout(r, ms))

// Controls that are in the page but cannot be seen until the pointer is over their row or card. Each hidden
// control's nearest visible ancestor is hovered (25 at most), and the ones that appear are listed with that
// ancestor's box. The audit in the page cannot do this: it has no pointer.
async function hoverOnly(page) {
  const SEEN = `el => el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false && (() => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth })()`
  const hosts = await page.evaluate(`(() => {
    const seen = ${SEEN}
    const ACT = 'button, a[href], input:not([type=hidden]), select, [role=button], [role=menuitem], [role=switch]'
    const hosts = []
    document.querySelectorAll('[data-walk-host]').forEach(e => e.removeAttribute('data-walk-host'))
    document.querySelectorAll('[data-walk-hid]').forEach(e => e.removeAttribute('data-walk-hid'))
    for (const el of document.querySelectorAll(ACT)) {
      if (seen(el) || el.hidden || el.closest('[hidden], [inert], [aria-hidden=true], dialog:not([open])')) continue
      let host = el.parentElement
      while (host && !seen(host)) host = host.parentElement
      if (!host || host === document.body || host === document.documentElement) continue
      const r = host.getBoundingClientRect()
      if (r.width * r.height > innerWidth * innerHeight * 0.4) continue
      let i = hosts.indexOf(host)
      if (i < 0) { if (hosts.length >= 25) continue; i = hosts.push(host) - 1; host.setAttribute('data-walk-host', i) }
      el.setAttribute('data-walk-hid', i)
    }
    return hosts.map(h => { const r = h.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })
  })()`)
  const found = []
  for (let i = 0; i < hosts.length; i++) {
    const [x, y, w, h] = hosts[i]
    await page.mouse.move(x + w / 2, y + h / 2)
    await wait(180)
    const shown = await page.evaluate(`(() => { const seen = ${SEEN}; return [...document.querySelectorAll('[data-walk-hid="${i}"]')].filter(seen).map(el => (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40)) })()`)
    if (shown.length) found.push({ box: hosts[i], shows: shown.slice(0, 6) })
  }
  await page.mouse.move(0, 0)
  await wait(120)
  return found
}

mkdirSync(join(OUT, 'img'), { recursive: true })
const WIDTHS = [
  { key: 'desk', viewport: { width: 1440, height: 900 }, touch: false },
  { key: 'phone', viewport: { width: 390, height: 844 }, touch: true }
].filter(w => !ONLY || w.key === ONLY)

let shots = []
try { shots = JSON.parse(readFileSync(join(OUT, 'shots.json'), 'utf8')) } catch {}
// the steps this run captured: only these are held to the baseline
const ran = []
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  for (const W of WIDTHS) {
    const s = await studio()
    const ctx = await browser.newContext({ viewport: W.viewport, deviceScaleFactor: 1, isMobile: W.touch, hasTouch: W.touch, colorScheme: 'dark', reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await watch(ctx, page)
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    // acted(fn, name): a step wraps a click with it, and a dead click or a silent wait is noted (walkthrough-probe.mjs)
    const env = { page, ...s, W, wait, phone: W.touch, acted: (fn, name) => acted(page, fn, name) }
    let n = 0
    try {
      for (const step of STEPS) {
        n++
        // a retired step keeps its number and is never run (its `retired` says what shows the screen now)
        if (step.retired) continue
        if (PICK && !PICK.split(',').includes(step.id)) continue
        if (step.only && step.only !== W.key) continue
        const name = `${W.key}-${String(n).padStart(2, '0')}-${step.id}`
        const rec = { width: W.key, n, id: step.id, title: step.title, flow: step.flow, file: `img/${name}.jpg`, w: W.viewport.width, h: W.viewport.height }
        errors.length = 0
        await beforeStep(page)
        try {
          await Promise.race([step.run(env), wait(25000).then(() => { throw new Error('took over 25 s') })])
          await wait(step.settle ?? 500)
          await page.screenshot({ path: join(OUT, rec.file), type: 'jpeg', quality: 55 })
          rec.audit = await page.evaluate(`${AUDIT}(${JSON.stringify({ touch: W.touch })})`)
          rec.reached = true
          // from here on nothing un-reaches the step: a check that cannot measure says so in its own field
          rec.checks = await afterStep(page, { audit: rec.audit })
          // caught while a build runs: what is on screen differs from run to run, so axe is reported, not held
          if (step.uses === 'live' || ['planning', 'building'].includes(rec.checks.state?.state)) rec.moving = true
          if (AxeBuilder) rec.axe = await axe(page, AxeBuilder).catch(err => ({ violations: [], error: String(err.message || err).split('\n')[0].slice(0, 160) }))
          // controls a person only finds by hovering (the owner's rule: nothing behind a hover); a mouse only,
          // and last, since it moves the pointer over the page
          if (!W.touch && HOVER) rec.audit.hover = await hoverOnly(page).catch(() => [])
        } catch (err) {
          rec.reached = false
          rec.why = String(err.message || err).split('\n')[0].slice(0, 200)
          try { await page.screenshot({ path: join(OUT, rec.file), type: 'jpeg', quality: 55 }) } catch {}
        }
        if (errors.length) rec.pageErrors = [...errors].slice(0, 3)
        console.log(`${rec.reached ? '✓' : '✗'} ${name}${rec.reached ? '' : `: ${rec.why}`}`)
        shots = shots.filter(x => !(x.width === rec.width && x.id === rec.id))
        shots.push(rec)
        ran.push(rec)
        try { await step.after?.(env) } catch {}
      }
    } finally {
      await ctx.close()
      s.stop()
      // a second Studio a step started and a skipped step would have ended
      for (const k of ['night', 'nh', 'fs']) { try { env[k]?.stop?.() } catch {} }
    }
  }
} finally {
  await browser.close()
  const retired = new Set(STEPS.filter(x => x.retired).map(x => x.id))
  shots = shots.filter(x => !retired.has(x.id))
  shots.sort((a, b) => (a.width === b.width ? a.n - b.n : a.width === 'desk' ? -1 : 1))
  writeFileSync(join(OUT, 'shots.json'), JSON.stringify(shots, null, 1))
}

// ---------- the defects, and the ratchet: only the steps this run captured are compared
let baseline = null
try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) } catch {}
if (flag('update-baseline')) {
  baseline = accept(baseline, ran)
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 1) + '\n')
  console.log(`baseline: ${ran.filter(r => r.reached).length} steps accepted as they are → ${BASELINE}`)
}
writeFileSync(join(OUT, 'defects.json'), JSON.stringify(report(shots, baseline), null, 1))
const mine = report(ran, baseline)
console.log(`\ndefects in the ${mine.steps} steps captured: ${Object.entries(mine.totals).map(([k, t]) => `${k} ${t.count} (${t.steps} steps)`).join(' · ') || 'none'}`)
for (const d of mine.defects.filter(d => d.kind !== 'axe')) console.log(`  ${KINDS[d.kind].letter} ${d.step} ${d.key} ×${d.count}: ${d.text}`)
for (const [rule, r] of Object.entries(mine.axe).sort((a, b) => b[1].nodes - a[1].nodes)) console.log(`  A ${rule}: ${r.nodes} nodes on ${r.steps} steps`)
const { fresh, fixed } = ratchet(baseline, ran)
for (const f of fixed) console.log(`fixed: ${f.step} ${f.key} ${f.was} → ${f.now} (run with --update-baseline to keep it down)`)
for (const f of fresh) console.log(`NEW: ${f.step} ${f.key} ${f.was} → ${f.now}: ${f.text}`)
if (fresh.length) { console.log(`${fresh.length} new defect${fresh.length > 1 ? 's' : ''} against ${BASELINE}`); process.exitCode = 1 }
