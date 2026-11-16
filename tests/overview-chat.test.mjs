// The Overview has one place to type: the chat (owner, 2026-11-15; docs/ux/breadboards/overview.md). The dock
// keeps its tools and has no text box, and the inspector has none of its own for the crew.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as route from '../web/route.js'

const read = f => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8')

test('the dock and the inspector have no "Tell the crew" box', () => {
  const js = read('project.js')
  assert.ok(!/pj-ask|pj-lask|Tell the crew…/.test(js), 'web/project.js still draws a box for the crew')
  const dock = js.slice(js.indexOf('<div class="pj-dock">'), js.indexOf('<input type="file" class="pj-file"'))
  assert.ok(dock.includes('data-tool="comment"'), 'the dock keeps its Chat tool')
  assert.ok(!/<input|<textarea|<form/.test(dock), 'the dock has a text box')
  assert.ok(!/pj-ask|pj-send/.test(read('project.css')), 'web/project.css still styles the box')
})

test('the box no longer has words of its own: the chat keeps its placeholder', () => {
  assert.equal('askBox' in route, false)
  assert.equal(route.toApp({ app: true }, undefined), true)
  assert.equal(route.toApp({ app: true }, 'page'), false)
})

test('typed on the Overview, the chat asks the Overview where the words go', () => {
  const loop = read('canvas/loop.js')
  assert.match(loop, /overview\(\)\?\.marked/)
  assert.match(loop, /await ov\.say\(brief, ovLines\)/)
  const js = read('project.js')
  // the Overview never awaits a send it makes through the chat's own form: that send waits for this one to end
  const say = js.slice(js.indexOf('async function say(text, h)'), js.indexOf('// the section the chat\'s box is about'))
  assert.ok(!/await sw\.submit|return sw\.submit/.test(say))
})
