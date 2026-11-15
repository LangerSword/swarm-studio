// The Game room before anything is built (game-mode walk, 2026-11-15): a game's run says it is a game while it is
// idle, so the room shows a game's start ("A game starts with a few questions"), never the app's "Turn this design
// into a working app" with its dashboards and admin panel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appJobs, isGameRun } from '../engine/appjob.mjs'

test('an idle run says it is a game when it was made as one; a site or an app says nothing', () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'appidle-'))
  const logs = {
    game: [{ type: 'run:start', brief: 'Lantern Run, a small platformer', kind: 'game' }],
    spec: [{ type: 'run:start', brief: 'a promo game' }, { type: 'game:spec', spec: { title: 'Lantern Run' } }],
    site: [{ type: 'run:start', brief: 'Alpha Tea, a tea subscription' }],
    app: [{ type: 'run:start', brief: 'Shift Log', kind: 'app' }]
  }
  const a = appJobs({ runsDir, record: () => {}, broadcast: () => {}, readEvents: id => logs[id] || null, provider: () => null, modelFor: () => null, sweepEvery: 0 })
  try {
    assert.equal(a.state('game').state, 'idle')
    assert.equal(a.state('game').kind, 'game')
    assert.equal(a.state('spec').kind, 'game')
    assert.equal(a.state('site').kind, undefined)
    assert.equal(a.state('app').kind, undefined)
    assert.equal(isGameRun([]), false)
  } finally { rmSync(runsDir, { recursive: true, force: true }) }
})
