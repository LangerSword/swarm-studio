// The game Plan board's intake from the chat (decision 0025 b and e, issue #607; server/chattools.mjs): "use this for
// the boss", "make it as is", "bring in characters like these". A run only reads; a press writes, and the painter of
// that part is given the owner's picture first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planRoutes } from '../server/plans.mjs'
import { gameIntakeTools, gamePartFor, gamePartsOf, chatTools } from '../server/chattools.mjs'
import { addMocks, addSheet, addBackdrops } from '../engine/planart.mjs'
import { planRefFor, planRefLines } from '../engine/planrefs.mjs'

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
const tool = (tools, name) => tools.find(t => t.name === name)

test('the parts a picture can be for, named in a few words', () => {
  const plan = { art: { sheets: ['cast', 'weapons'], shots: [['combat'], ['boss'], ['levelup']] }, shape: {} }
  assert.deepEqual(gamePartsOf(plan).map(p => p.slot), ['sheet:cast', 'sheet:weapons', 'mock:combat', 'mock:boss', 'mock:levelup', 'backdrops'])
  assert.equal(gamePartFor(plan, 'use this for the Boss').slot, 'mock:boss')
  assert.equal(gamePartFor(plan, 'the cast sheet').slot, 'sheet:cast')
  assert.equal(gamePartFor(plan, 'the level up screen').slot, 'mock:levelup')
  assert.equal(gamePartFor(plan, 'the backgrounds').slot, 'backdrops')
  assert.equal(gamePartFor(plan, 'the moon'), null)
  assert.ok(!gamePartsOf({ shape: { backdrops: false } }).some(p => p.slot === 'backdrops'))
  assert.throws(() => planRefFor({ refs: [{ id: 'ar0123abcd' }] }, 'ar0123abcd', '../x'), /no such part/)
})

test('use this for the boss: the run shows the plan\'s pictures and writes nothing; a press ties one to the boss screen', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gameintake-'))
  const plans = planRoutes({ dataDir })
  try {
    const plan = plans.get((await (async () => { const { planStore } = await import('../engine/plan.mjs'); return planStore(join(dataDir, 'plans')).create({ idea: 'a stylish brawler with bosses' }) })()).id)
    const [use, refs] = [tool(gameIntakeTools({ plans }), 'plan_use_for'), tool(gameIntakeTools({ plans }), 'plan_references')]
    assert.deepEqual(use.kinds, ['game'])
    // no plan in this talk, no pictures yet, an unknown part
    assert.match((await use.run({ part: 'boss' }, { plan: null })).text, /no plan yet/)
    assert.match((await use.run({ part: 'boss' }, { plan: plan.id })).text, /Drop or paste a picture/)
    const ref = plans.addRef(plan.id, { name: 'boss-mood.png', buf: PNG })
    assert.match((await use.run({ part: 'the moon' }, { plan: plan.id })).text, /^Which part\? cast sheet/)
    const before = JSON.stringify(plans.get(plan.id).refs)
    const out = await use.run({ part: 'the boss' }, { plan: plan.id })
    assert.equal(JSON.stringify(plans.get(plan.id).refs), before, 'a run writes nothing')
    assert.equal(out.cards.length, 1)
    assert.deepEqual(out.cards[0].act, { plan: plan.id, ref: ref.id, slot: 'mock:boss' })
    assert.equal(out.cards[0].img, ref.src)
    assert.equal(out.cards[0].pick, 'Use for the boss screen')
    assert.match((await use.act(out.cards[0].act)).text, /The boss screen will follow boss-mood\.png/)
    assert.equal(plans.get(plan.id).refs[0].for, 'mock:boss')
    // as is, from the chat, and back
    const shown = await refs.run({}, { plan: plan.id })
    assert.equal(shown.cards[0].pick, 'Use as is')
    assert.match((await refs.act(shown.cards[0].act)).text, /placed in the game as it is/)
    const again = await refs.run({}, { plan: plan.id })
    assert.equal(again.cards[0].pick, 'Like this')
    await refs.act(again.cards[0].act)
    assert.equal(plans.get(plan.id).refs[0].asIs, false)
    // chatTools offers them when the plans route can take a use
    assert.ok(chatTools({ plans }).some(t => t.name === 'plan_use_for'))
  } finally { rmSync(dataDir, { recursive: true, force: true }) }
})

test('the painter of a part gets the owner\'s picture for it first, and the brief says which part it is for', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gameintake-paint-'))
  try {
    for (const f of ['ar00000001.png', 'ar00000002.png', 'ar00000003.png']) writeFileSync(join(dir, f), PNG)
    const ref = (id, extra = {}) => ({ id, name: `${id}.png`, file: `${id}.png`, src: `/plans/p-0123456789/${id}.png`, asIs: false, removed: null, ...extra })
    const plan = { id: 'p-0123456789', cards: [], shape: {}, style: { name: 'Anime', locked: true, refs: [] }, refs: [ref('ar00000001'), ref('ar00000002'), ref('ar00000003')] }
    planRefFor(plan, 'ar00000002', 'mock:boss')
    planRefFor(plan, 'ar00000003', 'sheet:cast')
    const [boss, combat] = addMocks(plan, dir, ['boss', 'combat'])
    assert.equal(boss.refs[0], join(dir, 'ar00000002.png'), 'the boss screen gets its picture first')
    assert.match(boss.prompt, /The owner gave a picture for this screen/)
    assert.doesNotMatch(combat.prompt, /The owner gave a picture/)
    assert.deepEqual(addSheet(plan, 'cast', dir)[0].refs, [join(dir, 'ar00000003.png')])
    assert.deepEqual(addSheet(plan, 'weapons', dir)[0].refs, [])
    assert.ok(addBackdrops(plan, { dir }).every(j => j.refs.length === 0))
    assert.match(planRefLines(plan), /ar00000002\.png: \/plans\/p-0123456789\/ar00000002\.png \(for the boss screen\)/)
    assert.match(planRefLines(plan), /\(for the cast sheet\)/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('characters like these: three from the library\'s characters; a press keeps one as the cast sheet\'s look', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gameintake-chars-'))
  const plans = planRoutes({ dataDir })
  const pic = join(dataDir, 'knight.png')
  writeFileSync(pic, PNG)
  const asked = []
  const assets = {
    search: o => { asked.push(o); return [{ id: 'k1', subject: 'pixel knight', pack: 'heroes', credit: 'Ann', license: 'CC0', path: 'k.png' }] },
    local: () => true,
    file: async id => (id === 'k1' ? { file: pic, row: { subject: 'pixel knight', credit: 'Ann', license: 'CC0' } } : null)
  }
  try {
    const { planStore } = await import('../engine/plan.mjs')
    const plan = planStore(join(dataDir, 'plans')).create({ idea: 'a knightly brawler' })
    const chars = tool(gameIntakeTools({ plans, assets }), 'game_characters')
    const out = await chars.run({ q: 'pixel knight' }, { plan: plan.id })
    assert.deepEqual(asked[0].category, ['characters'])
    assert.equal(out.cards[0].source, 'assetrizz heroes: Ann, CC0')
    assert.equal(plans.get(plan.id).refs?.length || 0, 0, 'a run writes nothing')
    assert.match((await chars.act(out.cards[0].act)).text, /The cast sheet will follow pixel knight\. Credit: Ann, CC0\./)
    const kept = plans.get(plan.id).refs
    assert.deepEqual([kept.length, kept[0].for], [1, 'sheet:cast'])
    assert.ok(!gameIntakeTools({ plans }).some(t => t.name === 'game_characters'), 'offered only with the library')
  } finally { rmSync(dataDir, { recursive: true, force: true }) }
})
