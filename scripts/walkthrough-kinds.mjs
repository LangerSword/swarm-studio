// The walkthrough's steps for the one state of an app, a game and a film (engine/kindstate.mjs;
// docs/ux/states/build.md, A1 to A7 and F1 to F7): what the Projects card, the Overview's artboards and the
// rooms say in the states no screen read before. Each step checks what is on the page against the state, and
// fails ("not reached") when the page says something else.
//
//   an app that is designed and not built    an App on its card and on the board, never a Website
//   a big game waiting after a slice         "Your turn" on its card, as in its room; never Building, then Stopped
//   an app build that was stopped            Stopped on its card, never Designed
//   a film that failed                       the reason and Try again in the Film room, Failed on the board
//   a film made with no Hermes               being made, or why not and the one thing to do; never the form again
//
// They run in a Studio of their own (scripts/walkthrough-fixtures.mjs `studio`, seeded here), ended by the last
// of the picked steps.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { studio } from './walkthrough-fixtures.mjs'

const FLOW = 'Apps, games and films: one state'
const vis = (page, sel, timeout = 8000) => page.locator(sel).first().waitFor({ state: 'visible', timeout })
const shown = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const textOf = (page, sel) => page.locator(sel).first().innerText().catch(() => '')
const no = why => { throw new Error(why) }
// the words are set in capitals by some styles: matched whatever their case, spaces as one
const has = (text, want) => String(text).replace(/\s+/g, ' ').toLowerCase().includes(want.toLowerCase())

const started = new Set()
process.on('exit', () => { for (const s of started) { try { s.stop() } catch {} } })

const HTTP500 = 'planner: cb/deepseek-v4.1-flash: HTTP 500 {"error":"no model here"}'
function seed({ runs, site, T0, rid }) {
  const K = { app: rid(60), paused: rid(61), stopped: rid(62), film: rid(63), filmRun: rid(64) }
  const at = n => T0 + n * 3600e3
  const add = (run, events, t0) => appendFileSync(join(runs, run, 'events.jsonl'), events.map((e, i) => JSON.stringify({ run, t: t0 + i * 4000, ...e })).join('\n') + '\n')
  const step = (kind, text, ok) => ({ type: 'app:step', step: { kind, text, ...(ok === undefined ? {} : { ok }) } })
  // an app that is designed and not built: its run says nothing of its kind, its words do, and it has no app event
  site(runs, K.app, { brief: 'Night Desk, an app where hotel porters log deliveries', name: 'Night Desk', t: at(60), pages: [['signin', 'Sign in'], ['log', 'The log']] })
  // a big game that built its second slice and waits for its person
  site(runs, K.paused, { brief: 'Kiln Keeper, a big game about a pottery town', name: 'Kiln Keeper', t: at(61), kind: 'game', pages: [], extra: [{ type: 'game:spec', spec: { title: 'Kiln Keeper', genre: 'town builder', pitch: 'Keep the kilns lit through winter', brand: { name: 'Kiln', vars: { '--background': '#111', '--foreground': '#eee' } } } }] })
  add(K.paused, [{ type: 'app:start', kind: 'game', fresh: true, ask: 'build the game' }, step('setup', 'the engine is ready'), step('setup', 'stage 1 of 5: the town square'), step('test', 'play test passed: the keeper walked', true), step('setup', 'stage 2 of 5: the first kiln'), step('test', 'play test passed: the kiln lit', true),
    { type: 'app:paused', slice: { i: 1, n: 5, name: 'The first kiln', play: true }, result: { turns: 4, files: 9, stages: [{ name: 'The town square' }, { name: 'The first kiln' }] }, ms: 300000 }], at(61) + 20000)
  // an app build the person stopped part way
  site(runs, K.stopped, { brief: 'Tool Loan, a lending shelf for one street', name: 'Tool Loan', t: at(62), pages: [['signin', 'Sign in'], ['shelf', 'The shelf']] })
  add(K.stopped, [{ type: 'app:start', kind: 'site', fresh: true, ask: 'make it a working app' }, step('setup', 'the engine is ready'), step('write', 'src/pages/Shelf.tsx'), { type: 'app:failed', message: 'stopped' }], at(62) + 20000)
  // a website whose film failed because the model did not answer
  site(runs, K.film, { brief: 'Quiet Loaf, a bakery that opens at four', name: 'Quiet Loaf', t: at(63), pages: [['home', 'Quiet Loaf']] })
  add(K.film, [{ type: 'video:start', model: 'planner', images: 0, style: 'prompt', prompt: 'A 20 second film about the first loaf', transition: 'wipe', refs: 0 }, { type: 'video:failed', message: HTTP500 }], at(63) + 20000)
  // a film made on its own (server/film.mjs: kind film, no pages) that failed
  mkdirSync(join(runs, K.filmRun))
  writeFileSync(join(runs, K.filmRun, 'events.jsonl'), [{ type: 'run:start', t: at(64), kind: 'film', brief: 'Dawn Shift, a 20 second film for a night bakery', title: 'Dawn Shift' }, { type: 'video:start', t: at(64) + 4000, model: 'planner', images: 0, style: 'prompt', prompt: 'the first loaf', transition: 'wipe', refs: 0 }, { type: 'video:failed', t: at(64) + 8000, message: HTTP500 }].map(e => JSON.stringify({ run: K.filmRun, ...e })).join('\n') + '\n')
  const f = JSON.parse(readFileSync(join(runs, 'folders.json'), 'utf8'))
  for (const [k, name] of Object.entries({ app: 'Night Desk', paused: 'Kiln Keeper', stopped: 'Tool Loan', film: 'Quiet Loaf', filmRun: 'Dawn Shift' })) f.projects[K[k]] = { runs: [K[k]], name, title: null, folder: null, trashed: null, made: at(60), own: true }
  writeFileSync(join(runs, 'folders.json'), JSON.stringify(f))
  seed.K = K
}
async function own(env, key = 'kinds', opts = { setup: seed }) {
  env.kx ||= {}
  if (!env.kx[key]) {
    const s = await studio(opts)
    started.add(s)
    await s.api('/api/setup', { seen: true })
    env.kx[key] = { ...s, K: seed.K }
  }
  return env.kx[key]
}
const end = (env, key) => { const s = env.kx?.[key]; if (s) { s.stop(); started.delete(s); env.kx[key] = null } }
async function go(env, s, addr = '/', root = '.home') {
  await env.page.goto(s.BASE + addr)
  await vis(env.page, root, 15000)
  await env.wait(900)
}
const state = async (s, run) => (await s.api(`/api/runs/${run}/state`))?.parts || {}
// a Projects card by its name: its state line ("App · Designed")
const cardLine = (env, name) => textOf(env.page, `.home .card[data-name="${name}"] .st`)
// the Film room six seconds after a press: it shows the film being made, or a reason with its one action; the
// empty form with no reason on screen is the defect (m-film-working)
async function filmTruth(env) {
  const { page } = env
  if (await shown(page, '.video-pop .vstage.err')) {
    const why = (await textOf(page, '.video-pop .vstage.err')).trim()
    if (!why) no('the film stopped and the room gives no reason')
    if (/HTTP \d{3}|\{"/.test(why)) no(`the room shows the raw error: ${why.slice(0, 80)}`)
    if (!(await shown(page, '.video-pop .vagain')) && !(await shown(page, '.video-pop .vsetup'))) no('the film stopped with a reason and no action')
    return 'failed'
  }
  if (await shown(page, '.video-pop .vbar')) return 'making'
  if (await shown(page, '.video-pop video')) return 'done'
  if (await shown(page, '.video-pop .vprompt')) no('the room shows the form again, with no reason on screen')
  return no('the Film room shows nothing of the film')
}

const LIST = [
  { id: 'k-projects', title: 'Projects: an unbuilt app is an App, a waiting game says Your turn, a stopped app build says Stopped, a failed film says Failed', run: async env => {
    const s = await own(env)
    await go(env, s)
    const text = await textOf(env.page, '.home')
    for (const [name, want] of [['Night Desk', 'App · Designed'], ['Kiln Keeper', 'Game · Your turn'], ['Tool Loan', 'App · Stopped'], ['Dawn Shift', 'Video · Failed'], ['Quiet Loaf', 'Website · Designed']]) {
      const line = await cardLine(env, name)
      if (!has(line || text, want)) no(`${name}'s card does not read "${want}" (it reads "${String(line).trim().slice(0, 60)}")`)
    }
    if (has(await cardLine(env, 'Night Desk'), 'Website')) no('an app that is designed and not built reads Website')
  }, settle: 800 },
  { id: 'k-ov-app-designed', title: 'The Overview of an app that is designed and not built: the App artboard is there, and says Designed', run: async env => {
    const s = await own(env)
    if ((await state(s, s.K.app)).app?.state !== 'designed') no('the server does not call this app designed')
    await go(env, s, `/?project=${s.K.app}&version=${s.K.app}`, '.pj-world')
    await vis(env.page, '.pj-world .ab[data-key="app"]', 8000).catch(() => no('an app that is not built has no App artboard'))
    if (!has(await textOf(env.page, '.pj-world .ab[data-key="app"]'), 'Designed')) no('the App artboard does not say the app is only designed')
  }, settle: 1500 },
  { id: 'k-app-designed-room', title: 'The App room of the same app: no app yet, and Build the app', run: async env => {
    const s = await own(env)
    await go(env, s, `/?version=${s.K.app}&room=app`, '#appview')
    await env.wait(1500)
    if (!has(await textOf(env.page, '.app-state'), 'no app yet')) no(`the pill reads "${(await textOf(env.page, '.app-state')).trim()}"`)
    if (!(await shown(env.page, '#appview [data-build]'))) no('the room offers no Build the app')
  }, settle: 1000 },
  { id: 'k-game-paused', title: 'A big game waiting after a slice: its room says your turn, as its card does', run: async env => {
    const s = await own(env)
    const g = (await state(s, s.K.paused)).game
    if (g?.state !== 'waiting') no(`the server calls this game ${g?.state}`)
    await go(env, s, `/?version=${s.K.paused}&room=game`, '#appview')
    await env.wait(1800)
    const pill = (await textOf(env.page, '.app-state')).trim()
    if (!has(pill, 'your turn')) no(`the pill reads "${pill}"`)
    if (/building|stopped/i.test(pill)) no(`a waiting game reads "${pill}"`)
  }, settle: 1500 },
  { id: 'k-app-stopped-room', title: 'An app build that was stopped: its room says Stopped and Go on, as its card says Stopped', run: async env => {
    const s = await own(env)
    await go(env, s, `/?version=${s.K.stopped}&room=app`, '#appview')
    await env.wait(1500)
    if (!has(await textOf(env.page, '.app-state'), 'stopped')) no(`the pill reads "${(await textOf(env.page, '.app-state')).trim()}"`)
  }, settle: 1000 },
  { id: 'k-film-failed', title: 'A film that failed: the Film room says why in plain words, what to do, and Try again', run: async env => {
    const s = await own(env)
    const f = (await state(s, s.K.film)).film
    if (f?.state !== 'failed' || f.next !== 'again') no(`the server calls this film ${f?.state}, next ${f?.next}`)
    await go(env, s, `/?version=${s.K.film}&room=video`, '.video-pop')
    await env.wait(1500)
    if ((await filmTruth(env)) !== 'failed') no('the room does not show the film as failed')
    const text = await textOf(env.page, '.video-pop')
    if (!has(text, "The model didn't answer (no model here).")) no(`the room does not say why: "${text.replace(/\s+/g, ' ').slice(0, 120)}"`)
    if (!has(text, 'Try again')) no('the room offers no Try again')
  }, settle: 800 },
  { id: 'k-ov-film-failed', title: 'The Overview of the same build: a Film artboard that says Failed', run: async env => {
    const s = await own(env)
    await go(env, s, `/?project=${s.K.film}&version=${s.K.film}`, '.pj-world')
    await vis(env.page, '.pj-world .ab[data-key^="film"]', 8000).catch(() => no('a film that failed leaves no sign on the Overview'))
    if (!has(await textOf(env.page, '.pj-world .ab[data-key^="film"]'), 'Failed')) no('the Film artboard does not say the film failed')
  }, settle: 1500 },
  { id: 'k-film-again', title: 'Try again pressed on the failed film (this Studio\'s model answers nothing): six seconds on', run: async env => {
    const s = await own(env)
    await go(env, s, `/?version=${s.K.film}&room=video`, '.video-pop')
    await env.wait(1200)
    await env.page.locator('.video-pop .vagain').first().click()
    await env.wait(6000)
    await filmTruth(env)
  }, settle: 800, after: async env => { const s = env.kx?.kinds; if (s) await s.api('/api/stop', { run: s.K.film }).catch(() => {}) } },
  { id: 'k-film-no-hermes', title: 'A film made with no Hermes: Make the film pressed, six seconds on', run: async env => {
    const s = await own(env, 'off', { noHermes: true })
    await go(env, s, `/?version=${s.ids.site2}&room=video`, '.video-pop')
    await env.wait(1200)
    if (await shown(env.page, '.video-pop .vprompt')) await env.page.locator('.video-pop .vprompt').first().fill('A 20 second film about tea after a night shift')
    await env.page.locator('.video-pop .vagain').first().click()
    await env.wait(6000)
    const got = await filmTruth(env)
    // what the page shows is what the server says of the film
    const f = (await state(s, s.ids.site2)).film
    if (got === 'making' && f?.state !== 'making') no(`the room shows a film being made and the server calls it ${f?.state}`)
    if (got === 'failed' && f?.state === 'making') no('the room shows a failed film and the server is still making it')
  }, settle: 800, after: async env => { const s = env.kx?.off; if (s) await s.api('/api/stop', { run: s.ids.site2 }).catch(() => {}) } }
]

// the last picked step that uses a Studio ends it (with --steps, the last of the picked ones)
const PICK = (i => (i > 0 ? String(process.argv[i + 1] || '').split(',') : null))(process.argv.indexOf('--steps'))
const picked = LIST.filter(s => !PICK || PICK.includes(s.id))
const lastMain = picked.findLast(s => s.id !== 'k-film-no-hermes')?.id
export const KIND_STEPS = LIST.map(st => ({ flow: FLOW, ...st, after: async env => { try { await st.after?.(env) } finally { if (st.id === lastMain) end(env, 'kinds'); if (st.id === 'k-film-no-hermes') end(env, 'off') } } }))
