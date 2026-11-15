// The Plan board fits the whole plan again when its stage changes size (Hermes Desktop's pane settling, the chat
// docking or folding), until the person moves the view themselves (web/planfit.js; the owner's Rank Juggler board,
// 2026-11-15: framed wide, then shrunk, it sat right of an empty strip with its rows cut off).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planFitWatch, planFitSame } from '../web/planfit.js'
import { studioModules } from '../server/page.mjs'

test('a resize refits while the view is the board\'s own fit, and never after the person moved it', () => {
  const observers = []
  globalThis.ResizeObserver = class { constructor(fn) { this.fn = fn; observers.push(this) } observe() {} disconnect() { this.off = true } }
  const stage = { clientWidth: 1960, clientHeight: 1100 }
  let fits = 0
  const bd = { stage, cam: { x: 0, y: 0, k: 1 }, frameAll() { fits++; this.cam = { x: stage.clientWidth / 4, y: 40, k: stage.clientWidth / 2000 } } }
  let framed = false
  const w = planFitWatch(bd, { framed: () => framed })
  const resize = (cw, ch) => { stage.clientWidth = cw; stage.clientHeight = ch; observers[0].fn() }
  // before the first fit: nothing
  resize(1960, 1100)
  assert.equal(fits, 0)
  // the board's first fit, then the pane settles smaller: fitted again, to the new size
  framed = true; bd.frameAll(); w.fitted()
  resize(1100, 560)
  assert.equal(fits, 2)
  assert.equal(bd.cam.k, 1100 / 2000)
  // the same size again: nothing
  resize(1100, 560)
  assert.equal(fits, 2)
  // the person pans: their view stays when the pane changes
  bd.cam = { ...bd.cam, x: bd.cam.x + 120 }
  resize(1960, 1160)
  assert.equal(fits, 2)
  // a hidden stage (0 wide) is never fitted
  framed = true; bd.frameAll(); w.fitted()
  resize(0, 0)
  assert.equal(fits, 3)
  w.stop()
  assert.ok(observers[0].off)
  delete globalThis.ResizeObserver
})

test('the same view, to a hundredth of a pixel', () => {
  assert.ok(planFitSame({ x: 1, y: 2, k: 0.5 }, { x: 1.001, y: 2, k: 0.50001 }))
  assert.ok(!planFitSame({ x: 1, y: 2, k: 0.5 }, { x: 1.5, y: 2, k: 0.5 }))
})

test('the studio joins planfit.js before plan.js', () => {
  const list = studioModules('web')
  assert.ok(list.indexOf('planfit.js') >= 0 && list.indexOf('planfit.js') < list.indexOf('plan.js'))
})
