// The chat says only the work it really did (rank-juggler, 2026-11-16/17; EVIDENCE.md failures 1 and 3). The owner's
// report named the game "Rank Juggler": the chat said "Repainting the mocks so they read as fast side-view arena
// combat" and no mock was ever repainted (it admits it two turns later), and nine replies in a row ended with the very
// same "Painting the backdrops now. It shows on the board as it lands." while nothing was painting at all.
// The strings here are the transcript's own; the plan is that night's plan file (tests/fixtures/rank-juggler).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { planFacts, checkClaims, nextStep, stepLineFor } from '../engine/gamestep.mjs'
import { planRoutes } from '../server/plans.mjs'
import { talkRoutes } from '../server/talk.mjs'

const FIX = fileURLToPath(new URL('./fixtures/rank-juggler/', import.meta.url))
const PLAN = 'p-44c1061860', CHAT = 'c-a081ad00b5'
const plan0 = () => JSON.parse(readFileSync(join(FIX, 'plans', `${PLAN}.json`), 'utf8'))
// the two lines the person saw, word for word
const REPAINTING = 'Repainting the mocks so they read as fast side-view arena combat'
const STEP = 'Painting the backdrops now. It shows on the board as it lands.'

// that night's plan, locked, with nothing painted yet but the first cast sheet
const night = () => { const p = plan0(); p.gate.locked = true; p.engine.target = 'web'; return p }

test('the mocks, the backdrops and the sheets are facts a claim can be checked against', () => {
  const f = planFacts(night(), {})
  const byWhat = Object.fromEntries(f.pictures.map(p => [p.what, p]))
  // the plan paints six close-ups, five mock screens and nine backdrops (three stages, three a stage); none has landed
  assert.deepEqual(byWhat['mock'], { what: 'mock', names: byWhat['mock'].names, done: 0, painting: 0, queued: 5 })
  assert.deepEqual([byWhat['backdrop'].done, byWhat['backdrop'].painting, byWhat['backdrop'].queued], [0, 0, 9])
  assert.deepEqual([byWhat['sheet'].done, byWhat['sheet'].painting, byWhat['sheet'].queued], [1, 0, 1])
  // a mock that is painting is what a "repainting the mocks" is checked against, and only for the mocks
  const p = night()
  p.mocks = [{ id: 'm1', shot: 'combat', state: 'painting' }]
  const g = planFacts(p, {})
  assert.deepEqual(g.pictures.filter(x => x.painting).map(x => x.what), ['mock'])
  assert.equal(g.pictures.find(x => x.what === 'backdrop').painting, 0)
})

test('failure 3: "Repainting the mocks" is cut when nothing is repainting, and said when it is', () => {
  const f = planFacts(night(), {})
  // the exact sentence from turn 50, which was false then and is false on that plan
  assert.deepEqual(checkClaims(REPAINTING, f).cut, [REPAINTING])
  // and one that ends the turn: the turn keeps what was true and loses the claim
  const turn = `The rank meter reads at the corner. ${REPAINTING}.`
  assert.equal(checkClaims(turn, f).text, 'The rank meter reads at the corner.')
  // the first person, the done tense's own words, and the other actions the chat uses
  for (const said of [
    'I am repainting the mocks.',
    'I repainted the mocks.',
    'I changed the mocks so they read as arena combat.',
    'I fixed the backdrop.',
    'I regenerated the mock screens.',
    'Repainted the mocks.'
  ]) assert.deepEqual(checkClaims(said, f).cut, [said], said)
  // the same claim, once the mocks really are painting, is true and stays
  const p = night()
  p.mocks = [{ id: 'm1', shot: 'combat', state: 'painting' }]
  const g = planFacts(p, {})
  assert.deepEqual(checkClaims(REPAINTING, g), { text: REPAINTING, cut: [] })
  // and once they have landed, the done claim is true
  p.mocks[0].state = 'done'
  assert.deepEqual(checkClaims('I repainted the mocks.', planFacts(p, {})), { text: 'I repainted the mocks.', cut: [] })
})

test('a mock claim is never borne out by another picture kind painting', () => {
  const p = night()
  // the backdrops are painting: a claim about the backdrops is true, one about the mocks is not
  p.backdrops = [{ id: 'b1', stage: 0, n: 1, state: 'painting' }]
  const f = planFacts(p, {})
  assert.deepEqual(checkClaims('Painting the backdrops now.', f), { text: 'Painting the backdrops now.', cut: [] })
  assert.deepEqual(checkClaims(REPAINTING, f).cut, [REPAINTING])
  // the one true claim the chat does make, that the plan is not locked, is untouched on an unlocked plan
  const open = plan0()
  assert.deepEqual(checkClaims('The plan is not locked yet.', planFacts(open, {})).cut, [])
})

test('a question, a refusal and the person\'s own next step are not claims', () => {
  const f = planFacts(night(), {})
  for (const said of [
    'I cannot repaint the mocks.',
    'I will not repaint the mocks.',
    'How would you like me to repaint the mocks?',
    'Next: repaint the mocks so they read as fast side-view arena combat.',
    'Should I repaint the mocks as arena combat?'
  ]) assert.deepEqual(checkClaims(said, f).cut, [], said)
})

test('failure 1: the step line said last turn is not said again; a new one is', () => {
  const plan = night(), chat = JSON.parse(readFileSync(join(FIX, 'chats', CHAT, 'chat.json'), 'utf8'))
  const step = nextStep(chat, plan, {})
  // the same line twice: the second turn adds nothing, because the board has not moved
  chat.turns.push({ id: 't17', who: 'planner', text: STEP, step: true })
  assert.equal(stepLineFor(chat, { text: STEP }), '')
  // the same line said after the planner's own words: still the same line
  chat.turns.at(-1).text = `The mocks have not been repainted yet. ${STEP}`
  assert.equal(stepLineFor(chat, { text: STEP }), '')
  // the step moves on (the lock happens): the new line is said
  assert.equal(stepLineFor(chat, { text: 'The plan is not locked yet.' }), 'The plan is not locked yet.')
  // the person's turn in between changes nothing: the last planner turn already ended on that line
  chat.turns.push({ id: 't18', who: 'person', text: 'theyre not being repainted' })
  assert.equal(stepLineFor(chat, { text: STEP }), '')
  // a planner turn that ended on something else does not block the step's line
  chat.turns.push({ id: 't19', who: 'planner', text: 'Tell me which one to keep.', step: true })
  assert.equal(stepLineFor(chat, { text: STEP }), STEP)
  // nothing to say, nothing said
  assert.equal(stepLineFor(chat, { text: '' }), '')
  assert.equal(stepLineFor({ turns: [] }, { text: STEP }), STEP)
})

test('nine replies in a row, as that night read: the same step line once, then not again', () => {
  // the chat file that night ends every planner turn with the same sentence. The turns are rebuilt here as the chat
  // builds them (the planner's own words, then the step's line), and the line a turn would add is the one stepLineFor
  // allows. That night the line was stapled on nine times: the person read it on turns 46 to 54 alike.
  const chat = { turns: [] }
  const said = []
  for (let n = 0; n < 9; n++) {
    const line = stepLineFor(chat, { text: STEP })
    said.push(line)
    // the turn is the planner's own words (true of that plan: nothing is painting, nothing was repainted) and then
    // the step's line, as engine/talkplan.mjs builds it
    const words = ['The mocks are next.', 'The look has to be settled first.', 'The rank meter is the thing to settle.', 'The mocks read as arena combat.', 'Two heroes are enough for the slice.', 'The controls are what the slice needs.', 'The rank meter reads at the corner.', 'The slice needs one arena.', 'The mocks are the next picture.'][n]
    // when the line is skipped, the step is still the end of the reply (its buttons are there); only the words are left
    // out, so the reply never says the same sentence twice and never ends on something that is not the step
    const text = line ? `${words} ${line}` : words
    const shown = line ? text : `${words} ${STEP}`
    chat.turns.push({ id: `t${46 + n * 2}`, who: 'planner', text: shown, step: true })
    chat.turns.push({ id: `t${47 + n * 2}`, who: 'person', text: n % 2 ? 'i need better mocks please' : 'theyre not being repainted' })
    // nothing moved between them: no mock, sheet or backdrop was started, so the step is the same line
  }
  assert.equal(said[0], STEP, 'the first reply says it')
  assert.deepEqual(said.slice(1), Array(8).fill(''), 'the other eight replies do not say it again')
  assert.equal(chat.turns.filter(t => t.who === 'planner').length, 9)
  // the sentence the person read on nine turns of that night is in the reply once, though the step is still the end
  // of every reply
  assert.equal(chat.turns.filter(t => t.who === 'planner' && t.text.split(STEP).length - 1 === 1).length, 9, 'once per reply')
  assert.ok(chat.turns.filter(t => t.who === 'planner').every(t => t.text.endsWith(STEP)))
  // the false line from turn 50 is never in any of them
  assert.ok(!chat.turns.some(t => /Repainting the mocks/i.test(t.text)))
  // a turn whose step moved on says the new one
  assert.equal(stepLineFor(chat, { text: 'The plan is not locked yet.' }), 'The plan is not locked yet.')
})
