// Reachability over the navigation state charts (scripts/nav-reach.mjs): xstate/graph walks the live chart
// (web/nav.js) and the design of every screen (docs/ux/statechart/studio.machine.js), and what it finds must be
// what was accepted (docs/ux/statechart/reach-baseline.json): states with no way in, dead ends, states only the
// top-level moves leave, events nothing takes, events the code sends that the chart does not declare.
// It lives with the property tests because xstate/graph is a pinned dev dependency (tools/dev), never shipped.
//
//   npm run --prefix tools/dev property        (CI: the `property` job)
//   node scripts/nav-reach.mjs --update        accepts a change to the findings
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BASELINE, findings, reach, words } from '../../scripts/nav-reach.mjs'
import { setup } from '../../web/vendor/xstate/xstate.mjs'

test('the navigation charts: what the walk finds is what was accepted', () => {
  const all = findings()
  const accepted = JSON.parse(readFileSync(BASELINE, 'utf8'))
  assert.deepEqual(all, accepted, `the findings changed: fix the chart, or accept with node scripts/nav-reach.mjs --update\n${words(all)}`)
  // whatever is accepted, these never are: every state has a way in, and no state traps the person
  for (const [name, r] of Object.entries(all)) {
    assert.deepEqual(r.noWayIn, [], `${name}: a state with no way in`)
    assert.deepEqual(r.deadEnds, [], `${name}: a dead end`)
    assert.deepEqual(r.eventsSentNotDeclared, [], `${name}: the code sends an event the chart does not have`)
    assert.deepEqual(r.eventsNotTried, [], `${name}: an event scripts/nav-reach.mjs has no payload for`)
  }
})

test('the walk sees a state with no way in, a dead end and an event nothing takes', () => {
  const broken = setup({}).createMachine({
    id: 't', initial: 'a',
    states: {
      a: { on: { go: 'b', never: { guard: () => false, target: 'c' } } },
      b: {},
      c: { on: { back: 'a' } }
    }
  })
  const r = reach(broken, { events: [{ type: 'go' }, { type: 'never' }, { type: 'back' }], key: () => 0, sent: ['go', 'jump'] })
  assert.deepEqual(r.noWayIn, ['c'])
  assert.deepEqual(r.deadEnds, ['b'])
  assert.deepEqual(r.eventsNeverTaken, ['back', 'never'])
  assert.deepEqual(r.eventsSentNotDeclared, ['jump'])
})
