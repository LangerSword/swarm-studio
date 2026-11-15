# State tables

Step 2 of [the redesign plan](../REDESIGN-PLAN.md). One table per thing a person works with. Each one shows
every state the thing can be in, what every screen says in that state, and where the screens are silent or
disagree. The holes listed here are the work list for step 3, "Make it true".

Written 2026-11-15 from the code on this branch and from the walkthrough's pictures. Nothing was run.

## The tables

| Thing | File | States | Holes |
|---|---|---|---|
| A build (website; app and game; film) | [build.md](build.md) | 15 + 7 + 7 | 26 (B1 to B26) |
| A game plan and its sketch sheets | [plan.md](plan.md) | 30 (plan, sheets, failures) | 26 (PL1 to PL26) |
| A picture being painted | [picture.md](picture.md) | 14 | 21 (PI1 to PI21) |
| One turn of the planner chat | [chat-turn.md](chat-turn.md) | 19 | 24 (C1 to C24) |
| Publishing (site, app, GitHub, Feed, export, launch kit) | [publish.md](publish.md) | 51 over six routes | 30 (PU1 to PU30) |

127 holes in all. Some are one root seen from two tables; the ranked list below joins those.

## What a state table is

- **A state** is defined by data, never by a screen: an event in a build's `events.jsonl`, a field in a plan's
  file, a job in the server's memory. Each state names the code that makes it so. States the code can reach
  count even when no screen names them.
- **Rows** are the states. The plan's words are used where they fit: idle, working (who, on what, how far),
  needs you, done (with proof), partly done, failed (why, and one way forward), unsure.
- **Columns** are the screens that show the thing: the Projects card, the Overview, the Design deck, the chat,
  the Log, the rooms.
- **A cell** is exactly what that screen shows in that state, in the screen's own words, with the code line
  that decides it.

## How to read a cell

- Words in quotes are on the screen as written. `N`, `PAGE`, `MESSAGE` or `${...}` stand for the parts that
  change.
- `path:line` in backticks is the line that decides the cell. Paths start at the repo root. Line numbers are
  this branch's; they move when the file changes.
- "shot `f-fail-deck`" names a walkthrough step whose picture shows the cell (`scripts/walkthrough-flows.mjs`,
  `scripts/walkthrough-more.mjs`, `scripts/walkthrough-chat.mjs`).
- **nothing** means the screen shows no sign of the state.
- **UNCHECKED** means the code did not settle it and no picture shows it. It is not a guess either way.
- **(inferred)** means the cell follows from the code but no picture or test shows it.
- The tables cover the classic Studio in `web/`, which is what the walkthrough pictures show. Where the React
  Studio in `ui/` has its own copy of a screen, the file says so in one line and does not table it.

## The four kinds of hole

- **(a) Missing state.** A state with "nothing" on a screen where a person needs to know.
- **(b) Untrue screen.** Two screens say different things in the same state.
- **(c) Dead end.** A failure with no reason in plain words, or no way forward (Try again, Resume, Set up).
- **(d) Loose sentence.** Words the screen says that are not made from the state: fixed text, or text counted
  from something else.

Each file ends with "Where the state should live": the one function every screen should read, and the screens
that do not read it today.

## The worst holes, across all five files

Ranked by how wrong the screen is and how easily a person hits it. Holes that share a root are joined.

1. **B1.** The chat says "All 3 pages are built" and "play the prototype" when sections failed. Fixed text picked by `e.resume` (`web/canvas/panels.js:350`, `web/canvas/panels.js:363`).
2. **B2.** A failed or stopped website reads "Website · Designed" on its card. The only test is "has one section" (`server/projects.mjs:98`), and a dead newest version borrows an older one's words (`web/home.js:102`).
3. **C1 (also C11, C23, B16, PL19, PI5, PU6).** Raw provider errors are shown as Hermia's words, with Build under them (`web/canvas/talk.js:86`, `server/server.mjs:3539`, `engine/llm.mjs:83`). The same raw text is printed by the build, the plan, a picture and a publish.
4. **B3 and B9.** No Resume when a failed or stopped build is opened again. Resume needs a `run:stopped` that was not the person's (`web/canvas/replay.js:225`), and a build whose sections all failed ends as `run:done` (`server/server.mjs:559`).
5. **B4.** "Try again" answers "Couldn't start it again: ask". It sends the brief with no "sure", so the ask-before-build rule refuses it (`web/canvas/panels.js:281`, `server/server.mjs:3346`).
6. **C2, C3, B12, B13, C21.** "An app that is designed and not built" is a state no screen reads. "App" is known only from `app:ready` or `app:done` (`server/board.mjs:52`). So a change typed in the Overview bar starts a website build (`web/route.js:26`, `web/project.js:1338`), the app chat can only say "Build the app first" (`web/canvas/wander.js:48`), and the card says "Website".
7. **PL1.** "Next: build the game from the plan." has one button, "Read the plan", and no code builds a game from a plan (`engine/gamestep.mjs:130`, `web/kit-game.js:53`).
8. **B6.** A build replaced by a newer one, or cut off by a restart, has no end event, and no screen says what happened. The replaced build's own stop is dropped (`server/server.mjs:554`). Read from the code, not seen.
9. **PU3 and PU2.** A half-built or failed build can be published with no warning, since the button reads a count of sections (`web/canvas/loop.js:148`). "Live" on the card comes from any publish ever, and is checked before "Building" and "failed" (`server/projects.mjs:81`, `server/projects.mjs:85`).
10. **B5.** On the Overview a failed section looks like one still loading, and pulses for good. The board keeps only `done` per section (`server/board.mjs:43`, `web/project.css:86`).
11. **PL2 and PI2.** Work left "in progress" by a server stop stays that way for good: a plan's art build (`server/plans.mjs:338`), a website picture in the queue (`server/board.mjs:61`). Same root as B6: nothing closes open work on restart, except for films.
12. **B8.** A build still planning, opened by its address, reads "Ready" and says it is an old file (`web/canvas/replay.js:217`, `web/canvas/replay.js:232`).
13. **B7.** "0 agents building · 9/9 sections" and "3 pages built" before the next version has planned anything (`web/canvas/loop.js:155`, `engine/run.mjs:123`).
14. **C5 and C4.** "Building it now…" is said and saved before the build is asked for (`engine/askfirst.mjs:119`, `web/canvas/talk.js:145`), and the whole talk leaves the chat when the build starts (`web/canvas/events.js:26`, `web/canvas/base.js:70`).
15. **PI1.** A failed repaint wipes a good picture on the deck, while the Overview and the export keep it (`web/canvas/events.js:245`).
16. **PL4 and PL5.** The plan's lock is kept twice, and what the board does never reaches the chat (`server/talk.mjs:171`, `web/home.js:275`, `web/home.js:91`).
17. **PU1.** A publish to this computer only reads "Live" on the card and the button (`server/projects.mjs:81`, `web/canvas/loop.js:149`).
18. **B10 and B11.** Fix mode drops "Finish the build" exactly when no model answers, and says "Nothing failed" for a build the model stopped (`engine/doctor.mjs:199`, `engine/doctor.mjs:163`).
19. **PI6 and PL8.** No image model: a website build says nothing and offers no Set up; the plan chat still offers "Paint" (`engine/setup.mjs:21`; see the files).
20. **C6 and C7.** Hermes not running gives four different answers on four roads, and the game chat hides a planner that did not answer (`engine/talkplan.mjs:314`).

## The roots

Most of the 127 come from six causes. Fixing a root closes its holes in every table.

1. **No one reader for a build.** The card, the Overview, the deck strip, the chat summary and Fix each work
   the state out again, from different facts (B1, B2, B5, B7, B8, B15, B18, B23, PU3). See "Where the state
   should live" in [build.md](build.md).
2. **A build has no "failed" or "partly done" end.** `run:done` with failed sections is treated as done
   everywhere (B1, B2, B3, B5, PU3).
3. **Open work is never closed.** A restart or a replaced build leaves "working" for good (B6, PL2, PL3, PI2,
   PU9).
4. **Errors are passed through as text.** The provider's string travels from the model call to the screen
   (C1, C8, C11, B16, PL19, PI4, PI5, PI15, PU6). Only a stopped build has a reason with a code, plain words
   and one action (`engine/stopreason.mjs:43`).
5. **Sentences written before the fact.** The chat says what is about to happen as if it had (C5, B25, PI14,
   PU8), or keeps an old line on screen (B14, PL22).
6. **"Designed, not built" is missing as a state** for apps, and "the plan is being painted" is missing
   outside the Plan board (C2, C3, B12, B13, PL13).

## What is UNCHECKED and matters

- The game plan chat's cells rest on code and tests: the walkthrough's `gc-*` steps are not in the pictures.
- A game's Art sheet cells are from code only: step `m-app-stage-art` was not reached.
- Why "Make the film" returns to the form with no reason (step `m-film-working`).
- The React Studio (`ui/src`) is not tabled. Known copies of a hole are named in each file (C23, PL26, PU29,
  and the picture file's last note); whether it repeats B1, B7 and B8 is not known.
- Replay, state by state, in [build.md](build.md).
- States marked "(inferred)" in the files were read from code and not seen: among them B6 (a replaced build),
  B9 (a build you stopped, opened again), B11, B17 and B19.
