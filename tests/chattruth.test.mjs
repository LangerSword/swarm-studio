// A website's and an app's chat say only what is true, and their buttons really act (owner, 2026-11-15: "All 3
// pages are built" said of a build with failed sections; "Build the app first" as the answer to "build the app").
// What tests/rankjuggler.test.mjs is for the game chat: a stand-in planner says each false thing in each state of
// the build, and the turn has to come out true, ending in the real next step.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildState } from '../engine/buildstate.mjs'
import { chatFacts, stateLine, factsText, firstLine, nextStep, checkSaid, wordsAct, stateAsk, truthTurn } from '../engine/chatstep.mjs'
import { askTurn } from '../engine/askfirst.mjs'
import { talkRoutes } from '../server/talk.mjs'
import { buildAsk, noAppYet } from '../web/canvas/wander.js'

// ---------- builds, as their events: three pages of three sections
const PAGES = ['Home', 'Book', 'Find us']
const plan = () => [{ type: 'run:start', brief: 'a bike repair shop' }, { type: 'theme', name: 'calm', vars: {} },
  ...PAGES.flatMap((p, i) => [{ type: 'page', id: `p${i}`, title: p }, ...[0, 1, 2].map(k => ({ type: 'layer:plan', page: `p${i}`, id: `s${k}` }))])]
const built = (n, html = true) => PAGES.flatMap((_, i) => [0, 1, 2].map(k => ({ type: 'layer:done', page: `p${i}`, layer: `s${k}`, ...(html ? { html: '<p>x</p>' } : {}) }))).slice(0, n)
const failedAt = n => PAGES.flatMap((_, i) => [0, 1, 2].map(k => ({ type: 'layer:failed', page: `p${i}`, layer: `s${k}`, message: 'the model did not answer' }))).slice(n)
const BUILDS = {
  building: buildState([...plan(), ...built(4)], { live: true }),
  partly: buildState([...plan(), ...built(5), ...failedAt(5), { type: 'run:done' }]),
  failed: buildState([{ type: 'run:start', brief: 'a bike repair shop' }, { type: 'run:done' }]),
  done: buildState([...plan(), ...built(9), { type: 'run:done' }])
}
const F = {
  nothing: chatFacts({}),
  building: chatFacts({ run: 'r1', build: BUILDS.building, pages: PAGES }),
  partly: chatFacts({ run: 'r1', build: BUILDS.partly, pages: PAGES }),
  failed: chatFacts({ run: 'r1', build: BUILDS.failed, pages: [] }),
  done: chatFacts({ run: 'r1', build: BUILDS.done, pages: PAGES }),
  live: chatFacts({ run: 'r1', build: BUILDS.done, pages: PAGES, published: 'https://bikes.example' }),
  appDesigned: chatFacts({ kind: 'app', run: 'r1', build: BUILDS.done, pages: PAGES, app: { state: 'idle', hasApp: false, steps: [] } }),
  appBuilding: chatFacts({ kind: 'app', run: 'r1', build: BUILDS.done, pages: PAGES, app: { state: 'working', hasApp: false, steps: [1] } }),
  appBuilt: chatFacts({ kind: 'app', run: 'r1', build: BUILDS.done, pages: PAGES, app: { state: 'done', hasApp: true, steps: [1, 2] } })
}

test('the states the fixtures stand for, and each one in the Studio\'s own words', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(BUILDS).map(([k, b]) => [k, [b.state, b.done, b.planned, b.next]])), {
    building: ['building', 4, 9, null], partly: ['partly', 5, 9, 'resume'], failed: ['failed', 0, 0, 'again'], done: ['done', 9, 9, null]
  })
  assert.equal(stateLine(F.nothing), 'Nothing is built yet.')
  assert.equal(stateLine(F.building), 'Building: 4/9 sections across 3 pages.')
  assert.match(stateLine(F.partly), /^5 of 9 sections are built and kept; 4 failed\./)
  assert.equal(stateLine(F.done), 'All 3 pages are built.')
  assert.equal(stateLine(F.live), 'All 3 pages are built. Live at https://bikes.example.')
  assert.equal(stateLine(F.appDesigned), 'All 3 pages are built. The app is not built yet.')
  assert.equal(stateLine(F.appBuilding), 'All 3 pages are built. The app is still building.')
  assert.equal(stateLine(F.appBuilt), 'All 3 pages are built. The app is built.')
  // the planner is told the same before it speaks
  assert.match(factsText(F.partly), /^What has really happened: 5 of 9 sections are built and kept; 4 failed\..*\nPages: 3 \(Home; Book; Find us\)\.\nBuilding now: NO\. Published: NO\./)
  assert.match(factsText(F.appDesigned), /The app: NOT built\./)
  // and a new chat's first line is the state, never a blank
  assert.equal(firstLine(F.nothing), 'Say what to make. Nothing is built until you say.')
  assert.equal(firstLine(F.done), 'All 3 pages are built. Say what to change.')
  assert.equal(firstLine(F.building), 'Building: 4/9 sections across 3 pages.')
})

// ---------- every false thing, in every state where it is false
const LIES = {
  'All 3 pages are built.': ['nothing', 'building', 'partly', 'failed'],
  'All three pages are built and ready to view.': ['nothing', 'building', 'partly', 'failed'],
  'The site is finished.': ['nothing', 'building', 'partly', 'failed'],
  'Everything is done and the site is live.': ['nothing', 'building', 'partly', 'failed', 'done', 'appDesigned'],
  'Your site is published.': ['nothing', 'building', 'partly', 'failed', 'done', 'appDesigned', 'appBuilt'],
  'It has been deployed.': ['nothing', 'partly', 'done'],
  'The site is finished and live.': ['partly', 'done'],
  'I have started the build.': ['nothing', 'partly', 'failed', 'done', 'appDesigned', 'appBuilt'],
  'The crew is building it now.': ['nothing', 'partly', 'failed', 'done'],
  "I'm building the app now.": ['nothing', 'done', 'appDesigned', 'appBuilt'],
  'The build is underway.': ['nothing', 'partly', 'done'],
  'The plan is locked.': ['nothing', 'partly', 'done', 'appDesigned'],
  'The site has 5 pages.': ['partly', 'done', 'live'],
  'All 5 pages are built.': ['partly', 'done', 'live'],
  '7 of 9 sections are built.': ['building', 'partly', 'done'],
  '9 sections are built.': ['partly'],
  'The app is built.': ['nothing', 'done', 'appDesigned', 'appBuilding'],
  'The app is finished and running.': ['appDesigned'],
  'Nothing is built yet.': ['partly', 'done', 'appBuilt'],
  'No pages have been made here.': ['partly', 'done']
}
const FALSE = /\b(all (3|three|5) pages are built|is finished|is done|site is live|is published|been deployed|started the build|building (it|the app) now|is underway|is locked|has 5 pages|7 of 9|9 sections are built|app is built|finished and running|no pages have been made)\b/i

test('scripted lies: the planner says each false thing in each state, and the turn comes out true', async () => {
  let n = 0
  for (const [lie, states] of Object.entries(LIES)) for (const state of states) {
    const facts = F[state]
    const out = await truthTurn({ text: 'tell me about the booking form', facts, plan: async () => ({ reply: `A short form is enough. ${lie} Should it ask for a phone number?` }) })
    const where = `"${lie}" in ${state}: ${out.reply}`
    assert.deepEqual(out.cut, [lie], where)
    // the lie is gone unless the state's own line happens to say the same words truly
    if (!stateLine(facts).includes(lie)) assert.ok(!out.reply.includes(lie), where)
    if (lie !== 'Nothing is built yet.') assert.doesNotMatch(out.reply.replace(stateLine(facts), ''), FALSE, where)
    // what was true stays, the state's own words take the lie's place, and the turn ends in the real step
    assert.match(out.reply, /^A short form is enough\. Should it ask for a phone number\? /, where)
    assert.ok(out.reply.endsWith(stateLine(facts)), where)
    assert.deepEqual(out.step, nextStep(facts), where)
    n++
  }
  assert.ok(n >= 60, `${n} cases`)
})

test('the same sentences where they are true are kept, word for word', async () => {
  const TRUE = [
    ['All 3 pages are built.', 'done'], ['All three pages are built and ready to view.', 'live'], ['The site is finished.', 'done'],
    ['Your site is published.', 'live'], ['The site is finished and live.', 'live'], ['The crew is building it now.', 'building'],
    ['The site has 3 pages.', 'done'], ['5 of 9 sections are built.', 'partly'], ['The app is built.', 'appBuilt'],
    ["I'm building the app now.", 'appBuilding'], ['Nothing is built yet.', 'nothing'], ['Nothing is built yet.', 'failed']
  ]
  for (const [line, state] of TRUE) assert.deepEqual(checkSaid(`Sure. ${line}`, F[state]), { text: `Sure. ${line}`, cut: [] }, `${line} in ${state}`)
})

test('talk about what could be built is not a claim: questions, plans and conditions survive in every state', () => {
  const TALK = [
    'Three pages would do: Home, Book and Find us.', 'Should I build 3 pages or 5?', 'Once it is live you can share the link.',
    'When all 3 pages are built, you can publish it.', 'The brief is ready when you are.', 'It is not built yet.',
    'A booking form can be built with a plain email.', 'Do you want it live on your own domain?', 'I would add a page for team orders.',
    'If the site is published under your own name, people trust it more.', 'Is the shop already running, or about to open?',
    'Your shop has been running for ten years, so say so.', 'Payments are best done by a provider like Stripe.', 'Press Build and the crew will start.'
  ]
  for (const f of Object.values(F)) for (const line of TALK) assert.deepEqual(checkSaid(line, f).cut, [], `${line} (${stateLine(f)})`)
})

test('the next step is the state\'s: Resume, Try again, Build the app, or the brief', () => {
  const ids = f => nextStep(f).options.map(o => [o.id, o.label])
  assert.deepEqual(ids(F.nothing), [['do:brief', 'Build']])
  assert.deepEqual(nextStep(F.nothing, { talked: false }).options, [])
  assert.deepEqual(nextStep(F.building), { text: 'Building: 4/9 sections across 3 pages.', options: [], run: 'r1', wait: true })
  assert.deepEqual(ids(F.partly), [['do:resume', 'Resume'], ['do:brief', 'Build']])
  assert.deepEqual(ids(F.failed), [['do:again', 'Try again'], ['do:brief', 'Build']])
  assert.deepEqual(ids(F.done), [['do:brief', 'Build']])
  assert.deepEqual(ids(F.appDesigned), [['do:app', 'Build the app'], ['do:brief', 'Build']])
  assert.deepEqual(nextStep(F.appBuilding).options, [])
  assert.deepEqual(ids(F.appBuilt), [['do:brief', 'Build']])
  const stopped = chatFacts({ kind: 'app', build: BUILDS.done, pages: PAGES, app: { state: 'stopped', hasApp: false, steps: [1, 2] } })
  assert.deepEqual(ids(stopped)[0], ['do:app', 'Go on'])
  const appFailed = chatFacts({ kind: 'app', build: BUILDS.done, pages: PAGES, app: { state: 'failed', hasApp: false, steps: [1] } })
  assert.deepEqual(ids(appFailed)[0], ['do:app', 'Try again'])
  // an app's state from another reader plugs in: anything with { state, hasApp, steps }
  assert.equal(chatFacts({ kind: 'app', app: { state: 'done', hasApp: true } }).app.built, true)
})

test('typed words do what the buttons do, and a question never does', () => {
  const act = (w, f) => wordsAct(w, nextStep(f))
  for (const w of ['resume', 'Resume it', 'go on', 'continue', 'keep going', 'please resume the build', 'build it', 'go', 'do it']) assert.equal(act(w, F.partly), 'do:resume', w)
  for (const w of ['try again', 'retry', 'Try it again.', 'again', 'go']) assert.equal(act(w, F.failed), 'do:again', w)
  for (const w of ['build the app', 'Build the app!', 'make the app', 'please build the app now', 'turn this into an app', 'build it', 'go']) assert.equal(act(w, F.appDesigned), 'do:app', w)
  for (const w of ['build it', 'build', 'go ahead', "let's build", 'make it']) assert.equal(act(w, F.done), 'do:brief', w)
  // "go on" builds an app only where its button says Go on
  assert.equal(act('go on', F.appDesigned), null)
  // an action the step does not offer is not run
  assert.equal(act('resume', F.done), null)
  assert.equal(act('try again', F.partly), null)
  assert.equal(act('build the app', F.done), null)
  // questions, a "not yet", and words for the planner
  for (const f of [F.partly, F.failed, F.appDesigned, F.done]) {
    for (const w of ['can you resume it?', 'should I build the app?', 'build it?', 'how do I try again?', "don't build yet", 'do not resume', 'not yet, wait', 'build it later', 'resume the talk about colours and then make the hero bigger please', 'what would the app do', 'yes', 'ok', 'sure']) assert.equal(act(w, f), null, w)
  }
  // while somebody is working there is nothing to press, typed or not
  for (const w of ['go', 'build it', 'resume', 'build the app']) { assert.equal(act(w, F.building), null, w); assert.equal(act(w, F.appBuilding), null, w) }
})

test('a question about how far things are is answered by the state, and the planner is not asked', async () => {
  for (const q of ['How far is the build?', "What's going on?", 'what is built so far?', 'is it done?', 'Is the site live yet?', 'status', 'did it finish?', 'is the app built?']) {
    for (const [k, f] of Object.entries(F)) {
      if (k === 'nothing') { assert.equal(stateAsk(q, f), false, q); continue }
      let asked = 0
      const out = await truthTurn({ text: q, facts: f, plan: async () => { asked++; return { reply: 'All 3 pages are built and it is live.' } } })
      assert.equal(asked, 0, q)
      assert.equal(out.reply, stateLine(f), q)
      assert.equal(out.by, 'state')
    }
  }
  for (const q of ['What should the booking form ask?', 'Could a company order for a whole team?', 'how far should the menu go down the page, and what about the progress bar on the order form that customers keep asking us about?']) assert.equal(stateAsk(q, F.done), false, q)
  // Ask mode: the same answers, and no action is read from the words
  const ask = await truthTurn({ text: 'resume', facts: F.partly, ask: true, plan: async () => ({ reply: 'Press Resume under the build.' }) })
  assert.equal(ask.act, undefined)
  assert.equal(ask.reply, 'Press Resume under the build.')
})

// ---------- the saved talk's road (POST /api/talk), with a planner that lies
async function studio({ facts, model }) {
  const dir = mkdtempSync(join(tmpdir(), 'truth-'))
  const calls = []
  const talks = talkRoutes({ dataDir: dir, facts: async () => facts, model: () => async messages => { calls.push(messages); return model(messages) } })
  const srv = createServer((req, res) => { if (!talks(req, res, new URL(req.url, 'http://x'))) res.writeHead(404).end() })
  await new Promise(r => srv.listen(0, r))
  const base = `http://127.0.0.1:${srv.address().port}`
  const post = (path, body) => fetch(`${base}/api/talk${path}`, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json())
  return { post, calls, chats: talks.chats, close: () => { srv.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('a website chat on a partly built site: the lie is cut, "how far" is the state, and "resume" is the Resume button', async () => {
  const s = await studio({ facts: F.partly, model: async () => 'Good news: all 3 pages are built and the site is live. Want a booking form next?' })
  try {
    let j = await s.post('', { kind: 'site', said: 'Could it take bookings?' })
    assert.equal(j.turn.text, `Want a booking form next? ${stateLine(F.partly)}`)
    assert.deepEqual(j.turn.options.map(o => o.id), ['do:resume', 'do:brief'])
    // the planner was told the truth before it spoke
    assert.match(s.calls[0][0].content, /What is there now:\nWhat has really happened: 5 of 9 sections are built and kept; 4 failed\./)
    const id = j.chat.id
    j = await s.post(`/${id}`, { said: 'How far is the build?' })
    assert.equal(j.turn.text, stateLine(F.partly))
    assert.equal(s.calls.length, 1, 'the state answered, not the planner')
    j = await s.post(`/${id}`, { said: 'resume' })
    assert.equal(j.turn.act, 'do:resume')
    assert.equal(j.turn.text, stateLine(F.partly))
    assert.equal(s.calls.length, 1, 'an action asks no planner')
    j = await s.post(`/${id}`, { said: 'should I resume it?' })
    assert.equal(j.turn.act, undefined, 'a question never acts')
    assert.equal(s.calls.length, 2)
    // nothing false was ever saved
    for (const t of s.chats.get(id).turns.filter(t => t.who === 'planner')) assert.doesNotMatch(t.text, /all 3 pages are built|site is live/i)
  } finally { s.close() }
})

test('an app chat on a designed app: "build the app" is the Build the app button, never "build the app first"', async () => {
  const s = await studio({ facts: F.appDesigned, model: async () => 'The app is built and running. What should change?' })
  try {
    let j = await s.post('', { kind: 'app', said: 'Let nurses filter the shift board by ward' })
    assert.equal(j.turn.text, `What should change? ${stateLine(F.appDesigned)}`)
    assert.deepEqual(j.turn.options.map(o => [o.id, o.label]), [['do:app', 'Build the app'], ['do:brief', 'Build']])
    j = await s.post(`/${j.chat.id}`, { said: 'build the app' })
    assert.equal(j.turn.act, 'do:app')
    assert.equal(s.calls.length, 1)
  } finally { s.close() }
  // the App room's own chat reads the same words as its button (web/canvas/wander.js)
  const app = { kind: 'site', hasApp: false, steps: [] }
  for (const w of ['build the app', 'Build it', 'build', 'go', 'make the app', 'ok, build it now', 'turn this into an app']) assert.equal(buildAsk(w, app), true, w)
  for (const w of ['build the app?', 'Let nurses filter the shift board by ward', 'build a login page', "don't build it", 'what does build do']) assert.equal(buildAsk(w, app), false, w)
  assert.equal(buildAsk('build it', { kind: 'game', hasApp: false, steps: [] }), false)
  assert.equal(buildAsk('build it', { kind: 'site', hasApp: true, steps: [] }), false)
  // a designed app's own steps (its design) are not a build partway; a stopped or failed one is goOnAsk's
  assert.equal(buildAsk('build the app', { kind: 'site', state: 'idle', hasApp: false, steps: [{ step: 'design' }] }), true)
  assert.equal(buildAsk('build it', { kind: 'site', state: 'stopped', hasApp: false, steps: [1, 2] }), false)
  assert.equal(noAppYet(app), 'The app is not built yet. Say “build the app” to build it, then change it by chatting.')
})

test('one confirmation: an answer pressed on the brief builds from the brief as it stands in its box', async () => {
  const s = await studio({ facts: F.nothing, model: async () => 'x' })
  try {
    // the brief as the server keeps it for a new website: Hermia's turn, carrying the question's three answers
    const chat = s.chats.create({ kind: 'site', text: 'A site for my bike repair shop' })
    const brief = 'A website for a bike repair shop in Leeds. Pages: Home, Book a repair, Find us.'
    await s.chats.update(chat.id, c => { c.ask = { brief, at: 1 }; c.turns.push({ ...askTurn(`t${c.turns.length + 1}`, brief), text: brief, brief: true }) })
    const j = await s.post(`/${chat.id}`, { pick: 'go:all', brief: `${brief} No shop.` })
    assert.deepEqual(j.turn.go, { path: 'all', skip: ['brand', 'plan'], brief: `${brief} No shop.` })
    assert.equal(j.chat.go.path, 'all')
    assert.equal(s.calls.length, 0, 'the answer needs no model')
  } finally { s.close() }
})
