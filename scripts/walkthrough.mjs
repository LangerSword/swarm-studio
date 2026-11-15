// The screen walkthrough (docs/ux/walkthrough): every screen and state a person can reach, in the
// order they meet them, at 1440 and 390 wide, each with what scripts/walkthrough-audit.js finds on it.
//
//   node scripts/walkthrough.mjs [--out docs/ux/walkthrough] [--only desk|phone]
//   (PLAYWRIGHT_DIR and CHROMIUM_PATH as for open-check)
//
// It starts its own throwaway Studio (scripts/walkthrough-fixtures.mjs) for each width, so the first
// open shows Setup, and writes img/<width>-<nn>-<id>.jpg and shots.json. A step it cannot reach is
// kept as "not reached" with the reason.
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { studio } from './walkthrough-fixtures.mjs'
import { STEPS as SCREENS } from './walkthrough-steps.mjs'
import { CHAT_STEPS } from './walkthrough-chat.mjs'
import { MORE_STEPS } from './walkthrough-more.mjs'
import { FLOW_STEPS } from './walkthrough-flows.mjs'
import { TRUTH_STEPS } from './walkthrough-truth.mjs'

// the newer sets come after the first screens, so those keep their numbers
const STEPS = [...SCREENS, ...CHAT_STEPS, ...MORE_STEPS, ...FLOW_STEPS, ...TRUTH_STEPS]

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const OUT = resolve(ROOT, arg('out', 'docs/ux/walkthrough'))
const ONLY = arg('only', '')
const PICK = arg('steps', '')
async function loadPlaywright() {
  try { return await import('playwright') } catch {}
  const dir = process.env.PLAYWRIGHT_DIR
  if (!dir) throw new Error('Playwright not found: set PLAYWRIGHT_DIR')
  const req = createRequire(join(resolve(dir), 'package.json'))
  try { return req('playwright') } catch { return req('playwright-core') }
}
const { chromium } = await loadPlaywright()
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
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  for (const W of WIDTHS) {
    const s = await studio()
    const ctx = await browser.newContext({ viewport: W.viewport, deviceScaleFactor: 1, isMobile: W.touch, hasTouch: W.touch, colorScheme: 'dark', reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    const env = { page, ...s, W, wait, phone: W.touch }
    let n = 0
    try {
      for (const step of STEPS) {
        n++
        if (PICK && !PICK.split(',').includes(step.id)) continue
        if (step.only && step.only !== W.key) continue
        const name = `${W.key}-${String(n).padStart(2, '0')}-${step.id}`
        const rec = { width: W.key, n, id: step.id, title: step.title, flow: step.flow, file: `img/${name}.jpg`, w: W.viewport.width, h: W.viewport.height }
        errors.length = 0
        try {
          await Promise.race([step.run(env), wait(25000).then(() => { throw new Error('took over 25 s') })])
          await wait(step.settle ?? 500)
          await page.screenshot({ path: join(OUT, rec.file), type: 'jpeg', quality: 55 })
          rec.audit = await page.evaluate(`${AUDIT}(${JSON.stringify({ touch: W.touch })})`)
          // controls a person only finds by hovering (the owner's rule: nothing behind a hover); a mouse only
          if (!W.touch) rec.audit.hover = await hoverOnly(page)
          rec.reached = true
        } catch (err) {
          rec.reached = false
          rec.why = String(err.message || err).split('\n')[0].slice(0, 200)
          try { await page.screenshot({ path: join(OUT, rec.file), type: 'jpeg', quality: 55 }) } catch {}
        }
        if (errors.length) rec.pageErrors = [...errors].slice(0, 3)
        console.log(`${rec.reached ? '✓' : '✗'} ${name}${rec.reached ? '' : `: ${rec.why}`}`)
        shots = shots.filter(x => !(x.width === rec.width && x.id === rec.id))
        shots.push(rec)
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
  shots.sort((a, b) => (a.width === b.width ? a.n - b.n : a.width === 'desk' ? -1 : 1))
  writeFileSync(join(OUT, 'shots.json'), JSON.stringify(shots, null, 1))
}
