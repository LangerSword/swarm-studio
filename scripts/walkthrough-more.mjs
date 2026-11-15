// More of the screen walkthrough (docs/ux/walkthrough): the screens and states scripts/walkthrough-steps.mjs
// and scripts/walkthrough-chat.mjs do not reach, so every screen can be redesigned from a picture of it.
// Same step shape; every id starts with `m-`. Each step is self-contained (it loads its own address), so
// `--steps m-…` works on any one of them.
//
// Besides the runner's own throwaway Studio these steps start three more, each only when a step needs it:
//   rich   seeded projects the default fixture has not: a Studio project, the game plan
//          (tests/fixtures/rank-juggler), failed and queued pictures, a stopped build, saved publishes, an app
//          being built and one shipped, games, films. Its model fails unless a step holds it.
//   live   a Studio whose model never answers, so a build started there keeps running: the work chip, Stop,
//          "Planning the pages…".
//   empty  a Studio with no projects at all.
// A step whose `flow` says "stubbed" answers one named request in the browser (an outside account the
// throwaway Studio cannot have); everything else on the screen is the Studio's own. A state that could not
// be reached throws its reason, and the runner records it as not reached.
//
//   WALK_PLAN_FILES=<folder>   the plan's sketch sheets (as for scripts/walkthrough-chat.mjs)
//   ffmpeg on the PATH         makes the small clip a finished film and a play test show; without it those
//                              steps say so
import { execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { studio } from './walkthrough-fixtures.mjs'

const FIX = fileURLToPath(new URL('../tests/fixtures/rank-juggler/', import.meta.url))
const PLAN = 'p-44c1061860'
const STUDIO = 's-walk1'
const MAC = process.platform === 'darwin'

// ---------- the page
const vis = (page, sel, timeout = 8000) => page.locator(sel).first().waitFor({ state: 'visible', timeout })
const click = async (page, sel, timeout) => { await vis(page, sel, timeout); await page.locator(sel).first().click() }
// clicks it only if it is there (a phone's sheet buttons)
const tap = async (page, sel) => { const l = page.locator(sel).first(); if (await l.isVisible().catch(() => false)) await l.click({ timeout: 2000 }).catch(() => {}) }
const shown = (page, sel) => page.locator(sel).first().isVisible().catch(() => false)
const no = why => { throw new Error(why) }
const pathIs = p => url => new URL(url).pathname === p

// ---------- the Studios
const started = new Set()
process.on('exit', () => { for (const s of started) { try { s.stop() } catch {} } })
const seen = s => s.api('/api/setup', { seen: true }).catch(() => {})
async function own(env, name, make) {
  env.mx ||= {}
  if (!env.mx[name]) {
    const s = await make()
    started.add(s)
    await seen(s)
    env.mx[name] = s
  }
  return env.mx[name]
}
const end = (env, name) => { const s = env.mx?.[name]; if (s) { s.end?.(); s.stop(); started.delete(s); env.mx[name] = null } }
// the runner's own Studio, with Setup already seen
async function main(env) { if (!env.mSeen) { await seen(env); env.mSeen = true } return env }

async function go(env, s, addr = '/', root = '.home') {
  await env.page.goto(s.BASE + addr)
  await vis(env.page, root, 15000)
  await env.wait(700)
}
// the Projects sidebar: on a phone it is a drawer behind ☰
async function side(env, sel) {
  const { page } = env
  if (await shown(page, '.hm-burger')) { await page.locator('.hm-burger').first().click(); await env.wait(300) }
  await click(page, sel)
}
// on a phone the chat is a sheet over the lower half: fold it so the screen under it shows
// the chat when it is folded away to its pill
const chat = async env => { await tap(env.page, '.cosmos-chatbtn'); await env.wait(400) }
const fold = async env => { if (env.phone) { await tap(env.page, '.side .tabs .cosmos-fold'); await env.wait(300) } }

// a request kept waiting (the loading states), let go by `clean`
async function hold(env, match) {
  let release
  const gate = new Promise(r => { release = r })
  env.mHeld = release
  await env.page.route(match, async route => { await gate; await route.continue().catch(() => {}) })
}
// one request answered in the browser (the "stubbed" flows)
const answer = (env, match, patch) => env.page.route(match, async route => {
  let j = {}
  try { const r = await route.fetch(); j = await r.json() } catch {}
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(patch(j)) }).catch(() => {})
})
async function clean(env) {
  env.mHeld?.(); env.mHeld = null
  await env.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
}

// ---------- seeding
// a flat picture, so a seeded reference, asset or thumbnail is a real file
function png(w, h, [r, g, b]) {
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b }
  const raw = Buffer.concat(Array.from({ length: h }, (_, y) => { const c = Buffer.from(row); const k = 1 - y / h * 0.35; for (let i = 1; i < c.length; i++) c[i] = c[i] * k | 0; return c }))
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0); return Buffer.concat([len, body, crc]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
// a three second clip of one flat colour, when this computer has ffmpeg; false when it has not
function clip(file, args = []) {
  try { execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x26262b:s=640x360:d=3:r=24', ...args, file], { stdio: 'ignore', timeout: 30000 }); return existsSync(file) } catch { return false }
}
const { sourceSig = null } = await import('../engine/appjob.mjs').catch(() => ({}))

const BUILT_PAGE = (title, line) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;background:#151517;color:#eee;font:16px system-ui;display:grid;place-items:center;height:100vh"><main style="text-align:center"><h1>${title}</h1><p>${line}</p></main>`
// a built app or game on disk, served as it stands (engine/appjob.mjs serves a build whose stamp matches)
function built(runs, run, title, line) {
  const dir = join(runs, run, 'app')
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'walk-fixture', private: true, version: '0.0.0', scripts: {} }))
  writeFileSync(join(dir, 'index.html'), BUILT_PAGE(title, line))
  writeFileSync(join(dir, 'dist', 'index.html'), BUILT_PAGE(title, line))
  if (sourceSig) writeFileSync(join(dir, '.swarm-built.json'), JSON.stringify({ sig: sourceSig(dir), server: false, t: Date.now() }))
}

function seedRich({ runs, site, T0, rid }) {
  const data = dirname(runs)
  const R = { art: rid(10), stopped: rid(12), bare: rid(13), pub: rid(14), wasLive: rid(15), pubFailed: rid(16), pubRec: rid(17), critic: rid(18), ship: rid(19), appWork: rid(20), gameWork: rid(21), gamePlay: rid(22), filmDone: rid(23), filmWork: rid(24), talked: rid(25) }
  const at = n => T0 + n * 3600e3
  // what happened after a build ended (a publish, a review, an app build) goes after its run:done
  const add = (run, events, t0 = at(40)) => appendFileSync(join(runs, run, 'events.jsonl'), events.map((e, i) => JSON.stringify({ run, t: t0 + i * 4000, ...e })).join('\n') + '\n')
  const names = {}
  const make = (key, name, brief, opts = {}) => { names[R[key]] = name; site(runs, R[key], { brief, name, t: at(10 + Object.keys(names).length), pages: [['home', name], ['about', 'About']], ...opts }) }

  // pictures: one still queued (the live line says who is painting), one that failed (Try again)
  make('art', 'Night Kiln', 'Night Kiln, a pottery studio that fires at night', { extra: [
    { type: 'image:queued', page: 'home', layer: 'hero', gen: 'a kiln glowing at night' },
    { type: 'image:queued', page: 'home', layer: 'features', gen: 'hands shaping clay' },
    { type: 'image:failed', page: 'home', layer: 'features', gen: 'hands shaping clay', message: 'no image model' }
  ] })
  make('stopped', 'Salt Road', 'Salt Road, a walking tour of an old salt route', { done: false, extra: [{ type: 'run:stopped', stopped: true, reason: { code: 'timeout', message: 'The model took too long.', action: 'Try again.' } }] })
  make('bare', 'Blank Slate', 'Blank Slate, a site that has not been planned yet', { pages: [], done: false })
  make('talked', 'Harbor Books', 'Harbor Books, a second-hand bookshop by the harbour', { extra: [
    { type: 'comment', text: 'Make the hero darker', target: 'home/hero' },
    { type: 'comment:take', text: 'Make the hero darker', page: 'home', layer: 'hero', role: 'hero', agent: 'a0', reply: 'On it, making the hero darker.' }
  ] })
  // publish: thumbnails to pick from, a site that is live, one that failed, and one whose publish replays
  make('pub', 'Fern & Stone', 'Fern & Stone, a plant shop with a stone yard')
  mkdirSync(join(runs, R.pub, 'img'), { recursive: true })
  const shades = [[196, 122, 74], [88, 96, 84], [150, 138, 120], [60, 62, 68]]
  shades.forEach((c, i) => writeFileSync(join(runs, R.pub, 'img', `${i}.png`), png(480, 270, c)))
  add(R.pub, shades.map((_, i) => ({ type: 'image', page: 'home', layer: ['hero', 'features', 'footer', 'hero'][i], src: `/img/${R.pub}/${i}.png` })), at(14))
  make('wasLive', 'Quiet Hours', 'Quiet Hours, a library of sleep sounds')
  add(R.wasLive, [{ type: 'publish:start', target: 'github' }, { type: 'publish:done', target: 'github', url: 'https://example.github.io/quiet-hours/', pages: 2, ms: 42000 }])
  make('pubFailed', 'Low Tide', 'Low Tide, a tide table for one small bay')
  add(R.pubFailed, [{ type: 'publish:start', target: 'vercel' }, { type: 'publish:failed', target: 'vercel', message: 'The host refused the token.' }])
  make('pubRec', 'Paper Kite', 'Paper Kite, a kite workshop for children')
  add(R.pubRec, [{ type: 'publish:start', target: 'github' }, ...['export', 'repo', 'push', 'pages'].map(stage => ({ type: 'publish:stage', target: 'github', stage })), { type: 'publish:done', target: 'github', url: 'https://example.github.io/paper-kite/', pages: 2, ms: 42000 }])
  make('critic', 'Slow Bread', 'Slow Bread, a bakery that bakes once a day')
  add(R.critic, [{ type: 'review:start', page: 'home' }, { type: 'review:issue', page: 'home', layer: 'hero', agent: 'a1', problem: 'The heading is hard to read on the picture', fix: 'Darken the picture behind it' }, { type: 'review:issue', page: 'home', layer: 'features', agent: 'a0', problem: 'Three cards say the same thing', fix: 'Give each card its own point' }])

  // an app that shipped (with its launch kit), and one the crew is still building: its start names a
  // process that is alive (this one), which is how the Studio knows a build is going on elsewhere
  const steps = list => list.map(([kind, text, ok]) => ({ type: 'app:step', step: { kind, text, ...(ok === undefined ? {} : { ok }) } }))
  const map = { t: at(30), plan: { screens: [{ id: 'signin', name: 'Sign in', path: '/signin', next: ['board'] }, { id: 'board', name: 'Shift board', path: '/', next: ['swap'] }, { id: 'swap', name: 'Swap a shift', path: '/swap', next: [] }], flow: ['signin -> board', 'board -> swap'], data: [{ name: 'shifts', fields: ['day', 'ward', 'nurse'] }, { name: 'swaps', fields: ['shift', 'from', 'to', 'state'] }] } }
  make('ship', 'Ward Swap', 'Ward Swap, an app where nurses swap shifts', { kind: 'app', pages: [['signin', 'Sign in'], ['board', 'Shift board']] })
  writeFileSync(join(runs, R.ship, 'app-plan.json'), JSON.stringify(map))
  built(runs, R.ship, 'Ward Swap', 'The shift board')
  const film = dir => { mkdirSync(dir, { recursive: true }); const ok = clip(join(dir, 'promo.mp4'), ['-pix_fmt', 'yuv420p']); if (ok) writeFileSync(join(dir, 'promo.poster.jpg'), png(640, 360, [70, 70, 78])); return ok }
  const shipFilm = film(join(runs, R.ship, 'video'))
  add(R.ship, [
    { type: 'app:start', kind: 'app', fresh: true, ask: 'build' },
    ...steps([['setup', 'the engine is ready'], ['write', 'src/pages/Board.tsx'], ['write', 'server/routes/api/swaps.post.ts'], ['test', 'the app builds', true], ['gate', 'sign-in works', true]]),
    { type: 'app:done', result: { turns: 6, files: 14, gatesPassed: 3 }, ms: 420000 },
    ...(shipFilm ? [{ type: 'video:start', prompt: 'A 20 second promo' }, { type: 'video:done', src: `/video/${R.ship}/promo.mp4`, file: join(runs, R.ship, 'video', 'promo.mp4'), seconds: 3, ms: 90000 }] : []),
    { type: 'auto', state: 'working', t0: at(40), prompt: 'Ward Swap, an app where nurses swap shifts', steps: [{ id: 'design', label: 'Design', state: 'done', ms: 60000 }, { id: 'app', label: 'App', state: 'done', ms: 420000 }, { id: 'review', label: 'Review', state: 'working' }] },
    { type: 'auto', state: 'done', t0: at(40), ms: 600000, prompt: 'Ward Swap, an app where nurses swap shifts', url: 'https://ward-swap.example.app', steps: [{ id: 'design', label: 'Design', state: 'done', ms: 60000 }, { id: 'app', label: 'App', state: 'done', ms: 420000 }, { id: 'review', label: 'Review', state: 'done', ms: 30000 }] }
  ])
  make('appWork', 'Tool Shed', 'Tool Shed, an app for lending tools on one street', { kind: 'app', pages: [['signin', 'Sign in'], ['shelf', 'The shelf']] })
  writeFileSync(join(runs, R.appWork, 'app-plan.json'), JSON.stringify(map))
  add(R.appWork, [{ type: 'app:start', kind: 'app', fresh: true, ask: 'build', pid: process.pid }, ...steps([['setup', 'the engine is ready'], ['think', 'the shelf first, then lending'], ['write', 'src/pages/Shelf.tsx'], ['write', 'src/components/ToolCard.tsx'], ['turn', 'turn 2 of 6'], ['write', 'server/routes/api/loans.post.ts'], ['test', 'the app builds', true]])])

  // games: one being built (its wall and Map, a play test that never started), one built and playable
  const spec = { title: 'Lantern Run', genre: 'platformer', pitch: 'Carry a lantern through a night market', view: 'side', hero: 'a lantern carrier', loop: 'run, jump, keep the flame', brand: { name: 'Lantern', vars: { '--background': '#111', '--foreground': '#eee' } } }
  make('gameWork', 'Lantern Dash', 'Lantern Dash, a small platformer through a night market', { kind: 'game', pages: [['home', 'Lantern Dash']], extra: [{ type: 'game:spec', spec: { ...spec, title: 'Lantern Dash' } }] })
  mkdirSync(join(runs, R.gameWork, 'img'), { recursive: true })
  const play = clip(join(runs, R.gameWork, 'img', 'playtest-1.webm'))
  if (play) writeFileSync(join(runs, R.gameWork, 'img', 'playtest-1.poster.jpg'), png(640, 360, [40, 44, 60]))
  add(R.gameWork, [{ type: 'app:start', kind: 'game', fresh: true, ask: 'build', pid: process.pid }, ...steps([['setup', 'the engine is ready'], ['write', 'src/game/player.ts'], ['write', 'src/game/market.ts'], ['test', 'the game builds', true]]),
    { type: 'app:step', step: play ? { kind: 'test', text: 'play test passed: the hero ran and jumped', ok: true, clip: `/img/${R.gameWork}/playtest-1.webm`, keys: [{ t: 400, k: 'ArrowRight' }, { t: 1200, k: 'Space' }] } : { kind: 'test', text: 'play test: the game did not start', ok: false, started: false } }])
  make('gamePlay', 'Lantern Leap', 'Lantern Leap, a small platformer over market roofs', { kind: 'game', pages: [['home', 'Lantern Leap']], extra: [{ type: 'game:spec', spec: { ...spec, title: 'Lantern Leap' } }] })
  built(runs, R.gamePlay, 'Lantern Leap', 'Press space to jump')
  add(R.gamePlay, [{ type: 'app:start', kind: 'game', fresh: true, ask: 'build' }, ...steps([['write', 'src/game/player.ts'], ['test', 'play test passed: the hero ran and jumped', true]]), { type: 'app:done', result: { turns: 4, files: 9, gatesPassed: 2 }, ms: 300000 }])

  // films: one that worked, and one caught at its storyboard
  const story = { title: 'River Hours', pace: 'slow, warm', music: { bpm: 84 }, scenes: [{ kind: 'title', headline: 'River Hours', seconds: 4, layer: 'type', camera: 'still' }, { kind: 'photo', headline: 'Coffee by the water', seconds: 6, layer: 'photo', camera: 'push in' }, { kind: 'photo', headline: 'Open from six', seconds: 6, layer: 'photo', camera: 'pan' }, { kind: 'end', headline: 'Come by', seconds: 4, layer: 'type', camera: 'still' }] }
  make('filmDone', 'River Mornings', 'River Mornings, a 20 second film for a riverside cafe', { kind: 'video', pages: [['home', 'River Mornings']] })
  const gotFilm = film(join(runs, R.filmDone, 'video'))
  add(R.filmDone, [{ type: 'video:start', prompt: 'A 20 second film for a riverside cafe' }, { type: 'video:story', ...story }, { type: 'video:progress', pct: 100, stage: 'mixing' }, ...(gotFilm ? [{ type: 'video:done', src: `/video/${R.filmDone}/promo.mp4`, file: join(runs, R.filmDone, 'video', 'promo.mp4'), seconds: 3, ms: 90000 }] : [])])
  make('filmWork', 'River Evenings', 'River Evenings, a 20 second film for a riverside cafe', { kind: 'video', pages: [['home', 'River Evenings']] })
  add(R.filmWork, [{ type: 'video:start', prompt: 'A 20 second film for a riverside cafe' }, { type: 'video:story', ...story, title: 'River Evenings' }, { type: 'video:progress', pct: 40, stage: 'storyboard' }])

  // a Studio project before its first build (spec 37): its brand locked, one reference, one asset, three pages
  const made = at(50)
  const P = join(data, 'projects', STUDIO)
  mkdirSync(join(P, 'refs'), { recursive: true }); mkdirSync(join(P, 'assets'), { recursive: true })
  writeFileSync(join(P, 'studio.json'), JSON.stringify({ v: 1, kind: 'site', idea: 'A website for a tiny ramen bar with eight seats', mode: 'studio', depth: 'light', chat: null, steps: { brand: 'done', references: 'done', assets: 'done', plan: 'done' }, start: 'brand', kit: { pages: ['Home', 'Menu', 'Visit'], pictures: 'drawn' }, proposal: null, locked: null, made }))
  writeFileSync(join(P, 'brand.json'), JSON.stringify({ palettes: [{ id: 'p1', bg: '#1b1a17', text: '#f3eee4', accent: '#d9622b', link: '#e8a33d' }], types: [{ id: 't1', heading: 'Fraunces', body: 'Inter' }], pick: { palette: 'p1', type: 't1' }, lockedAt: made }))
  writeFileSync(join(P, 'refs', 'mood.png'), png(800, 600, [150, 84, 52]))
  writeFileSync(join(P, 'refs', 'index.json'), JSON.stringify([{ id: 'rwalk1', kind: 'image', name: 'mood.png', file: 'mood.png', url: null, w: 800, h: 600, source: 'upload', use: '', from: '', read: '', added: made, removed: null }]))
  writeFileSync(join(P, 'assets', 'logo.png'), png(256, 256, [217, 98, 43]))
  writeFileSync(join(P, 'assets', 'index.json'), JSON.stringify([{ id: 'awalk1', kind: 'image', name: 'logo.png', file: 'logo.png', w: 256, h: 256, source: 'upload', role: 'logo', added: made, removed: null }]))

  const f = JSON.parse(readFileSync(join(runs, 'folders.json'), 'utf8'))
  for (const [run, name] of Object.entries(names)) f.projects[run] = { runs: [run], name, title: null, folder: null, trashed: null, made: Date.parse(run.replace(/T(\d+)-(\d+)-(\d+)-(\d+)Z/, 'T$1:$2:$3.$4Z')) || made, own: true }
  f.projects[STUDIO] = { runs: [], name: 'Ramen Bar', title: null, folder: null, trashed: null, made, own: true, studio: 'site' }
  writeFileSync(join(runs, 'folders.json'), JSON.stringify(f))

  // the game plan and its chat, as scripts/walkthrough-chat.mjs seeds them
  cpSync(FIX, data, { recursive: true })
  const pics = process.env.WALK_PLAN_FILES
  if (pics && existsSync(pics)) { mkdirSync(join(data, 'plans', PLAN), { recursive: true }); cpSync(pics, join(data, 'plans', PLAN), { recursive: true }) }
  return { R, shipFilm, gotFilm, play }
}

async function rich(env) {
  return own(env, 'rich', async () => {
    const ctl = { hold: null }
    let seeded = null
    const s = await studio({ setup: a => { seeded = seedRich(a) }, model: async () => { if (ctl.hold) await ctl.hold; return null } })
    return { ...s, ...seeded, ctl, end: () => ctl.release?.() }
  })
}
async function empty(env) {
  return own(env, 'empty', () => studio({ setup: ({ runs }) => {
    const had = JSON.parse(readFileSync(join(runs, 'folders.json'), 'utf8')).projects
    for (const p of Object.values(had)) for (const run of p.runs) rmSync(join(runs, run), { recursive: true, force: true })
    writeFileSync(join(runs, 'folders.json'), JSON.stringify({ v: 2, folders: [], projects: {} }))
  } }))
}
// the Studio where a build is going on: its model never answers, so the planner keeps planning
async function live(env) {
  const s = await own(env, 'live', async () => {
    let open
    const never = new Promise(r => { open = r })
    const st = await studio({ model: async () => { await never; return null } })
    return { ...st, end: open }
  })
  const jobs = (await s.api('/api/work').catch(() => null))?.jobs || []
  if (!jobs.length) {
    const r = await s.api('/api/run', { brief: 'Alpha Tea, a tea subscription for night-shift workers, with a journal', project: s.ids.site, sure: true })
    if (!r?.run) no(`the build did not start: ${JSON.stringify(r).slice(0, 120)}`)
    s.run = r.run
    await env.wait(1500)
  }
  return s
}

// ---------- shared moves
const home = async env => { const s = await main(env); await go(env, s); return s }
async function setupOn(env, ...at) {
  await home(env)
  await env.page.evaluate(a => window.SwarmSetup.open(...a), at)
  await vis(env.page, '.ui-dialog.su')
}
async function settings(env, group) {
  await home(env)
  await side(env, '.hm-who')
  await click(env.page, '.hm-menu [data-k="settings"]')
  await vis(env.page, '.ui-dialog.set')
  if (group) await click(env.page, `.set-row[data-k="${group}"]`)
}
async function makeText(env, text, kind) {
  const { page } = env
  await click(page, '.hm-kind'); await click(page, `.hm-menu [data-k="${kind}"]`)
  await page.locator('.home input').first().fill(text)
  await page.locator('.hm-make').first().click()
}
// Make on the rich Studio (what it starts stays out of the runner's own)
async function makeMenu(env, text, kind) {
  const s = await rich(env)
  await go(env, s)
  await makeText(env, text, kind)
  await vis(env.page, '.hm-menu [data-k="now"]')
  await vis(env.page, '.hm-menu [data-k="studio"]')
}
const overviewOf = (env, s, id) => go(env, s, `/?project=${id}&version=${id}`, '.project:not(.plan) .pj-world')
const deckOf = (env, s, run) => go(env, s, `/?version=${run}&room=deck`, '#viewport')
async function scaffold(env, step) {
  const s = await rich(env)
  await go(env, s, `/?room=studio&project=${STUDIO}${step ? `&step=${step}` : ''}`, '.project.scaffold .sc-row')
  await vis(env.page, `.project.scaffold .pj-sec[data-sec="${step || 'brand'}"]`)
  await fold(env)
  return s
}
async function board(env) {
  const s = await rich(env)
  await go(env, s, `/?room=plan&plan=${PLAN}`, '.project.plan [data-sec="cards"]')
  await fold(env)
  return s
}
// a card on the scaffold's board; on a phone it is picked from Layers (the board opens off its cards there)
async function card(env, key, name) {
  if (!env.phone) return click(env.page, `.project.scaffold [data-key="${key}"]`)
  await click(env.page, '.sc-layers-btn')
  await env.page.locator('.project.scaffold .pj-side').getByText(name, { exact: true }).first().click()
  await env.wait(400)
  if (await shown(env.page, '.scaffold.files-on .sc-layers-btn')) await tap(env.page, '.sc-layers-btn')
}
// the Overview's chat is its one text box: open on a desk, a sheet behind the dock's Chat tool on a phone
async function ovChat(env) { if (!(await shown(env.page, '#brief'))) await click(env.page, '.pj-dock [data-tool="comment"]'); await vis(env.page, '#brief') }
const insp = (page, root = '.project') => vis(page, `${root} .pj-insp:not([hidden])`)
// a page picked on the Overview, then one of its sections in the inspector
async function section(env) {
  const s = await main(env)
  await overviewOf(env, s, s.ids.site)
  const { page } = env
  await page.locator('.pj-world .ab[data-key="page:home"]').first().click()
  await insp(page)
  await click(page, '.pj-insp .pj-ly[data-layer="home/hero"]', 10000)
  await vis(page, '.pj-insp .pj-back')
}
async function publishPop(env, run) {
  const s = await rich(env)
  await deckOf(env, s, run)
  await click(env.page, '#publish-btn')
  await vis(env.page, '#pub-menu')
  return s
}
async function appRoom(env, run, root = '#appview') {
  const s = await rich(env)
  await go(env, s, `/?version=${run}&room=app`, root)
  await fold(env)
  return s
}
// The launch kit opens from an Auto run's summary card, and the classic Studio hides the Auto panel
// (web/studio.css), so the one way left to the card is a replay of a saved Auto run: it shows when the
// replayed run ends. These steps follow one another on the same page; one run alone replays first.
async function summary(env) {
  const s = await rich(env)
  if (await shown(env.page, '.show-sum')) return s
  await go(env, s, `/?replay=${s.R.ship}`, '#viewport')
  await vis(env.page, '.show-sum', 20000)
  return s
}
async function kit(env) {
  if (await shown(env.page, '.launch-pop')) return rich(env)
  const s = await summary(env)
  await click(env.page, '.show-sum .ss-launch')
  await vis(env.page, '.launch-pop')
  return s
}

const gh = env => env.page.route(pathIs('/api/github/owner'), route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GH) }))
const SETUP = 'First open', PROJ = 'Projects', MAKE = 'Make', STU = 'Studio', PLANB = 'Plan board', OV = 'Overview', DECK = 'Design deck', PUB = 'Publish', ROOMS = 'Rooms'
const GH = { login: 'ada-example', owner: 'alpha-tea-co', orgs: [{ login: 'alpha-tea-co', can: true, why: '' }, { login: 'night-shift-club', can: false, why: 'Members cannot create repositories there' }], error: null }

const LIST = [
  // ---------- Setup: the rows after Account, and finished
  { id: 'm-setup-rest', flow: SETUP, title: 'Setup opened again from the user menu (a model that fails opens its row)', run: env => setupOn(env) },
  { id: 'm-setup-pictures', flow: SETUP, title: 'Setup: the Pictures row', run: async env => { await setupOn(env, 'pictures'); await vis(env.page, '.su-body [data-pic]') }, settle: 1500 },
  { id: 'm-setup-parts', flow: SETUP, title: 'Setup: the Parts row', run: async env => { await setupOn(env, 'parts'); await vis(env.page, '.su-pgroups') }, settle: 2500 },
  { id: 'm-setup-parts-group', flow: SETUP, title: 'Setup › Parts: a group open (Every build)', run: async env => { await setupOn(env, 'parts', 'every'); await vis(env.page, '.su-parts .su-pp') }, settle: 2500 },
  { id: 'm-setup-part', flow: SETUP, title: 'Setup › Parts: a part open (Planner), its fix', run: async env => { await setupOn(env, 'parts', 'every', 'planner'); await vis(env.page, '.su-pbody') }, settle: 2500 },
  { id: 'm-setup-part-app', flow: SETUP, title: 'Setup › Parts: the App group', run: async env => { await setupOn(env, 'parts', 'app'); await vis(env.page, '.su-parts .su-pp') }, settle: 2500 },
  { id: 'm-setup-done', flow: SETUP, title: 'Setup finished: Start pressed', run: async env => { await setupOn(env); await click(env.page, '.su-start'); await env.page.locator('.ui-dialog.su').first().waitFor({ state: 'hidden', timeout: 5000 }) } },

  // ---------- Projects
  // Settings › You asks GitHub who is signed in on this computer (the real `gh`), so these three answer it in the
  // browser with a made-up account: no real login or organization is photographed
  { id: 'm-settings-you', flow: `${PROJ} (GitHub answer stubbed)`, title: 'Settings › You', run: async env => { await gh(env); await settings(env, 'you'); await vis(env.page, '.set-row[data-k="feed"]'); await vis(env.page, '.set-row[data-k="github"]') }, settle: 1200 },
  { id: 'm-settings-you-goes', flow: `${PROJ} (GitHub answer stubbed)`, title: 'Settings › You › Swarm Feed: where its data goes', run: async env => { await gh(env); await settings(env, 'you'); await click(env.page, '.set-row[data-k="feed"]'); await vis(env.page, '.set-goes:not([hidden])') }, settle: 1200 },
  { id: 'm-settings-github', flow: `${PROJ} (GitHub answer stubbed)`, title: 'Settings › You › GitHub: the account and its organizations', run: async env => { await gh(env); await settings(env, 'you'); await click(env.page, '.set-row[data-k="github"]'); await vis(env.page, '.set-radios [data-owner]') } },
  { id: 'm-settings-lite', flow: PROJ, title: 'Settings › Lite mode', run: async env => { await settings(env, 'lite'); await vis(env.page, '.set-lite') }, settle: 1200 },
  { id: 'm-settings-background', flow: PROJ, title: 'Settings › Background', run: async env => { await settings(env, 'stops'); await vis(env.page, '.set-stop') }, settle: 1200 },
  { id: 'm-settings-data', flow: PROJ, title: 'Settings › Data', run: async env => { await settings(env, 'data'); await vis(env.page, '.set-data') } },
  { id: 'm-stack', flow: PROJ, title: 'A stack opened: Version cards and Back', run: async env => { await home(env); await env.page.locator('.card[data-id]', { hasText: 'Alpha Tea' }).first().click(); await vis(env.page, '.hm-bar .hm-back'); await vis(env.page, '.card[data-id] >> text=Version 2') } },
  { id: 'm-selection', flow: PROJ, title: 'The selection bar (two picked)', run: async env => {
    await home(env); await side(env, '.hm-nav [data-v="all"]')
    const cards = env.page.locator('.hm-body .card[data-id]')
    await cards.nth(0).click({ modifiers: [MAC ? 'Meta' : 'Control'] }); await cards.nth(1).click({ modifiers: [MAC ? 'Meta' : 'Control'] })
    await vis(env.page, '.hm-selbar:not([hidden])')
  } },
  { id: 'm-selection-move', flow: PROJ, title: 'The selection bar: Move to', run: async env => { await click(env.page, '.hm-selbar [data-bulk="move"]'); await vis(env.page, '.hm-menu') } },
  { id: 'm-filter', flow: PROJ, title: 'The Filter menu', run: async env => { await home(env); await click(env.page, '.hm-filter'); await vis(env.page, '.hm-menu [data-k="all"]') } },
  { id: 'm-sort', flow: PROJ, title: 'The Sort menu', run: async env => { await home(env); await click(env.page, '.hm-sort'); await vis(env.page, '.hm-menu [data-k="name"]') } },
  { id: 'm-undo', flow: PROJ, title: 'Delete on a card: the toast with Undo', run: async env => {
    await home(env); await side(env, '.hm-nav [data-v="all"]')
    const card = env.page.locator('.card[data-id]', { hasText: 'Cedar Cafe' }).first()
    if (env.phone) { await card.click({ button: 'right' }); await click(env.page, '.hm-menu [data-k="trash"]') } else { await card.hover(); await card.locator('.acts [data-act="trash"]').click() }
    await vis(env.page, '.hm-toast >> text=Undo')
  }, settle: 400, after: env => env.api('/api/projects', { op: 'restore', ids: [env.ids.mid] }) },
  { id: 'm-loading', flow: PROJ, title: 'Projects while it loads: the waiting cards', run: async env => { const s = await main(env); await hold(env, pathIs('/api/projects')); await env.page.goto(s.BASE + '/'); await vis(env.page, '.hm-body .card.wait-in') } },
  { id: 'm-assets-loading', flow: PROJ, title: 'Assets while it loads', run: async env => { await home(env); await hold(env, pathIs('/api/assets')); await side(env, '.hm-nav [data-v="assets"]'); await vis(env.page, '.hm-body .card.wait-in') } },
  ...[['recent', 'Recent'], ['all', 'All projects'], ['chats', 'Chats'], ['assets', 'Assets'], ['trash', 'Trash']].map(([v, name]) => ({ id: `m-empty-${v}`, flow: `${PROJ} (a Studio with no projects)`, uses: 'empty', title: `${name}, empty`, run: async env => { const s = await empty(env); await go(env, s); await side(env, `.hm-nav [data-v="${v}"]`); await vis(env.page, '.hm-none') }, settle: 900 })),

  // ---------- Make
  ...[['site', 'Website', 'A site for a bike repair shop that also sells coffee'], ['app', 'App', 'An app where neighbours lend each other tools and track returns'], ['game', 'Game', 'A platformer through a night market with lanterns'], ['video', 'Video', 'A thirty second film for a riverside cafe that opens at six']].map(([k, name, text]) => ({ id: `m-make-menu-${k}`, flow: MAKE, uses: 'rich', title: `The Make menu, ${name}: Just make it or Studio`, run: env => makeMenu(env, text, k) })),
  { id: 'm-make-deck', flow: MAKE, uses: 'rich', title: 'Make a Deck: one way, straight to the Studio', run: async env => { const s = await rich(env); await go(env, s); await makeText(env, 'A pitch deck for a tea subscription', 'deck'); await vis(env.page, '.project.scaffold .sc-row', 12000); await fold(env) }, settle: 2500 },
  { id: 'm-ask-first', flow: MAKE, uses: 'rich', title: 'Just make it, a website: Skip all · Step by step · Pick steps to skip', run: async env => { await makeMenu(env, 'A site for a bike repair shop that also sells coffee', 'site'); await click(env.page, '.hm-menu [data-k="now"]'); await vis(env.page, '#feed .talk-opts [data-pick="go:steps"]', 12000) }, settle: 1200 },
  { id: 'm-pick-steps', flow: MAKE, uses: 'rich', title: 'Pick steps to skip', run: async env => { await makeMenu(env, 'A site for a ferry timetable on one small lake', 'site'); await click(env.page, '.hm-menu [data-k="now"]'); await click(env.page, '#feed .talk-opts [data-pick="go:pick"]', 12000); await vis(env.page, '#feed [data-pick="go:skip-brand"]', 12000) }, settle: 1200 },
  { id: 'm-step-by-step', flow: MAKE, uses: 'rich', title: 'Step by step: the Studio opens on Brand', run: async env => { await makeMenu(env, 'A site for a choir that sings in a railway arch', 'site'); await click(env.page, '.hm-menu [data-k="now"]'); await click(env.page, '#feed .talk-opts [data-pick="go:steps"]', 12000); await vis(env.page, '.project.scaffold .sc-row', 15000) }, settle: 3000 },
  { id: 'm-busy-toast', flow: MAKE, title: 'The "A build is running…" toast', run: () => no('not reachable: the server answers "busy" only to a message inside an open build (from/redo, server/server.mjs), and the Make box never sends one, so web/home.js never shows this toast') },
  { id: 'm-busy', flow: `${MAKE} (a build is running)`, uses: 'live', title: 'Just make it while another build runs: the same question, the work chip in the top bar', run: async env => { const s = await live(env); await go(env, s); await makeText(env, 'A site for a bike repair shop that also sells coffee', 'site'); await click(env.page, '.hm-menu [data-k="now"]'); await env.wait(3000) } },

  // ---------- The Studio scaffold
  ...[['brand', 'Brand'], ['references', 'References'], ['assets', 'Assets'], ['plan', 'Plan'], ['proposal', 'Lock']].map(([k, name]) => ({ id: `m-studio-${k}`, flow: STU, uses: 'rich', title: `The Studio scaffold on ${name}`, run: env => scaffold(env, k), settle: 2500 })),
  ...[['brand', 'Brand'], ['references', 'References'], ['assets', 'Assets'], ['plan', 'Plan'], ['proposal', 'Lock']].map(([k, name]) => ({ id: `m-studio-chip-${k}`, flow: STU, uses: 'rich', title: `The Studio scaffold: ${name} pressed on the step path`, run: async env => { await scaffold(env, ''); await click(env.page, `.sc-path .sc-chip[data-step="${k}"]`); await env.wait(900) }, settle: 1800 })),
  { id: 'm-studio-whole', flow: STU, uses: 'rich', title: 'The Studio scaffold, the whole board', run: env => scaffold(env, ''), settle: 2200 },
  { id: 'm-studio-ref', flow: STU, uses: 'rich', title: 'A reference picked: its inspector', run: async env => { await scaffold(env, 'references'); await card(env, 'ref:rwalk1', 'mood.png'); await insp(env.page, '.project.scaffold') }, settle: 1200 },
  { id: 'm-studio-asset', flow: STU, uses: 'rich', title: 'An asset picked: its role', run: async env => { await scaffold(env, 'assets'); await card(env, 'asset:awalk1', 'logo.png'); await insp(env.page, '.project.scaffold') }, settle: 1200 },
  { id: 'm-studio-page', flow: STU, uses: 'rich', title: 'A planned page picked', run: async env => { await scaffold(env, 'plan'); await card(env, 'page:0', 'Home'); await insp(env.page, '.project.scaffold') }, settle: 1200 },
  { id: 'm-studio-layers', flow: STU, uses: 'rich', only: 'phone', title: 'The Studio scaffold: Layers', run: async env => { await scaffold(env, 'brand'); await click(env.page, '.sc-layers-btn'); await vis(env.page, '.scaffold.files-on') } },
  { id: 'm-studio-loading', flow: STU, uses: 'rich', title: 'The Studio scaffold while it loads', run: async env => { const s = await rich(env); await hold(env, pathIs(`/api/studio/${STUDIO}`)); await env.page.goto(`${s.BASE}/?room=studio&project=${STUDIO}`); await vis(env.page, '.project.scaffold .wait-in', 15000) } },

  // ---------- The Plan board
  { id: 'm-plan-loading', flow: PLANB, uses: 'rich', title: 'The Plan board while the plan loads: three waiting cards', run: async env => { const s = await rich(env); await hold(env, pathIs(`/api/plans/${PLAN}`)); await env.page.goto(`${s.BASE}/?room=plan&plan=${PLAN}`); await vis(env.page, '.project.plan .ab.pcard.wait-in', 15000); await fold(env) } },
  { id: 'm-plan-card', flow: PLANB, uses: 'rich', title: 'A plan card picked: its inspector', run: async env => { await board(env); await click(env.page, '.project.plan .ab.pcard[data-key="card:cast"]'); await insp(env.page, '.project.plan') }, settle: 1200 },
  { id: 'm-plan-starter', flow: PLANB, uses: 'rich', title: 'A Starter card picked: its options and why', run: async env => { await board(env); await click(env.page, '.project.plan .ab.pcard[data-key="st:engine"]'); await insp(env.page, '.project.plan') }, settle: 1200 },
  { id: 'm-plan-menu', flow: PLANB, uses: 'rich', title: 'The Plan menu', run: async env => { await board(env); await click(env.page, '.pl-crumb .pl-menu'); await vis(env.page, '.hm-menu [data-k="tpl"]') } },
  { id: 'm-plan-sheet', flow: PLANB, uses: 'rich', title: 'A sketch sheet picked', run: async env => { await board(env); await click(env.page, '.pl-sheets .ab.ppic.sheet[data-key="sheet:cast"]'); await insp(env.page, '.project.plan') }, settle: 1200 },
  { id: 'm-plan-cell', flow: PLANB, uses: 'rich', title: 'A sketch cell picked: its ring and its note', run: async env => {
    await board(env)
    const sheet = env.page.locator('.pl-sheets .ab.ppic.sheet[data-key="sheet:cast"]').first()
    await sheet.click(); await insp(env.page, '.project.plan')
    const b = await sheet.boundingBox()
    await env.page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.4)
    await vis(env.page, '.pj-insp .pl-pick.on')
  }, settle: 1200 },
  { id: 'm-plan-gate', flow: PLANB, uses: 'rich', title: 'Lock: the Gate', run: async env => { await board(env); if (/^build/i.test(await env.page.locator('.topbar .pl-primary').first().innerText())) no('this plan is locked already (m-plan-locked ran before it)'); await click(env.page, '.topbar .pl-primary'); await vis(env.page, '.ui-dialog.pl-gate .pl-go') } },
  { id: 'm-plan-locked', flow: PLANB, uses: 'rich', title: 'The board after Lock: Build, Mocks, World, Close-ups', run: async env => {
    await board(env)
    if (!/^build/i.test(await env.page.locator('.topbar .pl-primary').first().innerText())) { await click(env.page, '.topbar .pl-primary'); await click(env.page, '.ui-dialog.pl-gate .pl-go') }
    await vis(env.page, '.project.plan [data-sec="build"]', 12000)
    await vis(env.page, '.project.plan [data-sec="close"]')
  }, settle: 2500 },
  { id: 'm-plan-locked-build', flow: PLANB, uses: 'rich', title: 'The board after Lock, moved down to its Build section', run: async env => {
    await board(env)
    if (!/^build/i.test(await env.page.locator('.topbar .pl-primary').first().innerText())) no('the plan is not locked (m-plan-locked locks it)')
    const b = await env.page.locator('.project.plan [data-sec="cards"]').first().boundingBox()
    await env.page.mouse.move(b.x + b.width + 40, b.y + 40)
    await env.page.mouse.wheel(0, env.phone ? 900 : 420)
  }, settle: 1500 },

  // ---------- The Overview
  { id: 'm-ov-work', flow: `${OV} (a build is running)`, uses: 'live', title: 'The work chip and Stop', run: async env => { const s = await live(env); await overviewOf(env, s, s.ids.site); await vis(env.page, '.topbar .work-chip', 20000); await vis(env.page, '.topbar .work-stop') }, settle: 1200 },
  { id: 'm-ov-work-pop', flow: `${OV} (a build is running)`, uses: 'live', title: 'The work chip’s popover', run: async env => { const s = await live(env); await overviewOf(env, s, s.ids.site); await click(env.page, '.topbar .work-chip', 20000); await vis(env.page, '.wk-pop .wk-row') }, settle: 800 },
  { id: 'm-ov-tell-busy', flow: `${OV} (a build is running)`, uses: 'live', title: 'Tell the crew while a build runs, four seconds after Send', run: async env => { const s = await live(env); await go(env, s, `/?project=${s.ids.site}&version=${s.ids.site2}`, '.project:not(.plan) .pj-world'); await ovChat(env); await env.page.locator('#brief').fill('Add a page for gift boxes'); await env.page.locator('#brief').press('Enter') }, settle: 4000 },
  { id: 'm-ov-stop', flow: `${OV} (a build is running)`, uses: 'live', title: 'Stop pressed', run: async env => { const s = await live(env); await overviewOf(env, s, s.ids.site); await click(env.page, '.topbar .work-stop', 20000) }, settle: 2500 },
  { id: 'm-ov-live-line', flow: OV, uses: 'rich', title: 'The live line: who is painting', run: async env => { const s = await rich(env); await overviewOf(env, s, s.R.art); await vis(env.page, 'button.pj-now') }, settle: 2000 },
  { id: 'm-ov-picture-failed', flow: OV, uses: 'rich', title: 'A picture that failed: Try again', run: async env => { const s = await rich(env); await overviewOf(env, s, s.R.art); await vis(env.page, '.pj-world .ab.art.pt-failed .pt-again'); await env.page.locator('.pj-world .ab.art.pt-failed').first().click(); await insp(env.page) }, settle: 1500 },
  { id: 'm-ov-section', flow: OV, title: 'The inspector with a section picked, and the scope chip', run: async env => { await section(env); if (!env.phone) await vis(env.page, '#brief-form .pj-scope:not(.pj-mkchip)') }, settle: 1500 },
  { id: 'm-ov-part', flow: OV, title: 'The inspector with a part picked', run: async env => { await section(env); await click(env.page, '.pj-insp .pj-part[data-el]', 10000); await vis(env.page, '.pj-insp .pj-eback') }, settle: 1500 },
  { id: 'm-ov-marks', flow: OV, title: 'Scribble: a mark, its note and the marks chip', run: async env => {
    const s = await main(env); await overviewOf(env, s, s.ids.site)
    const { page } = env
    await click(page, '.pj-dock [data-tool="scribble"]')
    const b = await page.locator('.pj-world .ab[data-key="page:home"]').first().boundingBox()
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.25); await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5, { steps: 8 }); await page.mouse.up()
    // the marks chip is with the chat's box (a sheet on a phone, behind the dock's Chat tool)
    await ovChat(env)
    await vis(page, '#brief-form .pj-mkchip')
  }, settle: 800 },
  { id: 'm-ov-mode-menu', flow: OV, title: 'The mode menu', run: async env => { if (env.phone) no('not shown at 390: the mode menu is hidden below 760 px (web/studio.css)'); const s = await main(env); await overviewOf(env, s, s.ids.site); await click(env.page, '.mode-btn'); await vis(env.page, '.mode-menu [data-mode]') } },
  { id: 'm-ov-more-menu', flow: OV, title: 'The ☰ menu', run: async env => { const s = await main(env); await overviewOf(env, s, s.ids.site); await click(env.page, '#more-btn'); await vis(env.page, '#more-menu') } },
  { id: 'm-ov-file-menu', flow: OV, title: 'A file’s menu (right-click in Files)', run: async env => { const s = await main(env); await overviewOf(env, s, s.ids.site); await tap(env.page, '[data-tool="files"]'); await env.page.locator('.pj-list .row[data-key]').first().click({ button: 'right' }); await vis(env.page, '.hm-menu [data-k]') } },
  { id: 'm-ov-board-menu', flow: OV, title: 'An artboard’s menu (right-click on the stage)', run: async env => { const s = await main(env); await overviewOf(env, s, s.ids.site); await env.page.locator('.pj-world .ab[data-key^="page:"]').first().click({ button: 'right' }); await vis(env.page, '.hm-menu [data-k]') } },
  { id: 'm-ov-skeleton', flow: OV, title: 'The Overview while the board loads: the skeleton', run: async env => { const s = await main(env); await hold(env, url => /\/api\/runs\/[^/]+\/board$/.test(new URL(url).pathname)); await env.page.goto(`${s.BASE}/?project=${s.ids.site}&version=${s.ids.site}`); await vis(env.page, '.pj-world .ab.page.wait-in', 15000) } },
  { id: 'm-ov-app', flow: OV, uses: 'rich', title: 'An app’s board: the App artboard picked', run: async env => { const s = await rich(env); await overviewOf(env, s, s.R.ship); await click(env.page, '.pj-world .ab[data-key="app"]'); await insp(env.page) }, settle: 2000 },
  { id: 'm-ov-game', flow: OV, title: 'A game’s board: the Game artboard picked', run: async env => { const s = await main(env); await overviewOf(env, s, s.ids.game); await click(env.page, '.pj-world .ab[data-key="game"]'); await insp(env.page) }, settle: 2000 },
  { id: 'm-ov-film', flow: OV, uses: 'rich', title: 'A film’s board: the Film artboard picked', run: async env => { const s = await rich(env); if (!s.gotFilm) no('no ffmpeg on this computer to make the fixture film'); await overviewOf(env, s, s.R.filmDone); await click(env.page, '.pj-world .ab[data-key^="film"]'); await insp(env.page) }, settle: 2000 },
  { id: 'm-ov-empty', flow: OV, uses: 'rich', title: 'A project that built nothing: the empty Overview', run: async env => { const s = await rich(env); await go(env, s, `/?project=${s.R.bare}&version=${s.R.bare}`, '.project:not(.plan)') }, settle: 2500 },

  // ---------- The Design deck
  { id: 'm-deck-brief', flow: DECK, uses: 'rich', title: 'The chat with a brief: Build · Keep talking (Just make it, an app)', run: async env => { await makeMenu(env, 'An app where neighbours lend each other tools and track returns', 'app'); await click(env.page, '.hm-menu [data-k="now"]'); await vis(env.page, '#feed .talk-brief', 12000); await vis(env.page, '#feed .talk-acts [data-more]') }, settle: 1200 },
  { id: 'm-deck-keep-talking', flow: DECK, uses: 'rich', title: 'Keep talking pressed', run: async env => { await makeMenu(env, 'An app where a choir picks its next songs by vote', 'app'); await click(env.page, '.hm-menu [data-k="now"]'); await click(env.page, '#feed .talk-acts [data-more]', 12000) }, settle: 1500 },
  { id: 'm-deck-planning', flow: `${DECK} (a build is running)`, uses: 'live', title: 'The progress line: Planning the pages…', run: async env => { const s = await live(env); const run = s.run || (await s.api('/api/work')).jobs[0].run; await deckOf(env, s, run); await chat(env); await vis(env.page, '#feed >> text=/Planning the pages/', 12000) }, settle: 1500 },
  { id: 'm-deck-stop', flow: `${DECK} (a build is running)`, uses: 'live', title: 'Stop pressed on the deck while the planner plans', run: async env => { const s = await live(env); const run = s.run || (await s.api('/api/work')).jobs[0].run; await deckOf(env, s, run); await chat(env); await click(env.page, '.work-stop', 20000); s.run = null; await env.page.locator('.work-stop').first().waitFor({ state: 'hidden', timeout: 10000 }) }, settle: 2500 },
  { id: 'm-deck-stopped', flow: DECK, uses: 'rich', title: 'A build that stopped, opened again: what is kept, and Resume', run: async env => { const s = await rich(env); await deckOf(env, s, s.R.stopped); await vis(env.page, '#feed .item.bot .chips button.primary', 12000) }, settle: 1500 },
  { id: 'm-deck-comment', flow: DECK, uses: 'rich', title: 'A comment sent, and the crew’s reply', run: async env => {
    const s = await rich(env)
    s.ctl.hold = new Promise(r => { s.ctl.release = r })
    await deckOf(env, s, s.ids.site2)
    const { page } = env
    await env.wait(1200)
    await page.keyboard.press('c')
    await page.mouse.click(env.W.viewport.width / 2, env.W.viewport.height / 2)
    await vis(page, '.cbox.open textarea')
    await page.locator('.cbox.open textarea').first().fill('Make this heading shorter')
    await page.keyboard.press('Enter')
    await env.wait(800)
    await chat(env)
    await vis(page, '#feed .item.reply', 12000)
  }, settle: 1200, after: env => { const s = env.mx?.rich; s?.ctl.release?.(); if (s) s.ctl.hold = null } },
  { id: 'm-deck-comment-saved', flow: DECK, uses: 'rich', title: 'A build with a comment and its reply, opened again', run: async env => { const s = await rich(env); await deckOf(env, s, s.R.talked); await chat(env); await vis(env.page, '#feed .item.reply', 12000) }, settle: 1200 },
  { id: 'm-deck-critic', flow: `${DECK} (replay of a saved review)`, uses: 'rich', title: 'The Critic’s flags on sections', run: async env => { const s = await rich(env); await go(env, s, `/?replay=${s.R.critic}`, '#viewport'); await vis(env.page, '.rv-flag', 22000) }, settle: 600 },
  { id: 'm-deck-empty', flow: DECK, uses: 'rich', title: 'Nothing built yet: empty Layers', run: async env => { const s = await rich(env); await deckOf(env, s, s.R.bare); await tap(env.page, '.deck-layers-btn'); await vis(env.page, '.deck-layers #tree .empty') }, settle: 1200 },

  // ---------- Publish
  { id: 'm-pub-thumb', flow: PUB, uses: 'rich', title: 'Publish the site: the thumbnail and the ones to swap to', run: async env => { await publishPop(env, s0(env).R.pub); await click(env.page, '#pub-menu [data-pub="site"]'); await vis(env.page, '.publish-pop .pthumb img', 12000) }, settle: 1500 },
  { id: 'm-pub-connect', flow: PUB, uses: 'rich', title: 'Publish the site: connecting a host (Vercel)', run: async env => { await publishPop(env, s0(env).R.pub); await click(env.page, '#pub-menu [data-pub="site"]'); await click(env.page, '.publish-pop details.pconn summary', 12000); await vis(env.page, '.publish-pop form[data-conn]') }, settle: 800 },
  { id: 'm-pub-github', flow: `${PUB} (host answer stubbed)`, uses: 'rich', title: 'Publish the site: GitHub signed in, Vercel connected', run: async env => {
    await rich(env)
    await answer(env, pathIs('/api/publish'), j => ({ ...j, github: GH.login, githubOwner: GH.owner, vercel: { user: 'ada-example', env: false } }))
    await publishPop(env, s0(env).R.pub); await click(env.page, '#pub-menu [data-pub="site"]'); await vis(env.page, '.publish-pop .pdisc', 12000)
  }, settle: 1200 },
  { id: 'm-pub-live-local', flow: PUB, uses: 'rich', title: 'Published on This computer: Live', run: async env => { await publishPop(env, s0(env).R.pub); await click(env.page, '#pub-menu [data-pub="site"]'); await click(env.page, '.publish-pop .popt[data-target="local"]', 12000); await vis(env.page, '.publish-pop .pstate.live', 15000) }, settle: 1200 },
  { id: 'm-pub-publishing', flow: `${PUB} (replay of a saved publish)`, uses: 'rich', title: 'Publishing: each stage', run: async env => { const s = await rich(env); await go(env, s, `/?replay=${s.R.pubRec}`, '#viewport'); await vis(env.page, '.publish-pop .psteps', 23000) }, settle: 300 },
  { id: 'm-pub-live', flow: `${PUB} (replay of a saved publish)`, uses: 'rich', title: 'Live on GitHub Pages: the link, Publish again, Copy link, Open, Post to Feed', run: async env => { const s = await rich(env); await go(env, s, `/?replay=${s.R.pubRec}`, '#viewport'); await vis(env.page, '.publish-pop .pstate.live', 23000) }, settle: 600 },
  { id: 'm-pub-live-menu', flow: PUB, uses: 'rich', title: 'A site that is live: the Publish button and its menu', run: async env => { await publishPop(env, s0(env).R.wasLive); await vis(env.page, '#publish-btn.live'); await vis(env.page, '#pub-menu .pub-live') }, settle: 800 },
  { id: 'm-pub-failed', flow: PUB, uses: 'rich', title: 'Not published: the reason, Other host, Retry', run: async env => { await publishPop(env, s0(env).R.pubFailed); await click(env.page, '#pub-menu [data-pub="site"]'); await vis(env.page, '.publish-pop .pstate.err', 12000) }, settle: 800 },
  { id: 'm-pub-domain', flow: PUB, title: 'A custom domain and its DNS steps', run: () => no('not built: nothing in web/ mentions a custom domain, DNS or CNAME (docs/ux/breadboards/publish.md says the same)') },
  { id: 'm-auto-panel', flow: `${PUB}: Promote`, title: 'A finished Auto run: its panel, with Summary and Launch kit', run: () => no('not shown: the classic Studio hides the Auto panel (web/studio.css: body.cosmos .auto-panel is display none), so its Summary and Launch kit buttons cannot be pressed') },
  { id: 'm-auto-summary', flow: `${PUB}: Promote (replay of a saved Auto run)`, uses: 'rich', title: 'An Auto run ends: its summary card', run: async env => { await summary(env) }, settle: 1500 },
  { id: 'm-launch-writing', flow: `${PUB}: Promote (replay of a saved Auto run)`, uses: 'rich', title: 'The launch kit while the posts are written', run: async env => {
    const s = await summary(env)
    rmSync(join(s.data, 'runs', s.R.ship, 'launch.json'), { force: true })
    s.ctl.hold = new Promise(r => { s.ctl.release = r })
    await click(env.page, '.show-sum .ss-launch'); await vis(env.page, '.launch-pop')
    await env.wait(600)
    if (await shown(env.page, '.lk-card')) no('the posts were written at once, with no waiting state to show')
  }, settle: 300, after: env => { const s = env.mx?.rich; s?.ctl.release?.(); if (s) s.ctl.hold = null } },
  { id: 'm-launch-kit', flow: `${PUB}: Promote (replay of a saved Auto run)`, uses: 'rich', title: 'The launch kit: a post per network', run: async env => { await kit(env); await vis(env.page, '.launch-pop .lk-card', 15000) }, settle: 1500 },
  { id: 'm-launch-edit', flow: `${PUB}: Promote (replay of a saved Auto run)`, uses: 'rich', title: 'The launch kit: a post being edited', run: async env => { await kit(env); await click(env.page, '.launch-pop .lk-card .lk-edit', 15000) }, settle: 800 },
  { id: 'm-launch-video', flow: `${PUB}: Promote (replay of a saved Auto run)`, uses: 'rich', title: 'The launch kit: the promo video', run: async env => { const s = await rich(env); if (!s.shipFilm) no('no ffmpeg on this computer to make the fixture film'); await kit(env); const v = env.page.locator('.launch-pop .lk-media [data-kind="video"]').first(); await v.waitFor({ state: 'visible', timeout: 15000 }); await v.scrollIntoViewIfNeeded() }, settle: 1200 },
  { id: 'm-launch-send', flow: `${PUB}: Promote (replay of a saved Auto run; gateway answer stubbed)`, uses: 'rich', title: 'The launch kit: a Discord post, confirmed before it is sent', run: async env => {
    const s = await rich(env)
    await answer(env, pathIs('/api/gateway'), j => ({ ...j, platforms: { ...(j.platforms || {}), discord: ['discord:#launch'] } }))
    await go(env, s, `/?replay=${s.R.ship}`, '#viewport')
    await click(env.page, '.show-sum .ss-launch', 20000)
    await click(env.page, '.launch-pop .lk-card[data-id="discord"] .lk-post', 15000)
    await vis(env.page, '.lk-confirm .lkc-send')
  }, settle: 800 },

  // ---------- The rooms
  { id: 'm-app-wall', flow: ROOMS, uses: 'rich', title: 'The App room while the crew builds: the wall (Map, code windows)', run: async env => { await appRoom(env, s0(env).R.appWork); await vis(env.page, '.codewall .cw-grid', 12000) }, settle: 2500 },
  { id: 'm-app-wall-map', flow: ROOMS, uses: 'rich', title: 'The build wall: the Map enlarged', run: async env => { await appRoom(env, s0(env).R.appWork); await click(env.page, '.codewall .mp-zoom', 12000); await vis(env.page, '.cw-map.big') }, settle: 1500 },
  { id: 'm-app-wall-tile', flow: ROOMS, uses: 'rich', title: 'The build wall: one window enlarged', run: async env => { await appRoom(env, s0(env).R.appWork); await click(env.page, '.codewall .cw-grid .cw-tile', 12000); await vis(env.page, '.cw-grid.zoom .cw-tile.big') }, settle: 1500 },
  ...[['live', 'Live app'], ['map', 'Map'], ['art', 'Art'], ['crew', 'Crew']].map(([k, name]) => ({ id: `m-app-stage-${k}`, flow: ROOMS, uses: 'rich', title: `The App room while the crew builds: ${name}`, run: async env => { await appRoom(env, s0(env).R.appWork); await vis(env.page, '#app-stageview [data-stage]', 12000); if (!(await shown(env.page, `#app-stageview [data-stage="${k}"]`))) no(`this build's switch has no ${name}: ${(await env.page.locator('#app-stageview').first().innerText()).replace(/\s+/g, ' ').trim()} only (nothing is served or painted yet)`); await click(env.page, `#app-stageview [data-stage="${k}"]`) }, settle: 2000 })),
  { id: 'm-app-wall-code', flow: ROOMS, uses: 'rich', title: 'The App room while the crew builds: Code', run: async env => { await appRoom(env, s0(env).R.appWork); await click(env.page, '#app-mode [data-mode="code"]', 12000) }, settle: 2000 },
  { id: 'm-app-ask', flow: ROOMS, uses: 'rich', title: 'The App room: Ask the crew', run: async env => { await appRoom(env, s0(env).R.appWork); await tap(env.page, '.cosmos-chatbtn'); await click(env.page, '#brief'); await env.page.locator('#brief').fill('Why is the shelf first?') }, settle: 800 },
  { id: 'm-app-shipped', flow: ROOMS, uses: 'rich', title: 'An app that shipped: the App room', run: async env => { await appRoom(env, s0(env).R.ship) }, settle: 6000 },
  { id: 'm-app-shipped-map', flow: ROOMS, uses: 'rich', title: 'An app that shipped: its Map', run: async env => { await appRoom(env, s0(env).R.ship); if (await shown(env.page, '#app-stageview [data-stage="map"]')) await click(env.page, '#app-stageview [data-stage="map"]'); else await click(env.page, '.mapdoor', 8000); await vis(env.page, '.cw-map', 8000) }, settle: 2000 },
  { id: 'm-game-wall', flow: ROOMS, uses: 'rich', title: 'The Game room while the crew builds: the wall', run: async env => { const s = await rich(env); await go(env, s, `/?version=${s.R.gameWork}&room=game`, '#appview'); await fold(env); await vis(env.page, '.codewall .cw-grid', 12000) }, settle: 2500 },
  { id: 'm-game-playtest', flow: ROOMS, uses: 'rich', title: 'The Game room: the play test on the wall', run: async env => { const s = await rich(env); await go(env, s, `/?version=${s.R.gameWork}&room=game`, '#appview'); await fold(env); await vis(env.page, '.playclip:not([hidden])', 12000) }, settle: 2500 },
  { id: 'm-game-map', flow: ROOMS, title: 'The Game room: the Map', run: async env => { const s = await main(env); await go(env, s, `/?version=${s.ids.game}&room=game`, '#appview'); await fold(env); await click(env.page, '.mapdoor', 12000); await vis(env.page, '.cw-map') }, settle: 2000 },
  { id: 'm-game-play', flow: ROOMS, uses: 'rich', title: 'A game that was built: playing it in the Game room', run: async env => { if (!sourceSig) no('engine/appjob.mjs did not load here, so the fixture game has no build stamp'); const s = await rich(env); await go(env, s, `/?version=${s.R.gamePlay}&room=game`, '#appview'); await fold(env) }, settle: 7000 },
  { id: 'm-film-working', flow: `${ROOMS} (a build is running)`, uses: 'live', title: 'A film being made: Make the film pressed', run: async env => { const s = await live(env); await go(env, s, `/?version=${s.ids.site2}&room=video`, '.video-pop'); await fold(env); if (await shown(env.page, '.vprompt')) await env.page.locator('.vprompt').first().fill('A 20 second film about tea after a night shift'); await click(env.page, '.vagain'); await env.wait(6000); if (await shown(env.page, '.video-pop .vprompt')) no('six seconds after Make the film the room shows the form again, with no reason on screen (this Studio has no Hermes to make a film with)'); if (await shown(env.page, '.vstage.err')) no(`the film stopped at once: ${(await env.page.locator('.vstage.err').first().innerText()).slice(0, 100)}`) }, settle: 1500 },
  { id: 'm-film-storyboard', flow: `${ROOMS} (film answer stubbed)`, uses: 'rich', title: 'A film in progress: its storyboard', run: async env => {
    const s = await rich(env), run = s.R.filmWork
    // the Studio closes a film it finds half made when it starts; this shows that film as it was while it rendered
    await answer(env, pathIs(`/api/runs/${run}/video`), () => ({ state: 'working', pct: 40, stage: 'storyboard' }))
    await env.page.route(pathIs(`/api/runs/${run}/events`), async route => { const r = await route.fetch(); const text = await r.text(); let body = text; try { const j = JSON.parse(text); const drop = a => a.filter(e => e.type !== 'video:failed'); body = JSON.stringify(Array.isArray(j) ? drop(j) : { ...j, events: drop(j.events || []) }) } catch { body = text.split('\n').filter(l => !l.includes('"video:failed"')).join('\n') } await route.fulfill({ response: r, body }) })
    await go(env, s, `/?version=${run}&room=video`, '.video-pop'); await fold(env)
    await vis(env.page, '.video-pop .vstory .vscene', 12000)
  }, settle: 1500 },
  { id: 'm-film-done', flow: ROOMS, uses: 'rich', title: 'A film that worked: the Film room', run: async env => { const s = await rich(env); if (!s.gotFilm) no('no ffmpeg on this computer to make the fixture film'); await go(env, s, `/?version=${s.R.filmDone}&room=video`, '.video-pop'); await fold(env); await vis(env.page, '.video-pop video', 12000) }, settle: 2500 },
  { id: 'm-film-big', flow: ROOMS, uses: 'rich', title: 'A film that worked: watched large', run: async env => { const s = await rich(env); if (!s.gotFilm) no('no ffmpeg on this computer to make the fixture film'); await go(env, s, `/?version=${s.R.filmDone}&room=video`, '.video-pop'); await fold(env); await click(env.page, '.video-pop .vbig', 12000); await vis(env.page, '.video-big') }, settle: 1500 }
]

// the rich Studio once a step has started it (its run ids)
function s0(env) { const s = env.mx?.rich; if (!s) throw new Error('the rich Studio is not started'); return s }
// every step that names the rich Studio's runs starts it first
for (const st of LIST) if (st.uses === 'rich') { const run = st.run; st.run = async env => { await rich(env); return run(env) } }
// each step lets go of what it held or stubbed; the last step that uses a Studio ends it
// (with --steps, the last of the picked ones, so the run can end)
const PICK = (i => (i > 0 ? String(process.argv[i + 1] || '').split(',') : null))(process.argv.indexOf('--steps'))
const lastOf = name => LIST.findLast(s => s.uses === name && !s.only && (!PICK || PICK.includes(s.id)))?.id
const ENDS = Object.fromEntries(['rich', 'live', 'empty'].map(n => [lastOf(n), n]))
export const MORE_STEPS = LIST.map(({ uses, ...st }) => ({ ...st, after: async env => { await clean(env); try { await st.after?.(env) } finally { if (ENDS[st.id]) end(env, ENDS[st.id]) } } }))
