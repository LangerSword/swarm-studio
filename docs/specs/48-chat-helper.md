# 48. The chat is the helper: tools the planner calls, cards the person picks

Decision [0025](../decisions/0025-tools-to-bring-things-in.md) part (e), issue #617. The owner, 2026-11-15:
**"and a chat as helper."**

Hermia, the planner in the chat, can use a tool when the person asks for what it does. The chat shows what the
tool found as a few cards to pick from, three at most, each saying where it came from. It is the same planner,
in every talk (a website's, an app's, a film's, a game's), not a second assistant. This is the interface each
part plugs its tool into: (a) research #606, (b) the game Plan board's intake #607, (c) the app builder's web
tools #608. The asset library search is the first tool wired (`server/chattools.mjs`).

## A tool

Add it to `chatTools()` in `server/chattools.mjs`. It is built from the server's own stores, which `server.mjs`
passes in.

```js
{
  name: 'library_search',                     // [a-z][a-z0-9_]{1,39}: what the planner writes
  about: 'find pictures in the asset library', // one line for the planner's prompt: what it does
  args: { q: 'what to look for, in a few words' }, // each argument and what it is; strings only
  kinds: ['game'],                            // the talks it is offered in; omit for every kind
  run: async (args, ctx) => ({ text, cards }), // ONLY READS (below)
  act: async (act, ctx) => ({ text })          // what pressing one of its cards does; may write
}
```

- **`run` only reads.** The planner reads pages and documents the person gave it, so a tool call can come from
  text nobody typed. A run must never write, spend, download for keeps or publish. Anything that does is a card.
- **A card** is `{ title, source, img?, note?, act?, pick? }`:
  - `source`: where it came from (a pack and its credit, a site's address, a connector's name). Required: a card
    without one is dropped.
  - `img`: a path on the Studio (`/api/…`, `/ref/…`) or an `https://` picture; anything else is dropped.
  - `act`: the data `act()` gets when the card is pressed; without it the card is only to look at.
  - `pick`: the button's words (default "Use this").
- **`text`** is one plain sentence for the chat, said after the planner's own sentence.
- **`ctx`** is where the talk is: `{ kind, project, run, plan, chat }` (any may be null). A card's `act` should
  carry where it goes (`{ id, project }`, `{ id, plan }`), since the press may come later.

## What the runner does for every tool (`engine/helpers.mjs`)

- **Three cards at most**, the first three with a source.
- A tool that throws says so in one plain line ("I could not find pictures: …"); the talk goes on.
- A tool not offered in this kind of talk, or one the planner made up, answers "That is not something I can do
  from this chat."
- The browser gets the cards without their `act` (`cardsView`), only whether a card can be pressed.

## How the planner calls one

- **Website, app and film talks** (`POST /api/discuss`, `engine/talkplan.mjs discuss`): the tools are listed in
  the prompt (`helperKit().lines(kind)`). The planner replies with one sentence, then
  `{"tool": "<name>", "args": {…}}` on its own line. A reply that is only that block is a tool call, never "no
  answer"; a build block is read only when there is no tool.
- **Game talks** (`POST /api/talk`, `engine/talkplan.mjs say`): the turn's JSON takes one more field,
  `"tool": {"name": "<name>", "args": {…}}`, beside `say`, `decide` and `ask`.
- The answer joins the chat as the planner's turn, with its `cards` kept on the turn (`engine/chats.mjs`). The
  next turn's planner sees what was shown (`cardsLine`: "[Shown: 1. … (source); 2. …]"), so "the second one" can
  be read.

## What the browser gets

- `POST /api/discuss` answers `{ reply, cards, turn, heard, chat }` when a tool ran:
  - `cards`: up to three, without actions. A card with `pick` has a button with those words.
  - `turn`: the saved planner turn the cards are on.
  - `heard`: what to keep in the talk's `said` instead of `reply`, so the next turn knows what was shown.
  - Cards whose turn could not be saved come without `pick`: they can be looked at, not pressed.
- A game talk's planner turn carries `cards` the same way (`/api/talk` answers the chat).
- **A press:** `POST /api/helper/pick { chat, turn, card }` → `{ text, card, chat }`.
  - The action is the one kept on that saved turn; nothing the browser sends is run.
  - It runs once: a second press answers 409. A card only to look at answers 400.
  - Hermia's answer (`text`) joins the chat as her next turn.

## Rules that hold for every tool (decision 0025)

- Online only through Hermes's own tools (the bridge's `POST /web`, `ctx.call_mcp`) or a connector the person
  granted; no new key reaches the Studio; the site walk's SSRF guard and the sandbox rules hold.
- What was fetched is shown with its source before it is used.
- Nothing writes, spends or publishes without the person's press or yes; publish, post and deploy still go
  through Hermes's approval.
- A new host or tool is disclosed in `plugin.yaml` and the README.

## Drawing the cards

- The classic Studio: `web/chatcards.js` under Hermia's message in `web/canvas/talk.js` (every classic chat, the
  Design deck's included). A reopened chat draws its turns' cards again (`saidOf`).
- The next UI: `ui/src/chat/ChatCards.tsx` in `Feed.tsx`, pressed through `useTalk().pickCard` (every chat built on
  `Chat`, the Design deck's `DeckChat` included). The dock is short, so a card is a small picture beside its words.
- A card's picture is shown only when it is on disk already (`/library/pic?id=`, no token, never fetched), so
  showing what the chat found downloads nothing; one not on disk shows its words alone.
- A press that kept something fires `swarm:refs` on the window; the Studio boards (`web/scaffold.js`,
  `ui/src/screens/studio/useStudio.ts`) reload their References.

## Not yet

- **Ask mode** (spec 46) offers no tools: it changes nothing and keeps no chat, so a card could not be pressed.
- **The prompt evals** (decision 0019) don't cover `engine/talkplan.mjs`. The tool form is checked by
  `tests/helpers.test.mjs` with a scripted planner (`scripts/walkthrough-fixtures.mjs` `studio({ model })`).
