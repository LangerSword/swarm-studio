// The walkthrough's flows (docs/ux/walkthrough): whole journeys, screen after screen, with what happens when a
// step fails, and the planner chat's states for a website and an app. Each flow runs on a throwaway Studio of its
// own (scripts/walkthrough-fixtures.mjs) whose planner this file scripts: it answers, keeps the person waiting,
// or fails. Only the planner's talk is scripted (the intent read, the talk, the brief, Ask mode); every other
// model call gets no answer, as in the plain fixture, so a build started here fails the way it really would.
// A flow whose name says "planner scripted" shows Hermia saying words this file wrote; what the Studio does
// with them (buttons, briefs, builds, failures) is its own.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { studio } from './walkthrough-fixtures.mjs'

const vis = (page, sel, timeout = 8000) => page.locator(sel).first().waitFor({ state: 'visible', timeout })
const click = async (page, sel, timeout) => { await vis(page, sel, timeout); await page.locator(sel).first().click() }
const tap = async (page, sel) => { const l = page.locator(sel).first(); if (await l.isVisible().catch(() => false)) await l.click({ timeout: 2000 }).catch(() => {}) }

// ---------- the scripted planner: one model serves every role, so each call is told apart by its system prompt
const sysOf = ask => String(ask.messages?.[0]?.content || '')
function callOf(ask) {
  const s = sysOf(ask)
  if (/^A person typed this into the box/.test(s)) return 'read'
  if (/^Write the brief a crew/.test(s)) return 'brief'
  if (/The chat is in Ask mode/.test(s)) return 'ask'
  if (/^You are Hermia, the planner of a crew/.test(s)) return 'talk'
  return null
}
// ctl: what each call answers (a string, or null for no answer); hold: the talk, the brief and Ask wait on it
function planner(ctl) {
  return async ask => {
    const call = callOf(ask)
    // the build's own planner and builders: no answer, after the wait when one is set (a slow model, then none)
    if (!call) { if (ctl.buildHold) await ctl.buildHold; return null }
    ctl.calls.push(call)
    if (call === 'read') return typeof ctl.read === 'function' ? ctl.read(lastOf(ask)) : ctl.read
    if (ctl.hold) await ctl.hold
    const v = ctl[call]
    return typeof v === 'function' ? v(ask) : v
  }
}
const lastOf = ask => String(ask.messages?.at(-1)?.content || '')
const hold = ctl => { ctl.hold = new Promise(r => { ctl.release = () => { ctl.hold = null; r() } }) }
const letGo = ctl => ctl.release?.()
const holdBuild = ctl => { ctl.buildHold = new Promise(r => { ctl.buildGo = () => { ctl.buildHold = null; r() } }) }
const letBuild = ctl => ctl.buildGo?.()
// a message typed into a built project's dock is read first (build, or talk): a question is a talk, the rest a build
const readWords = text => (/\?\s*$|^\s*(find|search|look)\b/i.test(text.split('\n').at(-1)) ? 'talk' : 'build')
// what the Studio itself told the planner in its prompt (the open project, the Studio's state), read back and
// shortened to its first sentences: the one scripted answer that may speak about real state, since every word of
// it after the lead-in is the Studio's
const told = (ask, from, to) => {
  const s = sysOf(ask), a = s.indexOf(from)
  if (a < 0) return ''
  const b = to ? s.indexOf(to, a) : -1
  const all = s.slice(a + from.length, b < 0 ? undefined : b).replace(/\s+/g, ' ').trim()
  if (all.length <= 420) return all
  // shortened to whole sentences
  const cut = all.slice(0, 420), end = cut.lastIndexOf('. ')
  return end > 80 ? cut.slice(0, end + 1) : cut
}
const projectTold = ask => told(ask, 'What is there now:\n', '\nNever say nothing exists') || told(ask, 'The open project:\n', '\n\nSwarm Studio on this computer')
const studioTold = ask => told(ask, 'Swarm Studio on this computer right now:\n')

// ---------- one Studio per flow, kept on env until the flow's last step (or the next flow) ends it
async function flowStudio(env, key, { setup, noHermes = false, seen = true, ...answers } = {}) {
  if (env.fs?.key === key) return env.fs
  endFlow(env)
  const ctl = { read: readWords, talk: null, brief: null, ask: null, hold: null, buildHold: null, calls: [], ...answers }
  const s = await studio({ setup, noHermes, model: planner(ctl) })
  if (seen) await s.api('/api/setup', { seen: true })
  env.fs = { ...s, key, ctl }
  return env.fs
}
function endFlow(env) { try { letGo(env.fs?.ctl); letBuild(env.fs?.ctl); env.fs?.stop() } catch {} env.fs = null }

async function go(env, s, addr = '/', root = '.home') {
  await env.page.goto(s.BASE + addr)
  await vis(env.page, root, 15000)
  await env.wait(700)
}
// the Projects sidebar: on a phone it is a drawer behind its button
async function side(env, sel) {
  const { page } = env
  if (await page.locator('.hm-burger').first().isVisible().catch(() => false)) { await page.locator('.hm-burger').first().click(); await env.wait(300) }
  await click(page, sel)
}
// the chat column: in a room it may be folded behind its Chat button (a sheet on a phone)
async function chatOpen(env) {
  const { page } = env
  if (!(await page.locator('#brief').first().isVisible().catch(() => false))) { await tap(page, '.cosmos-chatbtn'); await tap(page, '.pj-dock [data-tool="comment"]') }
  await vis(page, '#brief')
}
async function type(env, text) { await chatOpen(env); await env.page.locator('#brief').fill(text) }
async function send(env, text) { await type(env, text); await env.page.locator('#brief').press('Enter') }
// the newest message of the chat is in the picture
const toEnd = page => page.evaluate(() => { const f = document.querySelector('#feed'); if (f) f.scrollTop = f.scrollHeight })
const chatBtn = (page, label) => page.locator('#feed button', { hasText: label }).last()
const seen = (page, re, timeout = 10000) => page.locator('#feed').getByText(re).last().waitFor({ state: 'visible', timeout })
// chat: false leaves the chat as the deck opens it (on a phone its sheet covers the pages)
const deck = async (env, s, run, chat = true) => { await go(env, s, `/?version=${run}&room=deck`, '#viewport'); await env.wait(900); if (chat) await chatOpen(env) }
const stopped = (page, timeout = 15000) => seen(page, /Stopped|Nothing was added|did not finish|didn.t answer/, timeout)
// Projects › Chats › New chat: the Design deck with nothing built, its chat empty
async function newChat(env, s) {
  await go(env, s)
  await side(env, '.hm-nav [data-v="chats"]')
  await click(env.page, '.chat-row.chat-new')
  await chatOpen(env)
  await env.wait(600)
}

// ---------- 1. a website talked through in the Design deck's chat, nothing built
const WEB = 'Website chat (planner scripted)'
const IDEA = 'A site for my bike repair shop in Leeds. What should it have?'
const WEB_REPLY = 'A repair shop site usually needs four things: what you fix and the prices, how to book, where you are, and a few words from customers. Do you want people to book a slot online, or call you? And is it one shop or several?'
const WEB_BRIEF = 'A website for a bike repair shop in Leeds, for local riders. Pages: Home with the services and prices, Book a repair (a form that sends the request, no payment), Find us with the address and hours, and customer words. One shop. Calm, plain look. Leave out a shop and accounts.'
const web = env => flowStudio(env, 'web', { talk: WEB_REPLY, brief: WEB_BRIEF })

const WEBSITE = [
  { id: 'f-web-empty', flow: WEB, title: 'Projects › Chats › New chat: the Design deck with nothing built, the chat empty', run: async env => newChat(env, await web(env)) },
  { id: 'f-web-typed', flow: WEB, title: 'The idea typed, not sent yet', run: async env => { await web(env); await type(env, IDEA) } },
  { id: 'f-web-thinking', flow: WEB, title: 'Sent: Hermia thinking (her answer has not come yet)', run: async env => {
    const s = await web(env)
    hold(s.ctl)
    await env.page.locator('#brief').press('Enter')
    await env.wait(1800)
  } },
  { id: 'f-web-reply', flow: WEB, title: 'Hermia answers and asks back in words; the one button is Build', run: async env => {
    const s = await web(env)
    letGo(s.ctl)
    await chatBtn(env.page, 'Build').waitFor({ state: 'visible', timeout: 10000 })
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-web-brief-wait', flow: WEB, title: 'Build pressed: "Writing the brief…"', run: async env => {
    const s = await web(env)
    hold(s.ctl)
    await chatBtn(env.page, 'Build').click()
    await env.wait(1500)
    await toEnd(env.page)
  } },
  { id: 'f-web-brief', flow: WEB, title: 'The brief, to read and edit: Build · Brand sheet · Keep talking', run: async env => {
    const s = await web(env)
    letGo(s.ctl)
    await vis(env.page, '.talk-brief textarea', 10000)
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-web-ask', flow: WEB, title: 'The brief’s Build pressed: nothing builds yet, the question before a build with its three answers', run: async env => {
    await web(env)
    await env.page.locator('.talk-brief [data-go]').first().click()
    await vis(env.page, '#feed [data-pick^="go:"]', 12000)
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-web-build', flow: WEB, title: '"Skip all, build now" pressed: the build starts, the model has not answered yet', run: async env => {
    const s = await web(env)
    holdBuild(s.ctl)
    await env.page.locator('#feed [data-pick="go:all"]').last().click()
    await env.wait(3500)
  }, after: env => letBuild(env.fs?.ctl) },
  { id: 'f-web-build-end', flow: WEB, title: 'The model gives the build no answer (this Studio’s builder has none): what a failed start shows', run: async env => {
    const s = await web(env)
    letBuild(s.ctl)
    await env.wait(7000)
    await chatOpen(env)
    await toEnd(env.page)
  } },
  { id: 'f-web-no-answer', flow: WEB, title: 'A new chat where the planner does not answer', run: async env => {
    const s = await web(env)
    s.ctl.talk = null
    await newChat(env, s)
    await send(env, IDEA)
    await env.wait(5000)
    await toEnd(env.page)
  }, after: endFlow },
  { id: 'f-web-no-hermes', flow: WEB, title: 'Hermes not running (a Studio with no Hermes and no model of its own): a new chat, the idea sent', run: async env => {
    const s = await flowStudio(env, 'web-off', { noHermes: true })
    await newChat(env, s)
    await send(env, IDEA)
    await env.wait(6000)
    await toEnd(env.page)
  }, after: endFlow }
]

// ---------- 2. the same for an app: the App room's chat (sw.appAsk, issue #542). The fixture's app is designed
// and not built, and the throwaway Studio has no app engine, so this is the chat of an app before its first build.
const APP = 'App chat (planner scripted)'
const APP_ASK = 'Let nurses filter the shift board by ward'
const appSay = ask => { const p = projectTold(ask); return p ? `I can plan that with you. What the Studio tells me is here now: ${p} Should the ward filter be on the board itself, or a setting each nurse keeps?` : 'I can plan that with you. Should the ward filter be on the board itself, or a setting each nurse keeps?' }
const APP_BRIEF = 'Add a ward filter to the shift board: a row of ward names above the board, one press shows only that ward’s shifts, and the choice is remembered for each nurse. Nothing else changes.'
const app = env => flowStudio(env, 'app', { talk: appSay, brief: APP_BRIEF, ask: a => `From what the Studio tells me: ${projectTold(a) || studioTold(a) || 'nothing about this project.'}` })
const appRoom = async (env, s) => { await go(env, s, `/?version=${s.ids.app}&room=app`, '#appview'); await env.wait(1200); await chatOpen(env) }

const APPCHAT = [
  { id: 'f-app-room', flow: APP, title: 'The App room of a designed app that is not built yet, its chat open', run: async env => appRoom(env, await app(env)), settle: 1200 },
  { id: 'f-app-change', flow: APP, title: 'A change asked for in the App room’s chat: what the chat answers before the app exists', run: async env => {
    const s = await app(env)
    await appRoom(env, s)
    await send(env, APP_ASK)
    await env.wait(3000)
    await toEnd(env.page)
  } },
  { id: 'f-app-overview-ask', flow: APP, title: 'The same change typed into the Overview’s bar and sent: a build of the design’s next version starts (the server took it), and this is the Overview five seconds on', run: async env => {
    const s = await app(env)
    await go(env, s, `/?project=${s.ids.app}&version=${s.ids.app}`, '.pj-world')
    await env.wait(1200)
    await env.page.locator('form.pj-ask input[name=q]').first().fill(APP_ASK)
    const run = env.page.waitForResponse(r => new URL(r.url()).pathname === '/api/run' && r.request().method() === 'POST', { timeout: 12000 }).catch(() => null)
    await env.page.keyboard.press('Enter')
    const res = await run
    // the title says a build started: it holds only if the server said so
    if (!res || res.status() !== 200) throw new Error(`the Overview’s bar did not start a build as this step’s title says: ${res ? `POST /api/run answered ${res.status()}` : 'no build was asked for'}`)
    await env.wait(5000)
  } },
  { id: 'f-app-plan-thinking', flow: APP, title: '"/plan" and the change: Hermia thinking', run: async env => {
    const s = await app(env)
    await appRoom(env, s)
    hold(s.ctl)
    await send(env, `/plan ${APP_ASK}`)
    await env.wait(1800)
    await toEnd(env.page)
  } },
  { id: 'f-app-plan-reply', flow: APP, title: 'Her answer and her question back, with Build', run: async env => {
    const s = await app(env)
    letGo(s.ctl)
    await chatBtn(env.page, 'Build').waitFor({ state: 'visible', timeout: 10000 })
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-app-plan-brief', flow: APP, title: 'Build pressed: the brief for the change', run: async env => {
    await app(env)
    await chatBtn(env.page, 'Build').click()
    await vis(env.page, '.talk-brief textarea', 10000)
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-app-plan-build', flow: APP, title: 'The brief’s Build pressed: what really starts for an app with no build yet', run: async env => {
    await app(env)
    await env.page.locator('.talk-brief [data-go]').first().click()
    await env.wait(7000)
    await chatOpen(env).catch(() => {})
    await toEnd(env.page)
  } },
  { id: 'f-app-question', flow: APP, title: '"/ask What is built so far?": the answer (Hermia reads back the project facts the Studio gave her)', run: async env => {
    const s = await app(env)
    await appRoom(env, s)
    await send(env, '/ask What is built so far?')
    await seen(env.page, /From what the Studio tells me/)
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-app-no-answer', flow: APP, title: 'The planner does not answer a question', run: async env => {
    const s = await app(env)
    s.ctl.ask = null
    await send(env, 'And who can see the board?')
    await env.wait(5000)
    await toEnd(env.page)
  } },
  { id: 'f-app-build-press', flow: APP, title: '"Build the app" pressed (the button the chat points to): the real first step of building it', run: async env => {
    const s = await app(env)
    await appRoom(env, s)
    // pressed only if a person could: the button's box and what is on top of its middle are read off the page
    const b = env.page.locator('#appview [data-build]').first()
    await b.waitFor({ state: 'attached', timeout: 8000 })
    const over = () => b.evaluate(el => {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) return 'it is in the page but not drawn (its box is empty)'
      const y = Math.round(r.y + r.height / 2), at = document.elementFromPoint(r.x + r.width / 2, y)
      if (at && (at === el || el.contains(at))) return ''
      const top = at?.closest('aside, [id], [class]')
      return `its middle (${y} of ${innerHeight} px down) is ${top ? `under <${top.tagName.toLowerCase()}${top.id ? ` #${top.id}` : ''}${top.className && typeof top.className === 'string' ? ` .${top.className.split(' ')[0]}` : ''}>` : 'off the screen'}`
    })
    let why = await over(), fold = 'the chat shows no × to fold it'
    if (why) {
      // the chat's × counts only when a person could see it: at 390 it is in the page with an icon of no size
      const x = env.page.locator('.cosmos-fold').first()
      const drawn = await x.evaluate(el => { const r = el.querySelector('svg')?.getBoundingClientRect(); return !!r && r.width >= 8 && r.height >= 8 }).catch(() => null)
      if (drawn) { await x.click(); await env.wait(600); why = await over(); fold = 'folding the chat with its × does not uncover it' }
      else if (drawn === false) fold = 'the chat’s × is not drawn (its icon has no size)'
    }
    if (why) throw new Error(`"Build the app" cannot be pressed: ${why}; ${fold}`)
    await b.click({ timeout: 6000 })
    await env.wait(2500)
  } },
  { id: 'f-app-built-change', flow: APP, title: 'A change to an app that is built, and its failure', run: async env => {
    await app(env)
    throw new Error('needs an app the app engine (Dyad) has built; the throwaway Studio has no built app, and faking one would start the engine’s own install')
  }, after: endFlow }
]

// ---------- 3. a built site changed from the Design deck's chat
const CHG = 'Change a built project from the chat (planner scripted)'
const CHG_ASK = 'Add a page for corporate gift orders'
const CHG_Q = 'Could a company order gift boxes for a whole team, or is that too much for this site?'
const CHG_REPLY = 'It fits: one more page, Team orders, with a short form (company, how many boxes, a date) that sends you the request. No payment on the site. Should the form ask for a delivery address, or do you settle that by email?'
const CHG_BRIEF = 'Add a Team orders page: a short form for a company to ask for gift boxes for a team (company name, how many boxes, the date wanted, an email). The form sends the request; no payment. Link it from Gift boxes. Keep every other page as it is.'
const stateSay = ask => { const p = projectTold(ask); return p ? `Here is what the Studio tells me about this project: ${p}` : 'The Studio gave me nothing about this project, so I cannot say.' }
const chg = env => flowStudio(env, 'change', { talk: ask => (/how far|going on/i.test(lastOf(ask)) ? stateSay(ask) : CHG_REPLY), brief: CHG_BRIEF, ask: a => `From what the Studio tells me: ${studioTold(a) || projectTold(a) || 'nothing.'}` })

const CHANGE = [
  { id: 'f-change-deck', flow: CHG, title: 'A built site in the Design deck, its chat open', run: async env => { const s = await chg(env); await deck(env, s, s.ids.site2) }, settle: 1500 },
  { id: 'f-change-typed', flow: CHG, title: 'A change typed', run: async env => { await chg(env); await type(env, CHG_ASK) } },
  { id: 'f-change-building', flow: CHG, title: 'Sent: the next version starts, the model has not answered yet', run: async env => {
    const s = await chg(env)
    holdBuild(s.ctl)
    await env.page.locator('#brief').press('Enter')
    await env.wait(3500)
  } },
  { id: 'f-change-fail', flow: CHG, title: 'The model gives no answer: what the deck and the chat show', run: async env => {
    const s = await chg(env)
    letBuild(s.ctl)
    await stopped(env.page)
    await toEnd(env.page)
  }, settle: 1200 },
  { id: 'f-change-talk-thinking', flow: CHG, title: 'A question about a change instead: Hermia thinking', run: async env => {
    const s = await chg(env)
    await deck(env, s, s.ids.site2)
    hold(s.ctl)
    await send(env, CHG_Q)
    await env.wait(2200)
    await toEnd(env.page)
  } },
  { id: 'f-change-talk-reply', flow: CHG, title: 'Her answer, with Build', run: async env => {
    const s = await chg(env)
    letGo(s.ctl)
    await chatBtn(env.page, 'Build').waitFor({ state: 'visible', timeout: 10000 })
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-change-brief', flow: CHG, title: 'Build pressed: the brief of what gets built', run: async env => {
    await chg(env)
    await chatBtn(env.page, 'Build').click()
    await vis(env.page, '.talk-brief textarea', 10000)
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-change-build', flow: CHG, title: 'The brief’s Build pressed: the next version starts (the model has not answered yet)', run: async env => {
    const s = await chg(env)
    holdBuild(s.ctl)
    await env.page.locator('.talk-brief [data-go]').first().click()
    await env.wait(3500)
    await toEnd(env.page)
  }, after: env => letBuild(env.fs?.ctl) },
  { id: 'f-change-state', flow: CHG, title: '"How far is the build?": answered from the project facts the Studio hands the planner (read back, shortened)', run: async env => {
    const s = await chg(env)
    await env.wait(2500)
    await deck(env, s, s.ids.site2)
    await send(env, 'How far is the build?')
    await seen(env.page, /Here is what the Studio tells me|gave me nothing/)
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-change-no-answer', flow: CHG, title: 'The planner does not answer the question', run: async env => {
    const s = await chg(env)
    s.ctl.talk = null
    await deck(env, s, s.ids.site2)
    await send(env, 'What is going on?')
    await env.wait(5000)
    await toEnd(env.page)
  } },
  { id: 'f-change-ask-wait', flow: CHG, title: 'Ask mode, "/ask What is going on?": Hermia answering', run: async env => {
    const s = await chg(env)
    await deck(env, s, s.ids.site2)
    hold(s.ctl)
    await send(env, '/ask What is going on?')
    await env.wait(2200)
    await toEnd(env.page)
  } },
  { id: 'f-change-ask-answer', flow: CHG, title: 'Ask mode: the answer, from the Studio’s own state as it hands it to the planner (read back, shortened)', run: async env => {
    const s = await chg(env)
    letGo(s.ctl)
    await seen(env.page, /From what the Studio tells me/)
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-change-ask-no-answer', flow: CHG, title: 'Ask mode: the planner does not answer', run: async env => {
    const s = await chg(env)
    s.ctl.ask = null
    await send(env, 'And is anything still building?')
    await env.wait(5000)
    await toEnd(env.page)
  }, after: endFlow }
]

// ---------- 4. a newcomer's first build, start to finish. The first steps are driven live; this Studio's model
// never answers a build, so the crew at work is the fixture's half-built build of the same idea resumed for real,
// and the finished pages are a seeded build of it (their titles say so). Projects already holds the fixture's other projects.
const FIRST = 'First build, start to finish'
const CAFE = 'Cedar Cafe, a small cafe by the river'
const rid = n => new Date(Date.parse('2026-11-01T10:00:00Z') + n * 3600e3).toISOString().replace(/[:.]/g, '-')
const CAFE_DONE = rid(9)
function addVersion(runs, project, run) {
  const file = join(runs, 'folders.json'), f = JSON.parse(readFileSync(file, 'utf8'))
  f.projects[project].runs.push(run)
  writeFileSync(file, JSON.stringify(f))
}
const first = env => flowStudio(env, 'first', { seen: false, setup: ({ runs, site, T0 }) => {
  site(runs, CAFE_DONE, { brief: CAFE, name: 'Cedar Cafe', t: T0 + 9 * 3600e3, pages: [['home', 'Cedar Cafe'], ['menu', 'Menu'], ['visit', 'Visit']] })
  addVersion(runs, rid(5), CAFE_DONE)
} })
const makeMenu = async (env, text) => {
  const { page } = env
  await click(page, '.hm-kind'); await click(page, '.hm-menu [data-k="site"]')
  await page.locator('.home input').first().fill(text)
  await page.locator('.hm-make').first().click()
  await vis(page, '.hm-menu')
}
const justMake = async env => {
  await env.page.locator('.hm-menu button', { hasText: 'Just make it' }).first().click()
  await vis(env.page, '#feed [data-pick^="go:"]', 15000)
}

const FIRSTBUILD = [
  { id: 'f-first-setup', flow: FIRST, title: 'The first open: Setup', run: async env => { const s = await first(env); await env.page.goto(s.BASE + '/'); await vis(env.page, '.ui-dialog.su', 15000) }, settle: 1500 },
  { id: 'f-first-projects', flow: FIRST, title: 'Setup closed: Projects (the fixture’s five projects are already there, a Cedar Cafe among them)', run: async env => { await first(env); await env.page.locator('.su-start, .ui-dialog-close').first().click({ timeout: 5000 }); await vis(env.page, '.home'); await env.wait(800) } },
  { id: 'f-first-words', flow: FIRST, title: 'The Make box with words', run: async env => {
    const s = await first(env)
    await s.api('/api/setup', { seen: true })
    await go(env, s)
    await click(env.page, '.hm-kind'); await click(env.page, '.hm-menu [data-k="site"]')
    await env.page.locator('.home input').first().fill(CAFE)
  } },
  { id: 'f-first-menu', flow: FIRST, title: 'Make pressed: the Make menu', run: async env => { await first(env); await env.page.locator('.hm-make').first().click(); await vis(env.page, '.hm-menu') } },
  { id: 'f-first-ask', flow: FIRST, title: '"Just make it": the question before a build, in the Design deck’s chat', run: async env => { await first(env); await justMake(env); await toEnd(env.page) }, settle: 900 },
  { id: 'f-first-planning', flow: FIRST, title: '"Skip all, build now": the build starts, the model has not answered yet', run: async env => {
    const s = await first(env)
    holdBuild(s.ctl)
    await env.page.locator('#feed [data-pick="go:all"]').last().click()
    await env.wait(3500)
  }, after: env => letBuild(env.fs?.ctl) },
  { id: 'f-first-crew', flow: FIRST, title: 'The crew at work, live (not this build: the fixture’s half-built Cedar Cafe resumed for real, its builders kept waiting on the model)', run: async env => {
    const s = await first(env)
    await env.wait(2500)
    const run = await resumeHeld(s, s.ids.mid)
    await deck(env, s, run, false)
    await env.wait(2500)
  }, settle: 1000, after: env => letBuild(env.fs?.ctl) },
  { id: 'f-first-done', flow: FIRST, title: 'The finished pages in the Design deck (seeded: the same idea, built)', run: async env => { const s = await first(env); await deck(env, s, CAFE_DONE, false) }, settle: 2000 },
  { id: 'f-first-overview', flow: FIRST, title: 'Back: the project’s Overview with its pages (seeded build)', run: async env => { const s = await first(env); await go(env, s, `/?project=${s.ids.mid}&version=${CAFE_DONE}`, '.pj-world') }, settle: 2500 },
  { id: 'f-first-play', flow: FIRST, title: 'Play', run: async env => { const s = await first(env); await deck(env, s, CAFE_DONE, false); await click(env.page, '#play-btn'); await vis(env.page, '#player') }, settle: 2000 },
  { id: 'f-first-publish', flow: FIRST, title: 'The Publish menu', run: async env => { const s = await first(env); await deck(env, s, CAFE_DONE, false); await click(env.page, '#publish-btn'); await vis(env.page, '#pub-menu') } },
  { id: 'f-first-publish-site', flow: FIRST, title: 'Publish › Website', run: async env => { await first(env); await click(env.page, '#pub-menu [data-pub="site"]') }, settle: 1500, after: endFlow }
]

// ---------- 5. a build that fails, and the fix. Nothing about the failure is seeded: the fixture's half-built
// Cedar Cafe is resumed for real, and this Studio's model answers nothing, so the build stops as a real one does.
const FAIL = 'A build that fails, and the fix'
const fail = env => flowStudio(env, 'fail')
// a real build: the next version of a half-built one, its builders kept waiting on the model
async function resumeHeld(s, from) {
  holdBuild(s.ctl)
  const r = await s.api(`/api/runs/${from}/resume`, {})
  if (!r.run || r.error) { letBuild(s.ctl); throw new Error(`the build did not resume: ${r.error || 'no run'}`) }
  return r.run
}
async function ended(env, s, run) {
  for (let i = 0; i < 50; i++) {
    const ev = await s.api(`/api/runs/${run}/events`).catch(() => [])
    if (Array.isArray(ev) && ev.some(e => e.type === 'run:stopped' || e.type === 'run:done')) return
    await env.wait(300)
  }
  throw new Error('the build neither stopped nor finished in 15 s')
}
// the Studio with a build that has really failed (when the steps before this one were left out, it fails here)
async function failed(env) {
  const s = await fail(env)
  if (!s.failed) { s.failed = await resumeHeld(s, s.ids.mid); letBuild(s.ctl) }
  if (!s.over) { await ended(env, s, s.failed); s.over = true }
  return s
}

// What a screen may never say of a build that failed (the owner, 2026-11-15: the app only says what really
// happened): that it is built, or, where `raw` is checked, a provider's raw error in place of a plain reason.
// The Log, Fix mode and a planner's own error line still print the raw error (B16, B10 in docs/ux/states/build.md),
// so `raw` is checked only on the screens that have none of those.
async function truth(env, { within = 'body', raw = false } = {}) {
  const text = await env.page.locator(within).first().innerText().catch(() => '')
  const built = text.match(/All \d+ pages? (?:is|are) built/)
  if (built) throw new Error(`a failed build reads "${built[0]}"`)
  if (raw && text.includes('HTTP 500')) throw new Error(`a failed build shows the provider's raw error ("HTTP 500") in ${within}`)
}
// the Design deck of a build that is not whole: the strip and the chat say the same, and the chat has the way on
// (the strip is set in capitals by its style, so its words are matched whatever their case)
async function deckTruth(env, word = /Partly built|Failed|Stopped/i) {
  await truth(env, { within: '#feed', raw: true })
  const strip = await env.page.locator('#status').first().innerText().catch(() => '')
  if (!word.test(strip)) throw new Error(`the strip reads "${strip.replace(/\s+/g, ' ').trim()}" for a build that is not whole`)
  if (/pages built|Ready/i.test(strip)) throw new Error(`the strip reads "${strip.replace(/\s+/g, ' ').trim()}" for a build that is not whole`)
  if (!(await chatBtn(env.page, 'Resume').isVisible().catch(() => false))) throw new Error('the chat of a build that is not whole offers no Resume')
}

const FAILING = [
  { id: 'f-fail-working', flow: FAIL, title: 'A build going on, live (the fixture’s half-built Cedar Cafe, resumed; the model has not answered its builders yet)', run: async env => {
    const s = await fail(env)
    s.failed = await resumeHeld(s, s.ids.mid)
    await deck(env, s, s.failed)
    await env.wait(2500)
  } },
  { id: 'f-fail-live', flow: FAIL, title: 'The model answers nothing: what the deck and the chat say as it happens', run: async env => {
    const s = await fail(env)
    if (!s.failed) throw new Error('the live build was not started (run f-fail-working first)')
    letBuild(s.ctl)
    await ended(env, s, s.failed); s.over = true
    await env.wait(1500)
    await chatOpen(env)
    await toEnd(env.page)
    await deckTruth(env, /Partly built/i)
  }, settle: 900 },
  { id: 'f-fail-projects', flow: FAIL, title: 'Projects after the build failed: its card', run: async env => { const s = await failed(env); await go(env, s); await env.wait(800); await truth(env, { raw: true }) }, settle: 1200 },
  { id: 'f-fail-overview', flow: FAIL, title: 'The failed build’s Overview', run: async env => {
    const s = await failed(env)
    await go(env, s, `/?project=${s.ids.mid}&version=${s.failed}`, '.pj-world')
    // a page whose sections failed says so, with Resume, and Resume can be pressed (nothing lies over it)
    await vis(env.page, '.pj-world .ab.page > .pt-tag', 12000)
    const tag = await env.page.locator('.pj-world .ab.page > .pt-tag').first().innerText()
    if (!/Failed/i.test(tag)) throw new Error(`a page with failed sections is tagged "${tag.replace(/\s+/g, ' ').trim()}"`)
    const pressable = await env.page.locator('.pj-world .ab.page > [data-resume]').first().evaluate(b => { const r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-resume]') === b })
    if (!pressable) throw new Error('Resume on a failed page’s artboard is covered by something else')
    await truth(env, { raw: true })
  }, settle: 2500 },
  { id: 'f-fail-overview-resume', flow: FAIL, title: 'Resume pressed on a failed page’s artboard: the build goes on in the Overview (the model has not answered yet)', run: async env => {
    const s = await failed(env)
    const before = (await s.api('/api/runs')).length
    holdBuild(s.ctl)
    await env.page.locator('.pj-world .ab.page > [data-resume]').first().click()
    // the next version is the one shown, and nothing of it has failed: the tags are gone while it builds
    await env.page.locator('.pj-world .ab.page > .pt-tag').first().waitFor({ state: 'detached', timeout: 12000 })
    let started = false
    for (let i = 0; i < 20 && !started; i++) { started = (await s.api('/api/runs')).length > before; if (!started) await env.wait(300) }
    if (!started) throw new Error('Resume was pressed on the Overview and no build started')
    await env.wait(1500)
  }, settle: 1500, after: env => letBuild(env.fs?.ctl) },
  { id: 'f-fail-deck', flow: FAIL, title: 'The failed build opened again in the Design deck: the deck and its chat', run: async env => { const s = await failed(env); await deck(env, s, s.failed); await env.wait(1200); await toEnd(env.page); await deckTruth(env, /Partly built/i) }, settle: 2000 },
  { id: 'f-fail-log', flow: FAIL, title: 'The chat’s Log for the failed build', run: async env => { await failed(env); await click(env.page, '.side .tabs [data-tab="log"]'); await truth(env) }, settle: 800 },
  { id: 'f-fail-fix', flow: FAIL, title: 'Fix mode ("/fix", then "Why did the build stop?"): what Fix says, from the Studio’s own facts (no model answers here)', run: async env => {
    const s = await failed(env)
    await deck(env, s, s.failed)
    await send(env, '/fix')
    await env.wait(400)
    await send(env, 'Why did the build stop?')
    await vis(env.page, '#feed .fix-reply', 20000)
    await toEnd(env.page)
    await truth(env)
  }, settle: 900 },
  { id: 'f-fail-fix-resume', flow: FAIL, title: 'Finish the build (or Resume) pressed from the failed build opened again', run: async env => {
    const s = await failed(env)
    // the chat's own Resume, said when the failed build was opened again (not only what Fix offers)
    const b = chatBtn(env.page, 'Resume')
    if (!(await b.isVisible().catch(() => false))) {
      const offered = await env.page.locator('#feed .fix-reply button').allInnerTexts().catch(() => [])
      throw new Error(`a failed build opened again offers no Resume in its chat; Fix offers: ${offered.map(t => `"${t.trim()}"`).join(', ') || 'no button'}`)
    }
    const before = (await s.api('/api/runs')).length
    await b.click()
    await env.wait(5000)
    // Resume really started a build: a new version, which this Studio's model fails again, said as it is
    if ((await s.api('/api/runs')).length <= before) throw new Error('Resume was pressed and no build started')
    await toEnd(env.page)
    await truth(env)
  } },
  { id: 'f-fail-stop-opened', flow: FAIL, title: 'The same build going again, opened by its address, and Stop pressed: the chat ten seconds on', run: async env => {
    const s = await failed(env)
    await env.wait(1500)
    s.again = await resumeHeld(s, s.failed)
    await deck(env, s, s.again)
    await env.wait(2000)
    await click(env.page, '.work-stop')
    await env.wait(10000)
    letBuild(s.ctl)
    await toEnd(env.page)
    await truth(env)
  }, after: env => letBuild(env.fs?.ctl) },
  { id: 'f-fail-stop', flow: FAIL, title: 'Stop pressed in a window that follows the build as the one that started it (handed the build through the Studio’s own hook, as Make hands a new one): what is kept, and Resume', run: async env => {
    const s = await failed(env)
    await env.wait(1500)
    const run = await resumeHeld(s, s.again || s.failed)
    await go(env, s)
    await env.page.evaluate(id => window.swarmCosmos.started(id, { room: 'deck' }), run)
    await vis(env.page, '#viewport', 10000)
    await env.wait(2500)
    await click(env.page, '.work-stop')
    await chatBtn(env.page, 'Resume').waitFor({ state: 'visible', timeout: 12000 })
    letBuild(s.ctl)
    await toEnd(env.page)
    await truth(env)
  }, settle: 1200, after: env => letBuild(env.fs?.ctl) },
  { id: 'f-fail-resume', flow: FAIL, title: 'Resume pressed: the build goes on (the model has not answered yet)', run: async env => {
    const s = await failed(env)
    const b = chatBtn(env.page, 'Resume')
    if (!(await b.isVisible().catch(() => false))) throw new Error('no Resume in the chat (the Stop step before this one did not reach it)')
    holdBuild(s.ctl)
    await b.click()
    await env.wait(4000)
    await toEnd(env.page)
  } },
  { id: 'f-fail-resume-end', flow: FAIL, title: 'The model fails the resumed build too: what the chat says, live', run: async env => {
    const s = await failed(env)
    if (!s.ctl.buildHold) throw new Error('Resume was not reached, so there is no resumed build to end')
    letBuild(s.ctl)
    await env.wait(7000)
    await toEnd(env.page)
    await deckTruth(env, /Partly built/i)
  }, after: env => letBuild(env.fs?.ctl) },
  { id: 'f-fail-new', flow: FAIL, title: 'A new build whose model fails at the start: the chat says why, with Try again', run: async env => {
    const s = await failed(env)
    await env.wait(1500)
    await go(env, s)
    await makeMenu(env, 'Harbor Bakery, a bakery by the docks')
    await justMake(env)
    await env.page.locator('#feed [data-pick="go:all"]').last().click()
    await chatBtn(env.page, 'Try again').waitFor({ state: 'visible', timeout: 15000 })
    await toEnd(env.page)
    await truth(env)
    // stopped before any page: the strip says Stopped, never Ready
    const strip = await env.page.locator('#status').first().innerText().catch(() => '')
    if (!/Stopped/i.test(strip)) throw new Error(`the strip reads "${strip.replace(/\s+/g, ' ').trim()}" for a build that stopped at the start`)
  }, settle: 900 },
  { id: 'f-fail-try-again', flow: FAIL, title: 'Try again pressed: the same build starts again (the model has not answered yet)', run: async env => {
    const s = await failed(env)
    const before = (await s.api('/api/runs')).length
    // the model is kept waiting, so the picture shows the build that started, not its next failure
    holdBuild(s.ctl)
    await chatBtn(env.page, 'Try again').click()
    await seen(env.page, /Planning the pages/, 15000)
    await env.wait(1500)
    const text = await env.page.locator('#feed').innerText()
    if (/Couldn.t start it again/.test(text)) throw new Error('Try again answered "Couldn’t start it again"')
    if ((await s.api('/api/runs')).length <= before) throw new Error('Try again was pressed and no build started')
    const strip = await env.page.locator('#status').first().innerText().catch(() => '')
    if (!/Planning the pages/i.test(strip)) throw new Error(`the strip reads "${strip.replace(/\s+/g, ' ').trim()}" while the build that started again plans`)
    await toEnd(env.page)
  }, after: endFlow }
]

// ---------- 6. research and tools from the chat: the planner calls a tool, the chat shows what it found as cards,
// and one is kept. The asset library is given a small pack of the person's own (four cups), as a person would
// import one; the web tools go through Hermes, which the throwaway Studio does not have.
const TOOLS = 'Research and tools from the chat (planner scripted)'
// a small flat picture, so the cards show something
function png(rgb, size = 96) {
  const { deflateSync, crc32 } = process.getBuiltinModule('node:zlib')
  const chunk = (type, data) => { const b = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(b) >>> 0); return Buffer.concat([len, b, crc]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 2
  const row = Buffer.alloc(1 + size * 3), rows = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) { const inCup = y > size * 0.3 && y < size * 0.8 && x > size * 0.25 && x < size * 0.75; const c = inCup ? rgb : [24, 24, 26]; row[1 + x * 3] = c[0]; row[2 + x * 3] = c[1]; row[3 + x * 3] = c[2] }
    rows.push(Buffer.from(row))
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
const toolSay = ask => {
  const t = lastOf(ask)
  const find = /find me an? ([a-z]+)/i.exec(t)
  if (find) return `I'll look in the asset library.\n{"tool": "library_search", "args": {"q": "${find[1].toLowerCase()}"}}`
  if (/search the web/i.test(t)) return 'I\'ll search the web.\n{"tool": "web_search", "args": {"q": "how nurses swap shifts"}}'
  return 'Say what to look for.'
}
async function tools(env) {
  const s = await flowStudio(env, 'tools', { talk: toolSay })
  if (s.pack) return s
  const dir = mkdtempSync(join(tmpdir(), 'walk-cups-'))
  mkdirSync(join(dir, 'props'))
  for (const [n, c] of [['clay_cup', [176, 112, 80]], ['glass_cup', [190, 200, 205]], ['paper_cup', [232, 226, 210]], ['tin_cup', [130, 134, 140]]]) writeFileSync(join(dir, 'props', `${n}.png`), png(c))
  const made = await s.api('/api/library/import', { path: dir, name: 'Cafe Things', credit: 'Ana', license: 'CC0' })
  if (made?.error) throw new Error(`the pack was not imported: ${made.error}`)
  s.pack = dir
  return s
}

const TOOLING = [
  { id: 'f-tools-thinking', flow: TOOLS, title: '"Find me a cup picture for the Plans page?" in a built site’s chat: Hermia thinking', run: async env => {
    const s = await tools(env)
    await deck(env, s, s.ids.site2)
    hold(s.ctl)
    await send(env, 'Find me a cup picture for the Plans page')
    await env.wait(2200)
    await toEnd(env.page)
  } },
  { id: 'f-tools-cards', flow: TOOLS, title: 'She used the asset library: what it found, as cards with their source and Keep this (the pack is four flat test pictures)', run: async env => {
    const s = await tools(env)
    letGo(s.ctl)
    await vis(env.page, '.chat-cards [role="listitem"]', 15000)
    await toEnd(env.page)
  }, settle: 1200 },
  { id: 'f-tools-kept', flow: TOOLS, title: 'Keep this pressed on one card: Done, and where it went', run: async env => {
    await tools(env)
    await env.page.locator('.chat-cards [data-pick]').first().click()
    await vis(env.page, '.chat-card-done', 10000)
    await env.wait(800)
    await toEnd(env.page)
  } },
  { id: 'f-tools-refs', flow: TOOLS, title: 'The project’s Overview after the keep: the picture in References', run: async env => {
    const s = await tools(env)
    await go(env, s, `/?project=${s.ids.site}&version=${s.ids.site2}`, '.pj-world')
    await env.wait(1500)
    await tap(env.page, '[data-tool="files"]')
  }, settle: 1500 },
  { id: 'f-tools-none', flow: TOOLS, title: 'A search that finds nothing: "Find me a dragon picture"', run: async env => {
    const s = await tools(env)
    await deck(env, s, s.ids.site2)
    await send(env, 'Find me a dragon picture')
    await seen(env.page, /Nothing in the asset library/)
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-tools-web', flow: TOOLS, title: 'The planner asks for a tool this chat does not offer (web search is offered in an app’s talk only): what the chat says', run: async env => {
    const s = await tools(env)
    await deck(env, s, s.ids.site2)
    await send(env, 'Search the web for how other tea subscriptions show their plans')
    await chatBtn(env.page, 'Build').waitFor({ state: 'visible', timeout: 20000 })
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-tools-web-app', flow: TOOLS, title: 'An app’s talk (Make › App › Just make it › Keep talking): the planner searches the web, with no Hermes to search through', run: async env => {
    const s = await tools(env)
    await go(env, s)
    await click(env.page, '.hm-kind'); await click(env.page, '.hm-menu [data-k="app"]')
    await env.page.locator('.home input').first().fill('An app where nurses swap shifts')
    await env.page.locator('.hm-make').first().click()
    await env.page.locator('.hm-menu button', { hasText: 'Just make it' }).first().click()
    await vis(env.page, '.talk-brief [data-more]', 15000)
    await env.page.locator('.talk-brief [data-more]').first().click()
    await send(env, 'Search the web for how nurses swap shifts today')
    await chatBtn(env.page, 'Build').waitFor({ state: 'visible', timeout: 20000 })
    await toEnd(env.page)
  }, settle: 900 },
  { id: 'f-tools-research', flow: TOOLS, title: 'Research before a build: what it found, shown before the crew uses it', run: async env => {
    const s = await tools(env)
    const r = await fetch(`${s.BASE}/api/run`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-swarm-token': 'walkthrough' }, body: JSON.stringify({ brief: 'Research how tea subscription sites show their plans, then add a comparison page', from: s.ids.site2, research: true }) })
    const j = await r.json().catch(() => ({}))
    if (!(r.status === 409 && j.error === 'research')) throw new Error(`research found nothing to show (it needs Hermes’s web search, which the throwaway Studio does not have): the build answered ${r.status}${j.error ? ` ${j.error}` : ''} and went on without it`)
    await deck(env, s, s.ids.site2)
  }, after: endFlow }
]

// A flow's Studio ends after the last of its steps that this run takes (the runner's --steps may leave the flow's
// own last step out, and a Studio left running keeps the runner from ending)
const picked = (() => { const i = process.argv.indexOf('--steps'); return i > 0 && process.argv[i + 1] ? process.argv[i + 1].split(',') : null })()
function closing(steps) {
  const last = steps.filter(s => !picked || picked.includes(s.id)).at(-1)
  return steps.map(s => (s !== last ? s : { ...s, after: async env => { try { await s.after?.(env) } finally { endFlow(env) } } }))
}
export const FLOW_STEPS = [WEBSITE, APPCHAT, CHANGE, FIRSTBUILD, FAILING, TOOLING].flatMap(closing)
