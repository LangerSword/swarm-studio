// The Overview's chat is its one place to type (owner, 2026-11-15; docs/ux/breadboards/overview.md): the steps
// of the screen walkthrough (docs/ux/walkthrough) that prove it. Same step shape as the other sets; every id
// starts with `o-`. Each step loads its own address, so `--steps o-…` works on any one of them, and each
// holds a truth check: what the chat says must be what the server answered.
//
// They run on one throwaway Studio of their own (kept on env.fs, which the runner and the flows end): a
// scripted planner that reads a question as a talk and answers it from what the Studio told it, and a project
// with a picture. It has no image model, so a picture asked for is refused for real; the one step that shows a
// picture taken stubs that answer and says so in its flow.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { studio } from './walkthrough-fixtures.mjs'

const vis = (page, sel, timeout = 8000) => page.locator(sel).first().waitFor({ state: 'visible', timeout })
const click = async (page, sel, timeout) => { await vis(page, sel, timeout); await page.locator(sel).first().click() }
const shown = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const no = why => { throw new Error(why) }

const OV = 'Overview: the chat is the one place to type'
const ART = 'art:home/hero/a kiln glowing at night'

// ---------- the Studio
const sysOf = ask => String(ask.messages?.[0]?.content || '')
// what the Studio itself told the planner about the open project, read back: the one scripted answer that may
// speak about real state (as in scripts/walkthrough-flows.mjs)
function told(ask) {
  const s = sysOf(ask)
  for (const [from, to] of [['What is there now:\n', '\nNever say nothing exists'], ['The open project:\n', '\n\nSwarm Studio on this computer']]) {
    const a = s.indexOf(from)
    if (a < 0) continue
    const b = s.indexOf(to, a)
    const all = s.slice(a + from.length, b < 0 ? undefined : b).replace(/\s+/g, ' ').trim()
    if (all) return all.length <= 320 ? all : all.slice(0, 320).replace(/\s+\S*$/, '')
  }
  return ''
}
function model(ask) {
  const s = sysOf(ask)
  // a message typed into a built project is read first: a question is a talk, the rest a build
  if (/^A person typed this into the box/.test(s)) return /\?\s*$/.test(String(ask.messages?.at(-1)?.content || '').split('\n').at(-1)) ? 'talk' : 'build'
  if (/^You are Hermia, the planner of a crew/.test(s)) return `From what the Studio tells me: ${told(ask) || 'nothing about this project.'}`
  // the builders and the build's own planner: no answer
  return null
}
let KILN = ''
function seed({ runs, site, T0, rid }) {
  const run = KILN = rid(30)
  site(runs, run, { brief: 'Night Kiln, a pottery studio that fires at night', name: 'Night Kiln', t: T0 + 30 * 3600e3, pages: [['home', 'Night Kiln'], ['about', 'About']] })
  // a picture the crew painted, so the Overview has one to select
  appendFileSync(join(runs, run, 'events.jsonl'), `${JSON.stringify({ type: 'image:queued', t: T0 + 31 * 3600e3, run, page: 'home', layer: 'hero', gen: 'a kiln glowing at night' })}\n${JSON.stringify({ type: 'image:failed', t: T0 + 31 * 3600e3 + 4000, run, page: 'home', layer: 'hero', gen: 'a kiln glowing at night', message: 'no image model' })}\n`)
}
async function own(env, key, opts) {
  if (env.fs?.key === key) return env.fs
  try { env.fs?.ctl?.release?.(); env.fs?.ctl?.buildGo?.(); env.fs?.stop() } catch {}
  env.fs = null
  const s = await studio(opts)
  await s.api('/api/setup', { seen: true }).catch(() => {})
  env.fs = { ...s, key, ctl: {} }
  return env.fs
}
const withModel = env => own(env, 'overview', { model, setup: seed })

// ---------- the page
async function overviewOf(env, s, id) {
  await env.page.goto(`${s.BASE}/?project=${id}&version=${id}`)
  await vis(env.page, '.project:not(.plan) .pj-world', 15000)
  await env.wait(900)
}
const onOverview = page => page.evaluate(() => document.body.classList.contains('cosmos-project'))
const chatIsOpen = page => page.evaluate(() => document.body.classList.contains('cosmos-chat'))
// the text boxes a person can see and type a request in, outside the inspector's own fields and the search
const boxes = page => page.evaluate(() => [...document.querySelectorAll('textarea, input:not([type]), input[type=text]')].filter(e => !e.closest('.pj-insp, .pj-search, [hidden]') && e.checkVisibility?.() !== false && e.getBoundingClientRect().width > 1).map(e => e.id || e.className || e.name || e.tagName))
// one text box, and it is the chat's
async function oneBox(page) {
  const all = await boxes(page)
  if (all.length !== 1 || all[0] !== 'brief') no(`the Overview shows these text boxes: ${JSON.stringify(all)} (the chat's is the only one allowed)`)
  if (await page.locator('.pj-dock input, .pj-dock textarea, .pj-insp .pj-ask').count()) no('the dock or the inspector still has a "Tell the crew…" box')
}
// the chat's box: open on a desk; on a phone a sheet behind the dock's Chat tool, or the picked section's Chat
async function chat(env) {
  const { page } = env
  if (!(await shown(page, '#brief'))) {
    if (!env.phone) no('the chat is not open on the Overview at 1440')
    if (await shown(page, '.pj-insp .pj-tochat')) await page.locator('.pj-insp .pj-tochat').first().click()
    else await click(page, '.pj-dock [data-tool="comment"]')
  }
  await vis(page, '#brief')
}
async function send(env, text) { await chat(env); await env.page.locator('#brief').fill(text); await env.page.locator('#brief').press('Enter') }
const feedText = page => page.locator('#feed').first().innerText().catch(() => '')
const toEnd = page => page.evaluate(() => { const f = document.querySelector('#feed'); if (f) f.scrollTop = f.scrollHeight })
const posted = (page, re) => page.waitForResponse(r => re.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null)
// no "On it" toast: what happened is a line in the chat
async function noToast(page) { const t = await page.evaluate(() => document.querySelector('.project .hm-toast')?.innerText || ''); if (/On it|Painting/i.test(t)) no(`a toast says "${t.trim()}" instead of the chat`) }
// the chat says what the server answered: accepted, or "Nothing happened: <why>"
async function saysTruth(env, res, accepted) {
  await env.wait(1500)
  await toEnd(env.page)
  const text = await feedText(env.page)
  if (!res) no('nothing was sent to the server')
  if (res.ok()) {
    if (/Nothing happened/.test(text)) no('the server took the request and the chat says "Nothing happened"')
    if (!accepted.test(text)) no(`the server took the request and the chat does not say so (looked for ${accepted})`)
  } else if (!/Nothing happened: /.test(text)) no(`the server refused the request (${res.status()}) and the chat does not say "Nothing happened: <why>"`)
  await noToast(env.page)
}
async function pickSection(env, s, id) {
  const { page } = env
  await overviewOf(env, s, id)
  await page.locator('.pj-world .ab[data-key="page:home"]').first().click()
  await vis(page, '.project .pj-insp:not([hidden])')
  await click(page, '.pj-insp .pj-ly[data-layer="home/hero"]', 10000)
  await vis(page, '.pj-insp .pj-back')
}

const IMAGE = '**/api/runs/*/image'
const WORDS = 'The kiln door open, sparks in the dark'
async function pickPicture(env, s) {
  await overviewOf(env, s, KILN)
  await env.page.locator(`.pj-world .ab[data-key="${ART}"]`).first().click()
  await vis(env.page, '.project .pj-insp:not([hidden])')
}

export const OVERVIEW_STEPS = [
  { id: 'o-ways-in', flow: OV, title: 'Every way into the Overview: an address, Projects, Back from a room; folded with ×, back with the dock’s Chat', run: async env => {
    const s = await withModel(env)
    const { page } = env
    await overviewOf(env, s, s.ids.site)
    if (env.phone) {
      // a phone: the chat is a sheet over the stage, so it waits for the dock's Chat tool
      if (await chatIsOpen(page)) no('at 390 the chat sheet opened by itself over the stage')
      if ((await boxes(page)).length) no('at 390 a text box shows with the chat folded')
      await chat(env)
      return oneBox(page)
    }
    if (!(await chatIsOpen(page)) || !(await shown(page, '#brief'))) no('from an address: the chat is not open')
    await oneBox(page)
    // folded by the person: no text box at all; the dock's Chat tool brings it back
    await click(page, '.side .tabs .cosmos-fold')
    await env.wait(300)
    if ((await boxes(page)).length) no('with the chat folded a text box still shows')
    await click(page, '.pj-dock [data-tool="comment"]')
    await vis(page, '#brief')
    // Back from a room, with the chat folded there
    await page.goto(`${s.BASE}/?version=${s.ids.site}&room=deck`)
    await vis(page, '#viewport', 15000)
    await env.wait(900)
    if (await shown(page, '.side .tabs .cosmos-fold')) { await page.locator('.side .tabs .cosmos-fold').first().click(); await env.wait(300) }
    await click(page, '.topbar .cosmos-back')
    await vis(page, '.project:not(.plan) .pj-world', 15000)
    if (!(await onOverview(page)) || !(await shown(page, '#brief'))) no('Back from a room: the chat is not open on the Overview')
    // from Projects
    await page.goto(`${s.BASE}/`)
    await vis(page, '.home', 15000)
    await env.wait(700)
    await page.locator('.card[data-id]', { hasText: 'Shift Log' }).first().click()
    await vis(page, '.project:not(.plan) .pj-world', 15000)
    await env.wait(600)
    if (!(await onOverview(page)) || !(await shown(page, '#brief'))) no('from Projects: the chat is not open on the Overview')
    await oneBox(page)
  }, settle: 1200 },
  { id: 'o-fix-section', flow: OV, title: 'A change asked in the chat with a page’s section picked: the chip says what it is about, and the chat says who took it', run: async env => {
    const s = await withModel(env)
    await pickSection(env, s, s.ids.site)
    await chat(env)
    await vis(env.page, '#brief-form .pj-scope:not(.pj-mkchip)')
    await oneBox(env.page)
    const res = posted(env.page, /\/comment$/)
    await send(env, 'Make the headline shorter')
    await saysTruth(env, await res, /Make the headline shorter/)
  }, settle: 800 },
  { id: 'o-repaint', flow: `${OV} (stubbed: the server takes the picture; this Studio has no image model)`, title: 'New words for a picture, asked in the chat with the picture selected: the chat says it is being painted', run: async env => {
    const s = await withModel(env)
    await pickPicture(env, s)
    // the one stubbed answer: POST …/image says yes, as a Studio with an image model does (server/server.mjs runImage)
    await env.page.route(IMAGE, r => (r.request().method() === 'POST' ? r.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true,"provider":"stub"}' }) : r.continue()))
    const res = posted(env.page, /\/image$/)
    await send(env, WORDS)
    const got = await res
    if (!got?.ok()) no('the stubbed answer did not reach the page')
    await saysTruth(env, got, /Painting it again\./)
    if (!(await feedText(env.page)).includes(WORDS)) no('the chat does not show the words that were sent')
  }, settle: 800, after: env => env.page.unroute(IMAGE) },
  { id: 'o-question', flow: OV, title: 'A question asked in the chat: the planner answers here, on the Overview, and nothing is built', run: async env => {
    const s = await withModel(env)
    await overviewOf(env, s, s.ids.site)
    let built = false
    const watch = r => { if (new URL(r.url()).pathname === '/api/run' && r.method() === 'POST') built = true }
    env.page.on('request', watch)
    try {
      await send(env, 'Which pages does this site have?')
      await env.page.locator('#feed').getByText(/From what the Studio tells me/).last().waitFor({ state: 'visible', timeout: 15000 })
    } finally { env.page.off('request', watch) }
    if (built) no('a question started a build')
    if (!(await onOverview(env.page))) no('the question moved the person off the Overview')
    if (!/Which pages does this site have\?/.test(await feedText(env.page))) no('the chat does not show the question')
    await toEnd(env.page)
  }, settle: 800 },
  { id: 'o-refused', flow: OV, title: 'A request the server refuses (a picture asked for with no image model): the chat says “Nothing happened” and why', run: async env => {
    const s = await withModel(env)
    await pickPicture(env, s)
    const res = posted(env.page, /\/image$/)
    await send(env, WORDS)
    const got = await res
    if (got?.ok()) no('this Studio has no image model and its server took the picture')
    await saysTruth(env, got, /$^/)
    if (!(await feedText(env.page)).includes(WORDS)) no('the chat does not show the words that were sent')
    if (!(await onOverview(env.page))) no('the refusal moved the person off the Overview')
  }, settle: 800 }
]
