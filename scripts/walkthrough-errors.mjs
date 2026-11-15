// The walkthrough's failure turns put right (docs/ux/states/README.md, root 4): a turn the planner's model did not
// answer says why in plain words with ONE way forward, and that way really works. Each step runs on a throwaway
// Studio whose planner this file scripts (scripts/walkthrough-flows.mjs): it fails, then answers. The words the
// planner says once it answers are this file's; what the Studio does around them is its own.
import { flowStudio, endFlow, closing, newChat, deck, send, toEnd, chatBtn, seen, stopped, letBuild, noRaw, oneWay } from './walkthrough-flows.mjs'

const FLOW = 'A failed turn, and its one way forward (planner scripted)'
const IDEA = 'A site for my bike repair shop in Leeds. What should it have?'
const REPLY = 'Four pages would cover it: Home, Repairs and prices, Book a repair, and Find us. Do you want prices listed, or a "from" price for each kind of repair?'
const CHANGE = 'Add a page for corporate gift orders'
const talkStudio = env => flowStudio(env, 'e-talk', { talk: null, brief: null, ask: null })
const changeStudio = env => flowStudio(env, 'e-change', {})
const count = (page, sel, text) => page.locator(sel, { hasText: text }).count()
// the idea sent in a new chat, the planner's model failing: the reason, and only Try again
async function failedTalk(env) {
  const s = await talkStudio(env)
  if (s.asked) return s
  s.ctl.talk = null
  await newChat(env, s)
  await send(env, IDEA)
  await seen(env.page, /The model didn.t answer/, 15000)
  s.asked = true
  return s
}

const STEPS = [
  { id: 'e-talk-failed', flow: FLOW, title: 'The planner’s model does not answer a new chat: the reason, and Try again alone (no Build)', run: async env => {
    await failedTalk(env)
    await toEnd(env.page)
    await noRaw(env, { must: /The model didn.t answer \(no model here\)/, not: /\bBuild\b/ })
    await oneWay(env, 'Try again')
    // not Hermia's words: the line has no speaker
    if (await env.page.locator('#feed .item.bot', { hasText: 'didn’t answer' }).count() || await env.page.locator('#feed .item.bot', { hasText: "didn't answer" }).count()) throw new Error('the failure is shown as Hermia speaking')
  } },
  { id: 'e-talk-try-again', flow: FLOW, title: 'Try again pressed, the model now answering: the same message is asked again and Hermia answers it', run: async env => {
    const s = await failedTalk(env)
    const before = s.ctl.calls.filter(c => c === 'talk').length
    s.ctl.talk = REPLY
    await chatBtn(env.page, 'Try again').click()
    await seen(env.page, /Four pages would cover it/, 15000)
    await toEnd(env.page)
    if (s.ctl.calls.filter(c => c === 'talk').length !== before + 1) throw new Error('Try again did not ask the planner again')
    // the same message, once: nothing is typed twice, and the error's button is gone
    if (await count(env.page, '#feed .item.you', 'bike repair shop') !== 1) throw new Error('the message is in the chat more than once after Try again')
    if (await chatBtn(env.page, 'Try again').isVisible().catch(() => false)) throw new Error('Try again is still offered after the answer')
    await noRaw(env, { must: /Four pages would cover it/ })
    await oneWay(env, 'Build')
  } },
  { id: 'e-talk-try-typed', flow: FLOW, title: 'The next message fails too, and “try again” is typed: the same message is asked again', run: async env => {
    const s = await failedTalk(env)
    s.ctl.talk = null
    await send(env, 'List the prices, with a from price for each.')
    await seen(env.page, /The model didn.t answer/, 15000)
    const before = s.ctl.calls.filter(c => c === 'talk').length
    s.ctl.talk = 'Then Repairs and prices lists each repair with its "from" price, and Book a repair takes the bike and a day.'
    await send(env, 'try again')
    await seen(env.page, /Then Repairs and prices lists/, 15000)
    await toEnd(env.page)
    if (s.ctl.calls.filter(c => c === 'talk').length !== before + 1) throw new Error('typing "try again" did not ask the planner again')
    await noRaw(env)
  } },
  { id: 'e-change-failed', flow: FLOW, title: 'A change the model does not answer: “Nothing was added”, why, and Try again (no Play prototype)', run: async env => {
    const s = await changeStudio(env)
    await deck(env, s, s.ids.site2)
    await send(env, CHANGE)
    letBuild(s.ctl)
    await stopped(env.page)
    await toEnd(env.page)
    await noRaw(env, { must: /Nothing was added\. The model didn.t answer/, not: /Play prototype|Watch a visitor/ })
    await oneWay(env, 'Try again')
    s.changed = true
  }, settle: 1200 },
  { id: 'e-change-try-again', flow: FLOW, title: 'Try again pressed on the failed change: the same change is sent again as the next version', run: async env => {
    const s = await changeStudio(env)
    if (!s.changed) throw new Error('the failed change was not reached')
    const before = (await s.api('/api/runs')).length
    await chatBtn(env.page, 'Try again').click()
    let started = false
    for (let i = 0; i < 30 && !started; i++) { started = (await s.api('/api/runs')).length > before; if (!started) await env.wait(300) }
    if (!started) throw new Error('Try again was pressed on a failed change and no build started')
    const runs = await s.api('/api/runs')
    const newest = runs.map(r => r.id || r).sort().at(-1)
    const ev = await s.api(`/api/runs/${newest}/events`).catch(() => [])
    const begun = Array.isArray(ev) ? ev.find(e => e.type === 'run:start') : null
    if (!begun?.extend || !String(begun.brief || '').includes(CHANGE)) throw new Error(`the build Try again started is not the same change (${String(begun?.brief || '').slice(0, 60)})`)
    await env.wait(1500)
    await toEnd(env.page)
    await noRaw(env)
  }, after: endFlow }
]

export const ERROR_STEPS = closing(STEPS)
