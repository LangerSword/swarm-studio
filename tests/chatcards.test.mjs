// The chat's helper cards in the classic chat (web/chatcards.js, decision 0025 e): joined into the canvas's one
// script before the talk that draws them, every top-level name says chatCard, and what the talk keeps of them for
// the next turn is the server's own line (engine/helpers.mjs cardsLine).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANVAS_MODULES } from '../server/page.mjs'
import { cardsLine } from '../engine/helpers.mjs'
import { chatCardsLine } from '../web/chatcards.js'

const root = fileURLToPath(new URL('..', import.meta.url))

test('the canvas carries the cards before its talk, and their names say chatCard', () => {
  assert.ok(CANVAS_MODULES.indexOf('chatcards.js') >= 0 && CANVAS_MODULES.indexOf('chatcards.js') < CANVAS_MODULES.indexOf('canvas/talk.js'))
  const src = readFileSync(join(root, 'web', 'chatcards.js'), 'utf8')
  for (const m of src.matchAll(/^(?:export )?(?:const|let|function) (\w+)/gm)) assert.match(m[1], /chatCard/i, m[1])
})

test('what the talk keeps of the cards is the server\'s line, in both chats', () => {
  const cards = [{ id: 'c1', title: 'Iron sword', source: 'pack A, CC0' }, { id: 'c2', title: 'Bone sword', source: 'pack B' }]
  assert.equal(chatCardsLine(cards), cardsLine(cards))
  assert.equal(chatCardsLine([]), '')
  const ui = readFileSync(join(root, 'ui', 'src', 'chat', 'useTalk.ts'), 'utf8')
  assert.match(ui, /\n\[Shown: \$\{cards\.map\(\(c, i\) => `\$\{i \+ 1\}\. \$\{c\.title\} \(\$\{c\.source\}\)`\)\.join\('; '\)\}\]/, 'the next UI keeps the same line')
})
