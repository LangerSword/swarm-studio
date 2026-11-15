// The walkthrough's chat states (docs/ux/walkthrough): the planner's chat as a person meets it, state by
// state, on a second throwaway Studio that holds a real game plan and its chat (tests/fixtures/rank-juggler)
// and a planner this file scripts: it can answer, keep the person waiting, or fail. The painter is the
// Studio's own, and the throwaway Studio has none, so "Paint" shows the failure a person would see.
// These steps come after the others (scripts/walkthrough-steps.mjs), so no earlier picture is renumbered.
//
//   WALK_PLAN_FILES=<folder>   the plan's pictures (its sketch sheets), copied in so the sheet shows; without
//                              it the sheet's place is empty
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { studio } from './walkthrough-fixtures.mjs'

const FIX = fileURLToPath(new URL('../tests/fixtures/rank-juggler/', import.meta.url))
const PLAN = 'p-44c1061860'
const FLOW = 'Game plan chat'
const vis = (page, sel, timeout = 8000) => page.locator(sel).first().waitFor({ state: 'visible', timeout })
const said = text => JSON.stringify({ say: text, decide: {}, ask: null })

// the Studio with that plan, its chat open beside the board (opened from Recent, as a person would)
async function night(env) {
  if (env.night) return env.night
  const ctl = { reply: said('Three heroes, and the first one carries the fight.'), hold: null, fail: false }
  const s = await studio({
    setup: ({ runs }) => {
      const data = dirname(runs)
      cpSync(FIX, data, { recursive: true })
      const pics = process.env.WALK_PLAN_FILES
      if (pics && existsSync(pics)) { mkdirSync(join(data, 'plans', PLAN), { recursive: true }); cpSync(pics, join(data, 'plans', PLAN), { recursive: true }) }
    },
    model: async () => { if (ctl.hold) await ctl.hold; return ctl.fail ? null : ctl.reply }
  })
  env.night = { ...s, ctl }
  const { page } = env
  await page.goto(s.BASE + '/')
  await page.locator('.su-start, .ui-dialog-close').first().click({ timeout: 8000 }).catch(() => {})
  await vis(page, '.home', 15000)
  await page.locator('.card[data-id]', { hasText: 'Rank Juggler' }).first().click()
  await vis(page, '.project.plan')
  await vis(page, '#brief')
  await env.wait(900)
  return env.night
}
const endNight = env => { env.night?.stop(); env.night = null }
async function say(env, text) {
  await env.page.locator('#brief').fill(text)
  await env.page.locator('#brief').press('Enter')
}
// the newest button in the chat with this label
const press = (page, label) => page.locator('.talk-acts button', { hasText: label }).last().click({ timeout: 8000 })
const lastTurn = (page, re, timeout = 10000) => page.locator('#feed, .feed, .chat').locator(`text=${re}`).last().waitFor({ state: 'visible', timeout })

export const CHAT_STEPS = [
  { id: 'gc-open', flow: FLOW, title: 'A game plan opened from Recent: its chat beside the board', run: env => night(env), settle: 1200 },
  { id: 'gc-thinking', flow: FLOW, title: 'Hermia thinking (the answer has not come yet)', run: async env => {
    const n = await night(env)
    n.ctl.hold = new Promise(r => { n.ctl.release = r })
    await say(env, 'who are the characters?')
    await env.wait(1500)
  } },
  { id: 'gc-answer', flow: FLOW, title: 'The answer, then the real next step as buttons', run: async env => {
    const n = await night(env)
    n.ctl.release?.(); n.ctl.hold = null
    await vis(env.page, '.talk-acts button >> text=/Lock/')
  }, settle: 900 },
  { id: 'gc-locked', flow: FLOW, title: 'Lock pressed: the plan locks, the board says Build, the chat asks about Godot', run: async env => {
    await night(env)
    await press(env.page, 'Lock')
    await vis(env.page, '.talk-acts button >> text=/Browser is fine/')
  }, settle: 1200 },
  { id: 'gc-godot', flow: FLOW, title: 'Install Godot 4 pressed and it is still missing: what really happened', run: async env => {
    await night(env)
    await press(env.page, 'Install Godot 4')
    await env.wait(2500)
  } },
  { id: 'gc-sheet', flow: FLOW, title: 'Browser is fine: the sketch sheet in the chat, waiting on picks', run: async env => {
    await night(env)
    await press(env.page, 'Browser is fine')
    await vis(env.page, '.talk-sheet')
  }, settle: 1500 },
  { id: 'gc-picks', flow: FLOW, title: 'Picks typed in words: "hero 1 is 4, hero 2 is 7, hero 3 is 12"', run: async env => {
    await night(env)
    await say(env, 'hero 1 is 4, hero 2 is 7, hero 3 is 12')
    await env.wait(3000)
  } },
  { id: 'gc-nothing', flow: FLOW, title: 'A paint button with no painter: "Nothing happened", and why', run: async env => {
    await night(env)
    const b = env.page.locator('.talk-acts button', { hasText: /Paint|Go on|Draw/ }).last()
    await b.click({ timeout: 8000 })
    await env.wait(3000)
  } },
  { id: 'gc-state', flow: FLOW, title: 'A question about the real state: "what is going on?"', run: async env => {
    const n = await night(env)
    n.ctl.reply = said('The plan is locked and everything is painted.')
    await say(env, 'what is going on?')
    await env.wait(3500)
  } },
  { id: 'gc-no-answer', flow: FLOW, title: 'The planner does not answer: what the chat says', run: async env => {
    const n = await night(env)
    n.ctl.fail = true
    await say(env, 'make hero 2 taller')
    await env.wait(4000)
    // the failure is said, in plain words, with the one way forward; the provider's text is never in the chat
    const text = await env.page.locator('#feed').first().innerText().catch(() => '')
    const raw = text.match(/HTTP \d{3}|\{"error"|ECONN|\[object Object\]|undefined/)
    if (raw) throw new Error(`a raw error ("${raw[0]}") is shown in the chat`)
    if (!/The model didn.t answer/.test(text)) throw new Error('the chat does not say the planner\'s model did not answer')
    if (!(await env.page.locator('#feed .fail-turn button', { hasText: 'Try again' }).last().isVisible().catch(() => false))) throw new Error('no Try again under the failed turn')
  }, after: endNight }
]
