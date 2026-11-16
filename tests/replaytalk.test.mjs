// Replay in words (web/replaytalk.js): a replay is a recording, so its mark reads Replay, nothing it shows reads
// as work going on, and the chat answers for it. Plus the wiring the canvas keeps: the App room starts nothing
// while a replay plays, and the chat asks the replay first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REPLAY_WORD, REPLAY_SAYS, replayPct, statusWords, progressLine, appPill, replayAsk, buildStrip, buildProgress, buildLive, buildLeft, endWords } from '../web/replaytalk.js'

test('the mark reads Replay and how far along it is', () => {
  assert.equal(REPLAY_WORD, 'Replay')
  assert.deepEqual([0, 0.004, 0.416, 1, 7, -1, NaN].map(replayPct), ['0%', '0%', '42%', '100%', '100%', '0%', '0%'])
  // whatever the recording is showing: planning, agents at work, all built
  for (const state of ['idle', 'planning', 'working', 'done', 'paused']) assert.deepEqual(statusWords({ replay: true, at: 0.42, state, working: 3, pages: 2, done: 4, total: 9 }), { text: 'Replay', num: '42%' })
})

test('a live build keeps its words', () => {
  assert.deepEqual(statusWords({ state: 'working', working: 3, pages: 2, done: 4, total: 9 }), { text: '3 agents building', num: '4/9' })
  assert.deepEqual(statusWords({ state: 'working', working: 1, done: 0, total: 9 }), { text: '1 agent building', num: '0/9' })
  assert.deepEqual(statusWords({ state: 'planning' }), { text: 'Planning the pages', num: '' })
  assert.deepEqual(statusWords({ state: 'done', pages: 3, done: 9, total: 9 }), { text: '3 pages built', num: '9/9' })
  assert.deepEqual(statusWords({ state: 'idle' }), { text: 'Ready', num: '' })
  assert.deepEqual(statusWords({ state: 'paused', done: 2, total: 9 }), { text: 'Stopped', num: '2/9' })
  assert.equal(progressLine({ plan: 'Planned 3 pages.', working: 4, done: 2, total: 9, pages: 3 }), 'Planned 3 pages. 4 agents building · 2/9 sections across 3 pages')
  assert.equal(progressLine({ working: 4, done: 2, total: 9, pages: 3 }), '4 agents building · 2/9 sections across 3 pages')
  assert.equal(progressLine({}), 'Planning the pages…')
  assert.deepEqual(['working', 'done', 'failed', 'stopped', 'paused', 'idle'].map(state => appPill({ state })), ['building', 'built', 'failed', 'stopped', 'your turn', 'no app yet'])
  assert.equal(appPill({ state: 'done', url: 'http://127.0.0.1:1/' }), 'running')
  // with the server's one state of the app or game (engine/kindstate.mjs), the pill is made from it
  assert.deepEqual(['designed', 'building', 'waiting', 'built', 'failed', 'stopped'].map(state => appPill({ state: 'idle', part: { state } })), ['no app yet', 'building', 'your turn', 'built', 'failed', 'stopped'])
  assert.equal(appPill({ state: 'working', kind: 'game', part: { state: 'designed' } }), 'no game yet')
  assert.equal(appPill({ replay: true, at: 0.5, part: { state: 'failed' } }), `${REPLAY_WORD} 50%`)
  assert.equal(appPill({ state: 'idle', hasApp: true }), 'built')
  // a game not built yet is not an app (game-mode walk, 2026-11-15)
  assert.equal(appPill({ state: 'idle', kind: 'game' }), 'no game yet')
})

test('nothing a replay shows reads as work going on', () => {
  const shown = [
    statusWords({ replay: true, at: 0.3, state: 'working', working: 8, done: 1, total: 9 }).text,
    progressLine({ replay: true, plan: 'Planned 3 pages.', working: 8, done: 1, total: 9, pages: 3 }),
    progressLine({ replay: true }),
    ...['working', 'done', 'idle'].map(state => appPill({ replay: true, at: 0.3, state, url: 'http://127.0.0.1:1/' }))
  ]
  for (const s of shown) {
    assert.match(s, /^Replay/, s)
    assert.doesNotMatch(s, /agents? building|\bbuilding$|running|Planning the pages…/, s)
  }
  assert.equal(progressLine({ replay: true, done: 1, total: 9, pages: 3 }), 'Replay: 1/9 sections across 3 pages')
  assert.equal(appPill({ replay: true, at: 0.3, state: 'working' }), 'Replay 30%')
})

test('the chat during a replay: stop, a true answer, and anything else ends it first', () => {
  for (const t of ['stop', 'Stop.', 'stop replay', 'stop the replay', 'Stop it', 'end replay', 'please stop', 'cancel', 'stop the recording']) assert.equal(replayAsk(t, true), 'stop', t)
  // the owner's own questions (2026-11-14)
  for (const t of ['is this building?', 'what is this?', 'What is this', 'is it building another version of the app?', 'what does replay actually do?', 'does it simulate and walk back how the app was made or does it actually build another version of the app?', 'is it just simulate or not', 'is this live?', 'is this real', "what's happening", 'what am I looking at?', 'why is it building again?', 'replay', 'replay it']) assert.equal(replayAsk(t, true), 'what', t)
  // a change, a new brief, a question about something else: the replay ends, then the chat does what was asked
  for (const t of ['add a FAQ page with search', 'make the hero bigger', 'how many pages are there?', '/review', 'stop the music on the home page', 'show the crew']) assert.equal(replayAsk(t, true), 'first', t)
  assert.equal(replayAsk('', true), null)
  assert.equal(replayAsk('   ', true), null)
})

test('the chat with no replay playing: "replay" starts one, and only replay talk is taken', () => {
  for (const t of ['replay', 'Replay.', 'replay it', 'replay this version', 'replay the build', 'show me the replay', 'play it back', 'watch the build again', 'start a replay', 'please replay']) assert.equal(replayAsk(t, false), 'start', t)
  for (const t of ['what does replay do?', 'what is a replay', 'does replay build another version?', 'is the replay a recording?']) assert.equal(replayAsk(t, false), 'about', t)
  for (const t of ['stop replay', 'stop the replay']) assert.equal(replayAsk(t, false), 'idle', t)
  // everything else is the chat's as ever: stop (a build), a change, a brief that only mentions the word
  for (const t of ['stop', 'is this building?', 'what is this?', 'make the hero bigger', 'add an instant replay button to the player', 'A site for a replay studio', '']) assert.equal(replayAsk(t, false), null, t)
})

test('each answer is one line that says what a replay is', () => {
  assert.match(REPLAY_SAYS.what, /^This is a replay of how this version was made\. Nothing is being built\. Say “stop” to end it\.$/)
  assert.match(REPLAY_SAYS.about, /Nothing is built\./)
  assert.match(REPLAY_SAYS.first, /^Stopped the replay/)
  for (const [k, s] of Object.entries(REPLAY_SAYS)) { assert.ok(s.length <= 120, k); assert.ok(!s.includes('\n'), k) }
})

test('the canvas keeps its side of it', () => {
  const read = f => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8')
  const rooms = read('canvas/rooms.js'), replay = read('canvas/replay.js'), loop = read('canvas/loop.js'), panels = read('canvas/panels.js'), html = read('index.html')
  // a replay never reads or starts the real app: starting it wrote app:ready and a photo into the run being replayed
  assert.match(rooms, /if \(rec\.on\) return renderApp\(\)\n  try \{\n    const st = await appApi\(\)/)
  assert.match(rooms, /function openApp\(run\) \{[^}]*?if \(appv\.opening \|\| appv\.run !== run \|\| rec\.on\) return/s)
  // a replayed event's address is the recording's, never shown; the room's own Stop ends the replay, not a build
  assert.match(rooms, /const real = fresh_ && !rec\.on/)
  assert.ok(!/fresh_\) appv\.url|&& fresh_\) appv\.url/.test(rooms), 'no replayed address reaches the frame')
  assert.match(rooms, /appEls\.stop\.onclick = \(\) => \(rec\.on \? void stopReplay\(\{ any: true \}\) : appApi\('\/stop', \{\}\)/)
  // asked for from the menu or the chat, it ends on the finished build opened again; the chat asks the replay first
  assert.match(replay, /if \(replayAsked\) return void await backToBuild\(id, false\)/)
  // what the person typed while it played stays in the chat; the hosted studio has no Replay, typed or pressed
  assert.match(replay, /for \(const x of said\) push\(els\.feed, x\)/)
  assert.match(replay, /function canReplay\(\) \{ return .*!BOOT\.hosted \}/)
  // nothing that acts on the build is offered while a replay plays; a comment ends it first
  for (const b of ['reviewBtn', 'exportBtn', 'publishBtn', 'videoBtn']) assert.match(loop, new RegExp(`els\\.${b}\\.disabled = .*\\|\\| rec\\.on\\n`), b)
  assert.match(read('canvas/marks.js'), /export async function sendComment\(text, target = null\) \{\n[^\n]*\n  if \(rec\.on\) await stopReplay\(\{ any: true \}\)/)
  assert.ok(loop.indexOf('await replaySay(els.brief.value)') > 0 && loop.indexOf('await replaySay(els.brief.value)') < loop.indexOf('await modeSend(modeHelp)'), 'before the chat\'s modes')
  // its lines in the chat are tagged; the mark is said once (role=status), names only, no title attribute
  assert.match(panels, /if \(rec\.event\) \{ item\.classList\.add\('replayed'\)/)
  assert.match(html, /<span class="replay-live" id="replay-live" role="status"><\/span>/)
  assert.match(panels, /<button type="button" class="st-stop" aria-label="Stop replay" hidden>Stop<\/button>/)
  assert.ok(!/title=/.test(read('replaytalk.js')))
  const page = readFileSync(new URL('../server/page.mjs', import.meta.url), 'utf8')
  assert.equal(page.split("'replaytalk.js'").length, 2, 'listed once')
  assert.ok(page.indexOf("'replaytalk.js'") < page.indexOf("'canvas/core.js'"), 'loads before the canvas that uses it')
})

// ---------- a website build in words, from the server's one state of it (engine/buildstate.mjs)
const MODEL = { code: 'model', message: "The model didn't answer (no model here).", action: 'Resume, or pick another model in `hermes model`.' }
const st = (state, more = {}) => ({ state, done: 0, planned: 0, kept: 0, failed: [], reason: null, next: null, ...more })
const fails = n => Array.from({ length: n }, (_, i) => ({ page: 'visit', layer: `s${i}`, why: 'HTTP 500' }))

test('the strip reads the build state: it never guesses from the sections on the canvas', () => {
  assert.deepEqual(buildStrip(st('planning')), { state: 'planning', text: 'Planning the pages', num: '', pct: 0 })
  // a next version that has planned nothing: planning, not "3 pages built 9/9" of the sections it was handed (B7)
  assert.deepEqual(buildStrip(st('planning', { kept: 9 }), { pages: 3 }), { state: 'planning', text: 'Planning what to add', num: '', pct: 0 })
  // building counts this build's own work, and reads as building between two sections too (nobody holding one)
  assert.deepEqual(buildStrip(st('building', { done: 1, planned: 4, kept: 5 }), { working: 2, pages: 3 }), { state: 'working', text: '2 agents building', num: '1/4', pct: 0.25 })
  assert.equal(buildStrip(st('building', { done: 1, planned: 4 }), { working: 0 }).text, '0 agents building')
  assert.equal(buildStrip(st('building', { done: 1, planned: 4 }), { working: 1 }).text, '1 agent building')
  // ended: every section standing of every section there is
  assert.deepEqual(buildStrip(st('done', { done: 1, planned: 1, kept: 9 }), { pages: 4 }), { state: 'done', text: '4 pages built', num: '10/10', pct: 1 })
  assert.equal(buildStrip(st('unchanged', { kept: 9 }), { pages: 3 }).text, '3 pages built')
  // a build with failed sections is never "N pages built", whatever is on the canvas
  assert.deepEqual(buildStrip(st('partly', { done: 5, planned: 9, failed: fails(4) }), { pages: 3 }), { state: 'paused', text: 'Partly built', num: '5/9', pct: 5 / 9 })
  assert.deepEqual(buildStrip(st('failed', { planned: 9, failed: fails(9) }), { pages: 3 }), { state: 'paused', text: 'Failed', num: '0/9', pct: 0 })
  for (const s of ['stopped', 'halted', 'replaced', 'unsure']) assert.deepEqual(buildStrip(st(s, { done: 3, planned: 9 })), { state: 'paused', text: 'Stopped', num: '3/9', pct: 3 / 9 })
  // stopped before any page: Stopped, never Ready (B15)
  assert.deepEqual(buildStrip(st('halted')), { state: 'paused', text: 'Stopped', num: '', pct: 0 })
})

test('the progress line counts a running build\'s own work', () => {
  assert.equal(buildProgress(st('planning')), 'Planning the pages…')
  assert.equal(buildProgress(st('planning', { kept: 9 }), { working: 0, pages: 3 }), 'Planning what to add…')
  assert.equal(buildProgress(st('building', { done: 1, planned: 4, kept: 5 }), { plan: 'Planned 3 pages.', working: 2, pages: 3 }), 'Planned 3 pages. 2 agents building · 1/4 sections across 3 pages')
  assert.ok(buildLive(st('planning')) && buildLive(st('building')))
  for (const s of ['done', 'unchanged', 'partly', 'failed', 'stopped', 'halted', 'replaced', 'unsure']) assert.equal(buildLive(st(s)), false, s)
  assert.equal(buildLive(null), false)
  for (const s of ['partly', 'failed', 'stopped', 'halted', 'replaced', 'unsure']) assert.equal(buildLeft(st(s)), true, s)
  for (const s of ['planning', 'building', 'done', 'unchanged']) assert.equal(buildLeft(st(s)), false, s)
})

test('what the chat says of a build with something left is made from the state, and is never "built"', () => {
  // some sections failed (B1): what stands, how many failed, why
  assert.equal(endWords(st('partly', { done: 5, planned: 9, failed: fails(4), reason: MODEL, next: 'resume' })), "5 of 9 sections are built and kept; 4 failed. The model didn't answer (no model here).")
  // a resumed build whose sections failed again counts the sections it was handed as standing
  assert.equal(endWords(st('partly', { done: 0, planned: 4, kept: 5, failed: fails(4), reason: MODEL, next: 'resume' })), "5 of 9 sections are built and kept; 4 failed. The model didn't answer (no model here).")
  assert.equal(endWords(st('failed', { planned: 9, failed: fails(9), reason: MODEL, next: 'resume' })), "None of the 9 sections are built; 9 failed. The model didn't answer (no model here).")
  // a page the planner never gave a section: something is left and nothing failed
  assert.equal(endWords(st('partly', { done: 9, planned: 9, next: 'resume' })), '9 of 9 sections are built and kept.')
  // stopped by the person, as it always read; with nothing to resume, Resume is not named
  assert.equal(endWords(st('stopped', { done: 3, planned: 9, reason: { code: 'person', message: 'Stopped by you.', action: '' }, next: 'resume' })), 'Stopped. 3 of 9 sections are built and kept. Say what to change, or Resume.')
  assert.equal(endWords(st('stopped', { done: 9, planned: 9 })), 'Stopped. 9 of 9 sections are built and kept. Say what to change.')
  assert.equal(endWords(st('stopped')), 'Stopped before any page was planned.')
  // stopped for a cause: the cause in its own words, then what is kept
  const slow = { code: 'timeout', message: 'Stopped: the model took too long to answer.', action: 'Resume; if it keeps happening, pick a faster model in `hermes model`.' }
  assert.equal(endWords(st('halted', { done: 3, planned: 9, reason: slow, next: 'resume' })), 'Stopped: the model took too long to answer. 3 of 9 sections are built and kept.')
  assert.equal(endWords(st('halted', { reason: { ...slow, action: 'Try again.' }, next: 'again' })), 'Stopped: the model took too long to answer.')
  // nobody knows why it ended
  assert.equal(endWords(st('unsure', { done: 3, planned: 9, next: 'resume' })), 'This run stopped before it finished. 3 of 9 sections are built and kept.')
  assert.equal(endWords(st('unsure', { next: 'again' })), 'This run stopped before it finished.')
  // an old build that ended having planned nothing
  assert.equal(endWords(st('failed', { next: 'again' })), 'Stopped before any page was planned.')
  // whatever the state, the words never claim a finished build
  for (const s of ['partly', 'failed', 'stopped', 'halted', 'replaced', 'unsure']) {
    const said = endWords(st(s, { done: 5, planned: 9, failed: fails(4), reason: MODEL, next: 'resume' }))
    assert.doesNotMatch(said, /All \d+ pages? (is|are) built|play the prototype|HTTP 500/, s)
  }
})
