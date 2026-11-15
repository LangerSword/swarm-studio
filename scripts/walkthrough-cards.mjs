// The walkthrough's card steps (ids `c-`): the Projects card, the top bar's work chip, the Publish menu and a
// build the server closed when it started, each read from the one build state (engine/buildstate.mjs;
// docs/ux/states/build.md B6, B7, B26; docs/ux/states/publish.md PU2, PU3). Every step checks its own truth: the
// words on the page must be the state's, and a step that finds other words fails.
//
// They run on a throwaway Studio of their own (scripts/walkthrough-fixtures.mjs) with three projects added:
//   Harbor Light  version 1 whole and live on GitHub Pages, version 2 (the newest) with every section failed
//   Tin Kettle    a build the model stopped before any page: nothing is built
//   Cedar Cafe    the plain fixture's half-built site, saved with no end: the server closes it when it starts
// Its model never answers, so the build the last steps start keeps planning.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { studio } from './walkthrough-fixtures.mjs'

const vis = (page, sel, timeout = 10000) => page.locator(sel).first().waitFor({ state: 'visible', timeout })
const click = async (page, sel, timeout) => { await vis(page, sel, timeout); await page.locator(sel).first().click() }
const flat = t => String(t || '').replace(/\s+/g, ' ').trim()
const no = msg => { throw new Error(msg) }

const HOST = 'example.github.io'
const HTTP500 = 'cb/deepseek-v4.1-flash: HTTP 500 {"error":"no model here"}'

function seed({ runs, site, T0, rid }) {
  const R = { v1: rid(40), v2: rid(41), none: rid(42) }
  const at = n => T0 + n * 3600e3
  const pages = [['home', 'Harbor Light'], ['visit', 'Visit']]
  site(runs, R.v1, { brief: 'Harbor Light, a lighthouse museum on the quay', name: 'Harbor Light', t: at(40), pages })
  const write = (run, events) => { mkdirSync(join(runs, run), { recursive: true }); writeFileSync(join(runs, run, 'events.jsonl'), events.map(e => JSON.stringify({ run, ...e })).join('\n') + '\n') }
  // version 1 went out on GitHub Pages
  const v1 = readFileSync(join(runs, R.v1, 'events.jsonl'), 'utf8')
  writeFileSync(join(runs, R.v1, 'events.jsonl'), v1 + [{ type: 'publish:start', target: 'github' }, { type: 'publish:done', target: 'github', url: `https://${HOST}/harbor-light/`, repo: 'example/harbor-light', pages: 2, ms: 42000 }]
    .map((e, i) => JSON.stringify({ run: R.v1, t: at(40) + 20000 + i * 1000, ...e })).join('\n') + '\n')
  // version 2: planned, and the model answered nothing: every section failed, and the build ran to its end
  const t = at(41), roles = ['hero', 'features', 'footer']
  write(R.v2, [
    { type: 'run:start', t, brief: 'Harbor Light, a lighthouse museum on the quay, with opening hours', agents: [{ id: 'a0', name: 'Ada', color: '#d4d4d8' }, { id: 'a1', name: 'Bo', color: '#a1a1aa' }] },
    { type: 'theme', t: t + 10, name: 'Plain', direction: '', vars: { '--background': '#111111', '--foreground': '#eeeeee', '--primary': '#e4e4e7' } },
    ...pages.map(([id, title], index) => ({ type: 'page', t: t + 20 + index, id, title, purpose: '', index })),
    ...pages.flatMap(([page]) => roles.map((role, j) => ({ type: 'layer:plan', t: t + 30, page, id: role, role, height: j ? 520 : 760 }))),
    ...pages.flatMap(([page], i) => roles.map((role, j) => ({ type: 'layer:failed', t: t + 600 + (i * 3 + j) * 400, page, layer: role, agent: `a${j % 2}`, message: HTTP500 }))),
    { type: 'run:done', t: t + 10000, ms: 10000, planned: 6, done: 0, failed: 6, pages: 2 }
  ])
  // stopped by the model before any page
  write(R.none, [
    { type: 'run:start', t: at(42), brief: 'Tin Kettle, a tea room in an old station', agents: [{ id: 'a0', name: 'Ada', color: '#d4d4d8' }] },
    { type: 'error', t: at(42) + 500, where: 'planner', message: HTTP500 },
    { type: 'run:stopped', t: at(42) + 600, ms: 600, planned: 0, done: 0, failed: 0, pages: 0, stopped: true, reason: { code: 'model', message: "Stopped: the model didn't answer (no model here).", action: 'Try again, or pick another model in `hermes model`.' } }
  ])
  const file = join(runs, 'folders.json'), all = JSON.parse(readFileSync(file, 'utf8'))
  const proj = (r, name, made) => ({ runs: r, name, title: null, folder: null, trashed: null, made, own: true })
  all.projects[R.v1] = proj([R.v1, R.v2], 'Harbor Light', at(40))
  all.projects[R.none] = proj([R.none], 'Tin Kettle', at(42))
  writeFileSync(file, JSON.stringify(all))
  seed.R = R
}

// one Studio for these steps, kept on env until the last one ends it
async function cards(env) {
  if (env.cs) return env.cs
  let open
  const never = new Promise(r => { open = r })
  const s = await studio({ setup: seed, model: async () => { await never; return null } })
  await s.api('/api/setup', { seen: true })
  env.cs = { ...s, R: { ...seed.R }, end: open }
  return env.cs
}
function endCards(env) { try { env.cs?.end(); env.cs?.stop() } catch {} env.cs = null }

async function go(env, s, addr = '/', root = '.home') {
  await env.page.goto(s.BASE + addr)
  await vis(env.page, root, 15000)
  await env.wait(800)
}
const deck = async (env, s, run) => { await go(env, s, `/?version=${run}&room=deck`, '#viewport'); await env.wait(1200) }
// a project's card line on Projects, as written ("Website · Failed · Live · example.github.io")
const lineOf = async (page, title) => flat(await page.locator('.home .card', { hasText: title }).first().locator('.st').innerText())
const openPublish = async env => { await click(env.page, '#publish-btn'); await vis(env.page, '#pub-menu') }
const CARDS = 'Cards, the work chip and Publish read the one build state'

export const CARD_STEPS = [
  { id: 'c-live-failed', flow: CARDS, title: 'Projects: a site that is live and whose newest build failed says both; a build cut off by a restart reads Stopped', run: async env => {
    const s = await cards(env)
    await go(env, s)
    const line = await lineOf(env.page, 'Harbor Light')
    if (line !== `Website · Failed · Live · ${HOST}`) no(`the live project whose newest build failed reads "${line}"`)
    const cut = await lineOf(env.page, 'Cedar Cafe')
    if (cut !== 'Website · Stopped') no(`the build with no end reads "${cut}"`)
    const none = await lineOf(env.page, 'Tin Kettle')
    if (none !== 'Website · Stopped') no(`the build the model stopped before any page reads "${none}"`)
  }, settle: 1200 },
  { id: 'c-filter-states', flow: CARDS, title: 'The Filter menu lists Failed, Stopped and Live', run: async env => {
    await cards(env)
    await click(env.page, '.hm-filter')
    await vis(env.page, '.hm-menu [data-k="all"]')
    const labels = await env.page.locator('.hm-menu button').allInnerTexts()
    for (const want of ['Failed', 'Stopped', 'Live']) if (!labels.map(flat).includes(want)) no(`the Filter menu has no "${want}" (it lists ${labels.map(flat).join(', ')})`)
  } },
  { id: 'c-filter-live', flow: CARDS, title: 'Filter › Live: the project that is live is listed, whatever its newest build’s word', run: async env => {
    await cards(env)
    await click(env.page, '.hm-menu [data-k="s:Live"]')
    await env.wait(600)
    const titles = (await env.page.locator('.home .card .nm b').allInnerTexts()).map(flat)
    if (!titles.includes('Harbor Light')) no(`Filter › Live does not list the live project (it lists ${titles.join(', ') || 'nothing'})`)
    if (titles.includes('Cedar Cafe')) no('Filter › Live lists a project that was never published')
  }, after: async env => { await env.page.evaluate(() => { for (const k of Object.keys(localStorage)) if (/home\.filter/.test(k)) localStorage.removeItem(k) }).catch(() => {}) } },
  { id: 'c-closed-at-start', flow: CARDS, title: 'A build the server closed when it started (its file had no end): the deck says what is kept, with Resume', run: async env => {
    const s = await cards(env)
    // the one event the server wrote: run:stopped, reason `interrupted`
    const last = (await s.api(`/api/runs/${s.ids.mid}/events`)).at(-1)
    if (last?.type !== 'run:stopped' || last.reason?.code !== 'interrupted') no(`the build with no end was not closed at start: its last event is ${last?.type} ${JSON.stringify(last?.reason || null)}`)
    const state = (await s.api(`/api/runs/${s.ids.mid}/state`)).state
    if (state?.state !== 'halted' || state.next !== 'resume') no(`the closed build reads ${state?.state} with next ${state?.next}`)
    await deck(env, s, s.ids.mid)
    if (!(await env.page.locator('#brief').first().isVisible().catch(() => false))) await env.page.locator('.cosmos-chatbtn').first().click().catch(() => {})
    await env.page.locator('#feed').getByText(/This run stopped before it finished\. 5 of 9 sections are built and kept\./).last().waitFor({ state: 'visible', timeout: 12000 })
    if (!(await env.page.locator('#feed button', { hasText: 'Resume' }).last().isVisible().catch(() => false))) no('the closed build offers no Resume')
    const strip = flat(await env.page.locator('#status').first().innerText())
    if (!/Stopped/i.test(strip) || !/5\/9/.test(strip)) no(`the strip of the closed build reads "${strip}"`)
  }, settle: 1200 },
  { id: 'c-publish-part', flow: CARDS, title: 'The Publish menu of a build that is not whole: Website says how much of it goes live', run: async env => {
    const s = await cards(env)
    await deck(env, s, s.ids.mid)
    await openPublish(env)
    const why = flat(await env.page.locator('#pub-menu [data-pub="site"] .pub-why').innerText())
    if (why !== '5 of 9 sections') no(`Website says "${why}" for a build with 5 of 9 sections`)
    if (await env.page.locator('#pub-menu [data-pub="site"]').isDisabled()) no('Website can not be pressed, though sections stand')
  } },
  { id: 'c-publish-part-hosts', flow: CARDS, title: 'Publish › Website on that build: what goes live is said before a host is picked', run: async env => {
    await cards(env)
    await click(env.page, '#pub-menu [data-pub="site"]')
    await vis(env.page, '.publish-pop .popt', 12000)
    const says = flat(await env.page.locator('.publish-pop .pstate').first().innerText())
    if (!/Stopped/i.test(says) || !/5 of 9 sections/.test(says)) no(`the Publish dialog says "${says}" of a build with 5 of 9 sections`)
  }, settle: 900, after: async env => { await env.page.keyboard.press('Escape').catch(() => {}) } },
  { id: 'c-publish-none', flow: CARDS, title: 'The Publish menu of a build with nothing built: Website can not be pressed, and says why', run: async env => {
    const s = await cards(env)
    await deck(env, s, s.R.none)
    await openPublish(env)
    const site = env.page.locator('#pub-menu [data-pub="site"]')
    if (!(await site.isDisabled())) no('Website can be pressed with nothing built')
    const why = flat(await site.locator('.pub-why').innerText())
    if (why !== 'Nothing is built yet.') no(`Website gives the reason "${why}"`)
  } },
  { id: 'c-live-building', flow: CARDS, title: 'A next version of the live site starts (the model has not answered): the card says Building and stays Live, with an empty bar', run: async env => {
    const s = await cards(env)
    const r = await s.api('/api/run', { brief: 'Harbor Light, a lighthouse museum on the quay, with a page for school visits', project: s.R.v1, sure: true })
    if (!r?.run) no(`the build did not start: ${JSON.stringify(r).slice(0, 120)}`)
    s.run = r.run
    await env.wait(1500)
    await go(env, s)
    const line = await lineOf(env.page, 'Harbor Light')
    if (line !== `Website · Building · Live · ${HOST}`) no(`the live project with a build running reads "${line}"`)
  }, settle: 1200 },
  { id: 'c-chip-planning', flow: CARDS, title: 'That build in the Design deck: the strip and the top bar’s chip say the same (planning, nothing built of its own)', run: async env => {
    const s = await cards(env)
    await deck(env, s, s.run)
    await vis(env.page, '.topbar .work-chip')
    const state = (await s.api(`/api/runs/${s.run}/state`)).state
    const job = (await s.api('/api/work')).jobs.find(j => j.run === s.run)
    // the chip's number is the state's: this build's own sections, never the ones it was handed
    const want = state.state === 'building' && state.planned ? state.done / state.planned : 0
    if (!job || Math.abs((job.pct ?? -1) - want) > 0.001) no(`the chip is at ${job?.pct} while the build state is ${state.state} ${state.done}/${state.planned} (kept ${state.kept})`)
    if (job.stage !== (state.state === 'building' ? 'building pages' : 'planning')) no(`the chip says "${job.stage}" while the build state is ${state.state}`)
    const strip = flat(await env.page.locator('#status').first().innerText())
    if (state.state === 'planning' && !/Planning/i.test(strip)) no(`the strip reads "${strip}" while the build is planning`)
    const now = await env.page.locator('.topbar .work-chip .wk-bar').first().getAttribute('aria-valuenow')
    if (String(now) !== String(Math.round(want * 100))) no(`the chip's bar is at ${now}% while the strip reads "${strip}"`)
    await click(env.page, '.topbar .work-chip')
    await vis(env.page, '.wk-pop .wk-row')
    const row = flat(await env.page.locator('.wk-pop .wk-row').first().innerText())
    if (state.state === 'planning' && !/Site · planning/i.test(row)) no(`the chip's list reads "${row}" while the build is planning`)
  }, settle: 900, after: endCards }
]
