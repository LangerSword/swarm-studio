// The planner conversation's routes (docs/specs/27-plan-conversation.md, engine/talkplan.mjs).
// A talk is a chat (engine/chats.mjs, spec 29 §Store): nothing is built, painted or paid for while it
// is Open. Locking a game chat makes its plan (or re-plans the one it has) and opens the Plan board.
//   GET  /api/talk                       -> { chats }  the loose chats, newest first
//   POST /api/talk { kind, said }        -> { chat, turn }  a new chat and the planner's first turn
//   GET  /api/talk/:id                   -> { chat, draft?, starts? }  draft: a game chat's plan as it stands;
//                                           starts: a locked one's parts to work on next (startsOf)
//   POST /api/talk/:id { said?, pick?, again? } -> { chat, turn, draft?, plan?, failed? }  failed: why the planner's model
//                                           did not answer this turn ({code, message, action}); again: the same words
//                                           after such a turn, which is taken back first. pick is a chip's id ("art:2d", "talk",
//                                           "lock", "do:paint"); plan: the plan an action changed (the board shows it)
//   POST /api/talk/:id/lock              -> the same as the pick "lock"
//   POST /api/talk/:id/unlock { key? }   -> { chat }
//   GET  /api/talk/plan/:planId          -> { chat, draft?, step? }  the plan's own chat (one is made for a plan with none)
//
// A game chat with a plan is one state with that plan (owner, 2026-11-14): its Lock is the Plan board's Lock (the
// gate, at the price the board shows), and every option whose label is an action runs it through the board's own
// routes (plans.act): lock, paint a sheet, pick on a sheet, paint, switch the engine. "lock", "do it" and "go" run
// the next step's first option; "hero 1 is 4, hero 2 is 7" picks on the sheet that waits. Each answer says what
// really happened, then the one next step (engine/gamestep.mjs).
// "Install Godot 4" (or "install godot" typed) installs it: only that press or those words start it, the turn waits
// on it like a painting, and when it ends the chat gets one more turn that says what happened (settle).
import { chatStore, CHAT_ID } from '../engine/chats.mjs'
import { say, lock, unlock, planInput, draftOf, startsOf, wordsDecide, openQuestions } from '../engine/talkplan.mjs'
import { nextStep, planFacts, goWords, readPicks, pieces, lockLabel, godotOptions, installLine } from '../engine/gamestep.mjs'
import { planView } from '../engine/plan.mjs'
import { starterSpec } from '../engine/starters.mjs'
import { reasonFromTalk, reasonLine, isRaw } from '../engine/stopreason.mjs'

// model() -> (messages -> text) or null; env() -> { godot }; plans.fromTalk(input, planId) -> plan view;
// plans.act(id, sub, input) -> plan view (a Plan board action); godotCheck() looks for Godot 4 again -> boolean
// env() -> { godot, install }: install is godotInstall.state(); godotInstall.start() -> a promise of the install's
// end, { ok, version, note? } or { ok: false, why } (engine/godotinstall.mjs godotJob), or null: nothing to install with
// helpers() -> the chat's tool kit (engine/helpers.mjs, decision 0025 e), or null
// the order to install, and nothing longer: "install", "install it", "install godot 4", "yes, install it"
const INSTALL = /^\s*((ok(ay)?|yes|yeah|sure|please)[,!.\s]+)*(install|download)( it| godot( 4)?| the engine)?( now| please| for me)*[\s.!]*$/i
// "try again" is that order only right after an install failed (her last turn offered Try again)
const AGAIN = /^\s*(please\s+)?try( it)? again[\s.!]*$/i
// "check again", "I installed it", "it is installed now": the person says Godot is there, so the Studio looks
const LOOKED = /\b(check(ed)?( it)? again|look again|(i|i've|i have|already|just) (just |already )?installed|(it'?s|it is|is) (already |now )?installed)\b/i

// viaHermes() -> the planner's model is reached through Hermes (a broken connection is then Hermes away)
export function talkRoutes({ dataDir, model = () => null, env = () => ({}), plans = null, godotCheck = null, godotInstall = null, helpers = () => null, viaHermes = () => false }) {
  // a game talk that joins a project takes its plan's art references there (engine/planrefs.mjs)
  const chats = chatStore({ dataDir, onMove: (chat, pid) => { if (chat?.plan) plans?.carry?.(chat.plan, pid) } })
  const json = (res, code, data) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(data))
  const body = (req, cap = 1e5) => new Promise(resolve => {
    let b = ''
    req.on('data', c => { b += c; if (b.length > cap) req.destroy() })
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')) } catch { resolve({}) } })
  })
  // A failure never goes back as it was thrown (engine/stopreason.mjs): `reason` is {code, message, action} in plain
  // words. A refusal this file words itself (it carries a status) keeps its words; anything else is read as a failed
  // call, and its own text stays in the server's log.
  const whyOf = err => {
    const text = String(err?.message || err)
    if (err?.status && !isRaw(text)) return { code: 'studio', message: `${text.charAt(0).toUpperCase()}${text.slice(1).replace(/\.$/, '')}.`, action: '' }
    console.warn('talk:', text.slice(0, 400))
    return reasonFromTalk(err, { viaHermes: viaHermes() })
  }
  const fail = (res, err) => { const reason = whyOf(err); json(res, err.status || 400, { error: reasonLine(reason), reason }) }
  // a game chat carries its plan as it stands, so the board beside the chat takes shape while they talk
  const withDraft = out => out.chat?.kind === 'game' ? { ...out, draft: planView(draftOf(out.chat, env())) } : out
  // a game chat with its plan: the real next step, from the plan file (engine/gamestep.mjs)
  const planOf = chat => chat?.kind === 'game' && chat.plan && plans?.get ? plans.get(chat.plan) : null
  const withStep = out => {
    const plan = planOf(out.chat)
    if (!plan) return out
    let step = nextStep(out.chat, plan, env())
    // an install just ended and nothing was said since: the step is the turn that says how it ended
    const last = out.chat.turns?.at(-1)
    // (only while it is still true: the success while its next step is still the plan's, the failure while the
    // Godot question is still open; the board or another chat may have moved things since)
    const holds = last?.settled === 'godot' && !step.wait && (last.text.startsWith('Nothing happened') ? step.options[0]?.id === 'do:godot' : last.text.endsWith(step.text))
    if (holds) step = { ...step, text: last.text, options: last.options || [] }
    return { ...out, step, starts: startsOf(plan) }
  }
  const turnOf = (id, input) => chats.update(id, async chat => {
    // the planner's model, heard: a call that fails is caught inside the turn (engine/talkplan.mjs goes on with the
    // plan's own next step), so the failure is kept here and goes back beside the turn as `failed`, never in the chat file
    const ask = model()
    let failed = null
    // Try again after a turn whose model failed: that turn (the person's words and the step said without the
    // model) is taken back first, so the same words are in the chat once
    const words = String(input.said || '').slice(0, 4000)
    if (input.again === true && words && chat.turns.length >= 2 && chat.turns.at(-1).who === 'planner' && chat.turns.at(-2).who === 'person' && chat.turns.at(-2).text === words) chat.turns.splice(-2)
    const heard = ask && (async messages => { try { return await ask(messages) } catch (err) { failed = err; throw err } })
    const turn = await say(chat, { said: String(input.said || '').slice(0, 4000), pick: String(input.pick || '').slice(0, 120) }, { model: heard, env: env(), plan: planOf(chat), helpers: helpers() ? { kit: helpers(), ctx: { project: chat.project || null, run: chat.run || null, plan: chat.plan || null, chat: chat.id } } : null })
    return failed ? { chat, turn, failed: whyOf(failed) } : { chat, turn }
  }).then(withDraft)

  // ---------- what a game chat's words or chip ask the server to do, or null for talk
  function actionOf(chat, { said = '', pick = '' }) {
    if (chat.kind !== 'game' || !plans?.act) return null
    if (pick === 'lock' || pick.startsWith('do:')) return pick
    const plan = planOf(chat)
    if (!said) return null
    if (!plan) return goWords(said) && chat.spec ? 'lock' : null
    const step = nextStep(chat, plan, env())
    const ids = step.options.map(o => o.id)
    // the Godot question: "check again" looks, "install" installs. "go" and "yes" never start a download: the
    // question is asked again with its buttons. While it installs, a word about it gets the line it is at.
    if (step.install && /\b(install|godot)/i.test(said)) return 'do:next'
    if (ids.includes('do:godot') && LOOKED.test(said)) return 'do:godot:check'
    if (goWords(said)) return ids[0] === 'do:godot' ? 'do:next' : ids[0] && (ids[0] === 'lock' || ids[0].startsWith('do:')) ? ids[0] : 'do:next'
    if (step.sheet && readPicks(said, step.sheet, planFacts(plan).cast).length) return 'do:typed'
    const engine = wordsDecide(said).engine
    if (ids.includes('do:browser') && engine === 'web') return 'do:browser'
    // only an order installs ("install", "install godot", "ok, install it", "try again"): a question, a "don't" or
    // the word Godot alone is talk
    const offered = [...chat.turns].reverse().find(t => t.who === 'planner')?.options || []
    if (ids.includes('do:godot') && (INSTALL.test(said) || (AGAIN.test(said) && offered.some(o => o.id === 'do:godot' && o.label === 'Try again')))) return 'do:godot'
    return null
  }

  // The plan locked, as the board's Lock does: the chat's decisions make the plan first when there is none (or they
  // changed since), then the gate locks at the price the board shows. Credits are spent only at a price the chat
  // showed in its last turn; a plan that costs pictures only locks at once.
  async function lockAll(chat, shown) {
    let plan = planOf(chat)
    let made = false
    if (!plan || chat.stale) {
      lock(chat, { env: env() })
      plan = await plans.fromTalk(planInput(chat), chat.plan)
      chat.plan = plan.id
      chat.stale = false
      if (chat.spec) chat.spec.starter = starterSpec(plan)
      made = true
    }
    if (plan.gate?.locked) return { plan, said: 'The plan was already locked.' }
    const pr = plan.price
    if (pr.credits && shown?.credits !== pr.credits) return { plan, said: `${made ? 'The plan is made. ' : ''}It costs ${pr.credits} Meshy credits${pr.images ? ` and ${pr.images} pictures` : ''}.`, ask: true }
    plan = await plans.act(plan.id, 'lock', { credits: pr.credits })
    chat.state = 'locked'
    chat.spec ||= { brief: plan.summary || '', open: [], art: [], engine: '', time: '', cost: null, lockedAt: null }
    chat.spec.lockedAt = Date.now()
    chat.spec.cost = { pictures: pr.images, credits: pr.credits }
    return { plan, said: `Locked at about ${pr.images} pictures${pr.credits ? ` and ${pr.credits} Meshy credits` : ', no credits'}.` }
  }

  // set one cell for one hero (or any pick on another sheet): the hero's old cell lets go first
  async function pickOn(plan, sheetId, cell, who) {
    const s = (plan.sheets || []).find(x => x.id === sheetId)
    if (!s) throw Object.assign(new Error('that sheet is gone'), { status: 404 })
    if (who) for (const [c, n] of Object.entries(s.notes || {})) if (n === who && Number(c) !== cell) plan = await plans.act(plan.id, 'pick', { sheet: sheetId, cell: Number(c), on: false })
    return plans.act(plan.id, 'pick', { sheet: sheetId, cell, on: true, ...(who ? { note: who } : {}) })
  }

  // run one action; returns what happened, in one sentence (or throws, and the answer says why nothing happened)
  async function perform(chat, action, said) {
    let plan = planOf(chat)
    const last = [...(chat.turns || [])].reverse().find(t => t.who === 'planner')
    if (action === 'lock') return lockAll(chat, last?.price)
    if (!plan) throw Object.assign(new Error('lock the plan first'), { status: 409 })
    if (action === 'do:next') return { plan, said: '' }
    if (action === 'do:godot' || action === 'do:godot:check') {
      // look first, both ways: a Godot the person installed themselves is used as it is
      const found = godotCheck ? !!godotCheck() : !!env().godot
      if (found) { chat.godot = 'install'; return { plan, said: 'Godot 4 is installed: the game builds as a Godot 4 project.' } }
      if (action === 'do:godot:check' || !godotInstall) return { plan, said: 'Godot 4 is still not on this computer.', godot: true }
      // the press is the yes: the install starts (or this chat joins the one running) and the turn waits on it
      const flight = godotInstall.start()
      // one that ends at once (no download for this kind of computer) is answered in this turn
      const quick = await Promise.race([flight, new Promise(r => setTimeout(r, 30, null))])
      if (quick) {
        const found = !!quick.ok && (godotCheck ? !!godotCheck() : true)
        if (found) chat.godot = 'install'
        return found ? { plan, said: installedLine(quick) } : { plan, said: failedLine(quick), godot: 'failed' }
      }
      chat.godot = 'installing'
      settle(chat.id, flight)
      return { plan, said: '' }
    }
    if (action === 'do:browser') {
      const wasLocked = !!plan.gate?.locked
      plan = await plans.act(plan.id, 'starter', { key: 'engine', value: 'web' })
      // the engine is not a price: a gate the switch reopened locks again at the same price
      if (wasLocked && !plan.gate?.locked && !plan.price.credits) plan = await plans.act(plan.id, 'lock', { credits: 0 })
      chat.godot = 'web'
      chat.decisions.engine = { value: 'web', why: 'Browser is fine', by: 'person', turn: chat.turns.at(-1)?.id || null }
      return { plan, said: 'The game builds for the browser.' }
    }
    if (action.startsWith('do:skip:')) { chat.skip = [...new Set([...(chat.skip || []), action.slice(8)])]; return { plan, said: '' } }
    if (action.startsWith('do:sheet:')) { plan = await plans.act(plan.id, 'sheet', { kind: action.slice(9) }); return { plan, said: '' } }
    if (action.startsWith('do:cell:')) {
      const [, , sheet, cell, ...who] = action.split(':')
      plan = await pickOn(plan, sheet, Number(cell), who.join(':') || null)
      return { plan, said: `Picked ${Number(cell) + 1}${who.length ? ` for ${who.join(':')}` : ''}.` }
    }
    if (action === 'do:typed') {
      const step = nextStep(chat, plan, env())
      const got = readPicks(said, step.sheet, planFacts(plan).cast)
      for (const p of got) plan = await pickOn(plan, step.sheet.id, p.cell, p.who)
      return { plan, said: `Picked ${got.map(p => `${p.cell + 1}${p.who ? ` for ${p.who}` : ''}`).join(', ')}.` }
    }
    if (action === 'do:paint') { plan = await plans.act(plan.id, pieces(plan).sub, {}); return { plan, said: '' } }
    if (action === 'do:mocks') { plan = await plans.act(plan.id, 'mocks', {}); return { plan, said: '' } }
    if (action === 'do:backdrops') {
      if (!plan.style?.locked) plan = await plans.act(plan.id, 'style', { locked: true })
      plan = await plans.act(plan.id, 'backdrops', {})
      return { plan, said: '' }
    }
    throw Object.assign(new Error('no such action'), { status: 404 })
  }

  // When the install a chat waits on ends, the chat gets the turn that says what happened: installed, with the
  // version that ran and the plan's real next step, or "Nothing happened" with the reason and the way on.
  const installedLine = r => [r.note || '', `Godot ${r.version || 4} is installed: the game builds as a Godot 4 project.`].filter(Boolean).join(' ')
  const failedLine = r => `Nothing happened: ${String(r?.why || 'Godot is installed but the Studio cannot find it').replace(/\.$/, '')}.`
  const settling = new Set()
  function settle(id, flight) {
    if (settling.has(id)) return
    settling.add(id)
    Promise.resolve(flight).then(r => chats.update(id, chat => {
      const plan = planOf(chat)
      // the person went on with the browser meanwhile, or the plan is gone: nothing more to say here
      if (chat.godot !== 'installing' || !plan) return
      const found = !!r?.ok && (godotCheck ? !!godotCheck() : true)
      if (found) chat.godot = 'install'
      else delete chat.godot
      const step = nextStep(chat, plan, env())
      const text = found ? `${installedLine(r)} ${step.text}` : failedLine(r)
      chat.turns.push({ id: `t${chat.turns.length + 1}`, who: 'planner', at: Date.now(), text, options: found ? step.options : godotOptions(true), step: true, plan: plan.id, settled: 'godot', ...(found && step.wait ? { wait: true } : {}), ...(found && step.sheet ? { sheet: step.sheet } : {}), refs: [], marks: [], layers: [], made: [], reads: [] })
    })).catch(() => {}).finally(() => settling.delete(id))
  }

  // one action from the chat: the person's turn, what happened, and the next step, in one write
  const actTurn = (id, input, action) => chats.update(id, async chat => {
    const said = String(input.said || '').slice(0, 4000).trim()
    const pick = String(input.pick || '')
    const last = [...chat.turns].reverse().find(t => t.who === 'planner')
    const label = (last?.options || []).find(o => o.id === pick)?.label || (pick === 'lock' ? 'Lock' : '')
    const now = Date.now()
    chat.turns.push({ id: `t${chat.turns.length + 1}`, who: 'person', at: now, text: said || label || pick, ...(pick ? { pick } : {}), refs: [], marks: [], layers: [] })
    let out = null, why = ''
    try { out = await perform(chat, action, said) } catch (err) { why = isRaw(err.message || err) ? `Nothing happened. ${reasonLine(whyOf(err))}` : `Nothing happened: ${String(err.message || err).replace(/\.$/, '')}.` }
    const plan = out?.plan ? (plans.get(out.plan.id) || out.plan) : planOf(chat)
    const turn = { id: `t${chat.turns.length + 1}`, who: 'planner', at: now, text: '', refs: [], marks: [], layers: [], made: [], reads: [] }
    if (!plan) {
      // no plan could be made (a question is still open): it is asked, with its options
      const q = openQuestions(chat, env())[0]
      Object.assign(turn, q ? { text: `The plan is not made yet. ${q.text}`, options: q.options } : { text: why || 'The plan is not made yet: say what to change.' })
      chat.turns.push(turn)
      return { chat, turn }
    }
    let step = nextStep(chat, plan, env())
    // the install this turn started ended in the instant since: the turn still waits, and the next look finds the
    // turn that says how it ended (settle)
    if (chat.godot === 'installing' && action.startsWith('do:godot') && !step.wait) step = { text: installLine(env().install?.state === 'installing' ? env().install : {}), options: [], wait: true, install: { pct: null } }
    if (out?.godot) step.options = godotOptions(out.godot === 'failed')
    if (out?.ask) step.options = [{ id: 'lock', label: lockLabel(plan.price), why: '', made: [] }, { id: 'talk', label: 'Keep talking', why: '', made: [] }]
    const text = [why || out?.said || '', out?.godot ? '' : step.text].filter(Boolean).join(' ')
    Object.assign(turn, { text, options: step.options, step: true, plan: plan.id, ...(step.wait ? { wait: true } : {}), ...(step.install ? { install: step.install } : {}), ...(step.sheet ? { sheet: step.sheet } : {}), ...(step.price || out?.ask ? { price: plan.price } : {}) })
    chat.turns.push(turn)
    // the chat's lock is the gate's: one state
    chat.state = plan.gate?.locked ? 'locked' : 'open'
    return { chat, turn, plan }
  })

  const routes = function handle(req, res, url) {
    if (url.pathname === '/api/talk') {
      if (req.method === 'GET') { json(res, 200, { chats: chats.listLoose() }); return true }
      if (req.method !== 'POST') { json(res, 405, { error: 'GET or POST' }); return true }
      body(req).then(async input => {
        const chat = chats.create({ kind: input.kind })
        json(res, 200, await turnOf(chat.id, input))
      }).catch(err => fail(res, err))
      return true
    }
    // a plan's own chat, for the Plan board's dock (web/planchat.js): the one that points at it, or one made for it
    const pm = url.pathname.match(/^\/api\/talk\/plan\/([^/]+)$/)
    if (pm && req.method === 'GET') {
      const plan = plans?.get?.(pm[1])
      const chat = plan && chats.forPlan(plan)
      json(res, chat ? 200 : 404, chat ? withStep(withDraft({ chat })) : { error: 'no such plan' })
      return true
    }
    const m = url.pathname.match(/^\/api\/talk\/([^/]+)(?:\/(lock|unlock))?$/)
    if (!m) return false
    if (!CHAT_ID.test(m[1])) { json(res, 404, { error: 'no such chat' }); return true }
    if (req.method === 'GET' && !m[2]) { const chat = chats.get(m[1]); json(res, chat ? 200 : 404, chat ? withStep(withDraft({ chat })) : { error: 'no such chat' }); return true }
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true }
    body(req).then(async input => {
      if (m[2] === 'unlock') return json(res, 200, withDraft({ chat: await chats.update(m[1], c => { unlock(c, String(input.key || '')) }) }))
      const chat = chats.get(m[1])
      if (!chat) return json(res, 404, { error: 'no such chat' })
      if (m[2] === 'lock' && chat.kind !== 'game') return json(res, 200, { chat: await chats.update(m[1], c => { lock(c, { env: env() }) }) })
      const action = m[2] === 'lock' ? 'lock' : actionOf(chat, { said: String(input.said || ''), pick: String(input.pick || '') })
      if (action) return json(res, 200, withDraft(await actTurn(m[1], input, action)))
      json(res, 200, await turnOf(m[1], input))
    }).catch(err => fail(res, err))
    return true
  }
  routes.chats = chats
  return routes
}
