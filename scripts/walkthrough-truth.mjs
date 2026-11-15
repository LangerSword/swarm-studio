// The walkthrough's truth steps (docs/ux/states/chat-turn.md, holes C3 and C10; engine/chatstep.mjs): a website's
// and an app's chat say only what is true, and typed words do what the buttons do. Each step reaches the state on
// a throwaway Studio (scripts/walkthrough-fixtures.mjs) whose planner this file scripts to LIE, and asserts what
// the page then shows: a step that passes is a picture of the truth, and one that fails says what was false.
import { studio } from './walkthrough-fixtures.mjs'

const vis = (page, sel, timeout = 8000) => page.locator(sel).first().waitFor({ state: 'visible', timeout })
const tap = async (page, sel) => { const l = page.locator(sel).first(); if (await l.isVisible().catch(() => false)) await l.click({ timeout: 2000 }).catch(() => {}) }
async function chatOpen(env) {
  const { page } = env
  if (!(await page.locator('#brief').first().isVisible().catch(() => false))) { await tap(page, '.cosmos-chatbtn'); await tap(page, '.pj-dock [data-tool="comment"]') }
  await vis(page, '#brief')
}
async function send(env, text) { await chatOpen(env); await env.page.locator('#brief').fill(text); await env.page.locator('#brief').press('Enter') }
const toEnd = page => page.evaluate(() => { const f = document.querySelector('#feed'); if (f) f.scrollTop = f.scrollHeight })
const seen = (page, re, timeout = 10000) => page.locator('#feed').getByText(re).last().waitFor({ state: 'visible', timeout })
const feedText = page => page.locator('#feed').innerText()
const posted = (page, re, timeout) => page.waitForResponse(r => re.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout }).catch(() => null)

// the planner that lies: whatever is asked, it says the site is built and live (the talk and Ask mode both)
const LIE = 'Good news: all 3 pages are built and the site is live. Should the booking form ask for a phone number?'
const sysOf = ask => String(ask.messages?.[0]?.content || '')
function liar(ctl) {
  return async ask => {
    const s = sysOf(ask)
    // a message typed into a project's dock is read first: a question is a talk, the rest a build
    if (/^A person typed this into the box/.test(s)) return /\?\s*$/.test(String(ask.messages?.at(-1)?.content || '')) ? 'talk' : 'build'
    if (/^You are Hermia, the planner/.test(s)) { ctl.talks++; return LIE }
    return null
  }
}
async function truthStudio(env) {
  if (env.fs?.key === 'truth') return env.fs
  try { env.fs?.stop() } catch {}
  const ctl = { talks: 0 }
  const s = await studio({ model: liar(ctl) })
  await s.api('/api/setup', { seen: true })
  env.fs = { ...s, key: 'truth', ctl }
  return env.fs
}
const endTruth = env => { try { env.fs?.stop() } catch {} env.fs = null }
const TRUTH = 'The chat says only what is true (planner scripted to lie)'
// the fixture's Cedar Cafe: caught mid-build, about half its sections built, nobody building it
const deckOf = async (env, s, run) => { await env.page.goto(`${s.BASE}/?version=${run}&room=deck`); await vis(env.page, '#viewport', 15000); await env.wait(900); await chatOpen(env) }

export const TRUTH_STEPS = [
  { id: 't-lie-partly', flow: TRUTH, title: 'A partly built site; the planner answers "all 3 pages are built and the site is live": the chat shows her question, the build’s real state in place of the lie, and Resume', run: async env => {
    const s = await truthStudio(env)
    await deckOf(env, s, s.ids.mid)
    await send(env, 'Could people book a table on it?')
    await seen(env.page, /Should the booking form ask for a phone number\?/, 15000)
    const text = await feedText(env.page)
    if (/all 3 pages are built|site is live/i.test(text)) throw new Error('the planner’s false sentence is in the chat')
    if (!/of 9 sections are built and kept/.test(text)) throw new Error('the build’s own state is not said in place of the lie')
    await env.page.locator('#feed .talk-acts button', { hasText: 'Resume' }).last().waitFor({ state: 'visible', timeout: 5000 })
    if (!s.ctl.talks) throw new Error('the planner was never asked, so this step did not test its lie')
    await toEnd(env.page)
  }, settle: 900 },
  { id: 't-how-far', flow: TRUTH, title: '"How far is the build?" on the same site: the build’s one state answers, the planner (who would lie) is not asked', run: async env => {
    const s = await truthStudio(env)
    const before = s.ctl.talks
    await send(env, 'How far is the build?')
    await env.wait(2500)
    const text = await feedText(env.page)
    if (s.ctl.talks !== before) throw new Error('the planner was asked a question the build’s state answers')
    if ((text.match(/of 9 sections are built and kept/g) || []).length < 2) throw new Error('the state’s line is not the answer')
    if (/all 3 pages are built|site is live/i.test(text)) throw new Error('a false sentence is in the chat')
    await toEnd(env.page)
  }, settle: 900 },
  { id: 't-question-no-act', flow: TRUTH, title: '"Should I resume it?": a question never presses a button; nothing is resumed and Hermia answers', run: async env => {
    const s = await truthStudio(env)
    const before = s.ctl.talks
    const went = posted(env.page, /\/resume$/, 4000)
    await send(env, 'Should I resume it?')
    if (await went) throw new Error('a question resumed the build')
    if (s.ctl.talks !== before + 1) throw new Error('the question did not reach the planner')
    await env.page.locator('#feed .talk-acts button', { hasText: 'Resume' }).last().waitFor({ state: 'visible', timeout: 5000 })
    await toEnd(env.page)
  }, settle: 900 },
  { id: 't-resume-typed', flow: TRUTH, title: '"resume" typed: the same as pressing Resume; the server resumes the build (its model then gives no answer, as in this Studio)', run: async env => {
    const s = await truthStudio(env)
    const before = s.ctl.talks
    const went = posted(env.page, /\/resume$/, 12000)
    await send(env, 'resume')
    const res = await went
    if (!res) throw new Error('"resume" typed did not ask the server to resume the build')
    if (res.status() !== 200) throw new Error(`the server refused to resume: ${res.status()}`)
    if (s.ctl.talks !== before) throw new Error('the planner was asked instead of the action being run')
    await env.wait(3000)
    await toEnd(env.page)
  }, settle: 900 },
  { id: 't-app-build-typed', flow: TRUTH, title: '"build the app" typed in the App room of a designed app: the same as pressing Build the app (Hermia starts reading the pages)', run: async env => {
    const s = await truthStudio(env)
    await env.page.goto(`${s.BASE}/?version=${s.ids.app}&room=app`)
    await vis(env.page, '#appview', 15000)
    await env.wait(1200)
    const went = posted(env.page, /\/advise$/, 12000)
    await send(env, 'build the app')
    if (!(await went)) throw new Error('"build the app" typed did not start what the Build the app button starts')
    const text = await feedText(env.page)
    if (!/build the app/.test(text)) throw new Error('the person’s words are not in the chat')
    if (/Build the app first/.test(text)) throw new Error('the chat answers "Build the app first"')
    await env.wait(2000)
  }, settle: 900 },
  { id: 't-app-question-no-act', flow: TRUTH, title: '"Should I build the app?" in the same room: a question starts nothing; the chat says the app is not built and how to build it', run: async env => {
    const s = await truthStudio(env)
    await env.page.goto(`${s.BASE}/?version=${s.ids.app}&room=app`)
    await vis(env.page, '#appview', 15000)
    await env.wait(1200)
    const went = posted(env.page, /\/(advise|app)$/, 4000)
    await send(env, 'Should I build the app?')
    if (await went) throw new Error('a question started the app build')
    await seen(env.page, /The app is not built yet\. Say “build the app” to build it/)
    await toEnd(env.page)
  }, settle: 900, after: endTruth }
]
