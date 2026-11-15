# The redesign plan

Owner, 2026-11-15: the visual design is done again, screen by screen, on one design canvas. This is the order of
the work and why. It changes as we talk; each change is dated at the bottom.

The finding that sets the order: most of what is wrong is not how screens look. Screens disagree about what is
true, the chat claims things that did not happen, and failures have no way forward. Drawing first would give
better-looking versions of the same gaps. So: see everything, fix what is untrue, say what each screen is for,
then draw.

## 1. See everything (in progress)

- Every screen and state, at 1440 and 390 wide: `scripts/walkthrough.mjs` (272 steps: the first screens, the
  game plan chat, the missing screens, six flows with their failures).
- Controls found only by hovering, full sentences at rest, internal words and raw errors are marked on each
  picture (`scripts/walkthrough-board.mjs`).
- Done when: the board shows every flow as a strip, and every step is reached or says why it cannot be.

## 2. The state table

One table per thing a person works with: a build, a plan, a picture, a chat turn, a publish.

- Rows: every state it can be in. Idle, working (who, on what, how far), needs you, done (with proof), partly
  done, failed (why, and one way forward), unsure.
- Columns: every screen that shows that thing, and what it shows there.
- A row with no screen is a missing state. Two screens that disagree in one row is an untrue screen.
- Done when: each table is in `docs/ux/states/`, and its holes are a list.

## 3. Make it true (before any drawing)

Each hole or untruth from step 2 is a small change with a test, as the game chat's was (PR 600).

- One state per thing, read by every screen (the card, the Overview, the deck, the chat).
- What the chat says is made from that state and checked against it.
- Every failure says why in plain words and offers one way forward (Try again, Resume, Set up).
- No raw errors as Hermia's words.
- Known so far: "All 3 pages are built" with 4 failed; a failed project reads "Designed"; no Resume on a failed
  build opened again; "Try again" answers "Couldn't start it again: ask"; the app chat cannot start the app build;
  a change typed on an unbuilt app starts a website build; a new chat is blank.

## 4. A brief per screen

One short page per screen, beside its picture on the canvas, approved by the owner area by area:

| Question | |
|---|---|
| Who is here, and what do they want? | |
| How did they get here? (every way in) | |
| The one main action | |
| What does the AI know and say here? | |
| Each state from the table | |
| What is shown instead of told? | |
| Word budget | names only at rest |
| How do they leave, and to where? | |

A screen is ready to draw when every row has an answer.

## 5. Draw, area by area

On the canvas (Figma is the likely one; not confirmed). For each area: the pictures as they are, the brief, the
new design, the owner's yes.

Order (the owner may change it):
1. The chat and a project's Overview (decided 2026-11-15: the chat is always open on the left and its box is
   the one place to type; the bottom bar keeps its tools).
2. The game Plan board and its chat.
3. Projects and Make.
4. The Design deck.
5. The rooms: App, Game, Film.
6. Publish and Promote.
7. Setup and Settings.

Standing rules for every design: no tooltips, nothing behind a hover, names only at rest, show instead of tell,
no blue, purple or green, a crew cursor on anything loading, every button has a typed route in the chat.

## 6. Build, and keep it true

- Each approved area is built, then the walkthrough runs again: every state reached, no marks left.
- The walkthrough becomes the check that stops a state going missing again.

## 7. Real people

Five people, twenty minutes each, thinking aloud, on the redesigned flows. What they trip on reorders the list.

## Later

- What the Studio remembers about a person across projects (taste, past decisions).
- Usage data, opt-in only, to see where people stop.

## Changes

- 2026-11-15: written.
- 2026-11-15 (later), owner: "I like our look a lot. It's just the dead ends that are causing the issues and our
  app not doing what it's supposed to." The look and the screens stay. This is a repair of behaviour, not a
  visual redesign. What gets fixed, in the owner's words: the dead ends; the chat as a second way to control
  everything a button does; dependencies the app does not install; the defects caught in the capture; the state
  engine. Step 5 ("Draw, area by area") shrinks to the few places a fix needs a new or changed screen (a
  missing failure state, the chat on the Overview). Nothing is removed or restyled to match another product.
- 2026-11-15 (step 3), made true so far, each with a test and the walkthrough's pictures: a failed project no
  longer reads "Designed" (PR 641, the build state); "All 3 pages are built" with 4 failed, no Resume on a failed
  build opened again, and "Try again" answering "Couldn't start it again: ask" (PR 642: the Design deck and the
  Overview read the same state). The holes still open are listed in [states/build.md](states/build.md).
