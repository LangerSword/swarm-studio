# The walkthrough, and what it checks by itself

`scripts/walkthrough.mjs` drives a throwaway Studio through every screen and state a person can reach, at 1440 and
390 wide, and takes a picture of each. On every state it captures it also looks for defects, so nobody has to
watch every screen. This page says what it checks, what fails a run, and how to run it.

The files here: `img/`, `shots.json` (what was captured and measured), `index.html` and `notes.json` (the review of
an older capture, `scripts/walkthrough-page.mjs`), `defects-baseline.json` (the accepted defects). A run also
writes `defects.json`, and `scripts/walkthrough-board.mjs` writes `board.html` with the defects at the top.

## What is checked on every captured state

| Kind | Mark | What it finds | Fails the run |
| --- | --- | --- | --- |
| `axe:<rule>` | A | A standard rule broken (axe-core, WCAG 2.0 to 2.2 A and AA) in the Studio's own UI: a control with no name, contrast, a form field with no label. Built pages (iframes) are left out, as in CI's `ui-audit`. | yes, by count; reported only on a step caught while a build runs |
| `raw` | E | Raw error text ("HTTP 500", `{"error"`, a stack) in the chat or a toast. The Log and a Details panel may print it. | yes |
| `state` | S | A screen that disagrees with the build's one state (`GET /api/runs/<id>/state`): the deck's strip, the planner's last line in the chat, the Overview's tags, a Projects card. A failed or partly built build that reads "3 pages built", "All 3 pages are built" or "Designed" is one. | yes |
| `dead` | D | A click after which nothing changed: no change in the page, no request, the same address, for a second. Only for actions a step wraps in `env.acted`. | yes |
| `wait` | W | A request still going a second after it was asked for, with no crew cursor, skeleton, progress or busy mark on screen. | no, reported |
| `shift` | L | Layout shift over 0.1 in the state the step shows (the browser's own `layout-shift` entries, three seconds or more after the page loaded). | no, reported |
| `load` | O | Layout shift over 0.1 in a page's first three seconds. Today every load of the Studio has it (0.19 to 0.39: the top bar moves as it fills), so it is said once per step that loads a page. | no, reported |

The hand-written audit (`scripts/walkthrough-audit.js`) keeps the house rules a standard engine has no rule for:
tooltips, targets under 40 px (44 on touch), blue, purple or green in the chrome, internal words, sentences at
rest, sideways scroll, and (in the runner) controls found only by hovering. Names are axe's now; the audit's own
`unnamed` count is gone.

**Target size stays with the hand audit.** axe's `target-size` rule defaults to 24 px, passes a small target that
has room around it, and `@axe-core/playwright` 4.14 has no way to reconfigure a rule's checks (no `configure`). The
house rule is 40 px (44 on touch) with no such exception, so `small` is the source of truth and axe's rule is off
here.

Where each rule lives:

- `scripts/walkthrough-checks.mjs`: the rules, with no browser. Which words go with which build state
  (`BUILD_SAYS`, beside `web/replaytalk.js`'s words and `server/projects.mjs`'s card words), what counts as a
  defect, the ratchet. `tests/walkthrough-checks.test.mjs` holds them.
- `scripts/walkthrough-probe.mjs`: what is measured in the page.
- `shots.json`: each step has `axe` (rule, impact, count, up to five nodes with their boxes) and `checks`
  (`raw`, `state` with what it read off the screen in `state.read`, `dead`, `wait`, `shift`, `loadShift`). A check that could not measure says so in
  `checks.errors`; it never marks the step "not reached".

## A click that does nothing, a wait with no cursor: `env.acted`

The runner cannot know which line of a step is the person's click. A step wraps it:

```js
await env.acted(() => env.page.locator('#brief').press('Enter'), 'Send')
```

The action is watched for a second. If nothing changed it is a dead click; if a request it started is still going
with nothing on screen saying so, a silent wait. Neither throws. `f-web-thinking`, `f-web-brief-wait`,
`f-change-building` and `f-fail-overview-resume` use it; a new step that presses something should too.

## The baseline: a ratchet

`defects-baseline.json` holds the accepted count of each kind for each step (`desk:f-web-no-answer`: `raw` 1).
A count may go down, never up.

- The run exits 1 only when a step it captured has more of a failing kind than the baseline accepts. Each is
  printed as `NEW: <step> <kind> was → now`.
- A step with no entry counts from nothing: a defect on a new step is new.
- A step caught while a build runs (a step with `uses: 'live'`, or one whose build is planning or building) is
  not held for axe: what is on screen then differs from run to run (`m-ov-tell-busy` had a rule one run and not
  the next, on the same code). Its axe findings are recorded and shown; its other checks are held as anywhere.
- **A step that is not reached has no checks and is not compared.** A step that throws on its own truth
  assertion is "not reached": the run prints it with ✗ and still exits 0. Read the ✗ lines.
- Only the steps of this run are compared, and only the ones reached.
- A count that went down is printed as `fixed:`; `--update-baseline` keeps it down.
- `--update-baseline` accepts what this run found for the steps it captured, and keeps the rest.

The baseline committed with the checks covers the 31 desk steps of the proof slice only. **The first full run must be
accepted once** (`--update-baseline`, then read the board and commit the file): until then every other step
counts from nothing.

## Running it

It needs Playwright with its Chromium, and `@axe-core/playwright` (pinned in `tools/dev`, as `ui-audit` uses it).
Without axe the run goes on and says the standard rules were not checked.

```
npm ci --prefix tools/dev
PLAYWRIGHT_DIR=<folder with playwright> WALK_PLAN_FILES=<the plan's pictures> \
  node scripts/walkthrough.mjs --out <folder> [--only desk|phone] [--steps id,id] [--no-hover] [--no-axe] [--update-baseline] [--baseline <file>]
node scripts/walkthrough-board.mjs --out <folder>      # board.html, the defects first, and defects.json
```

The whole walkthrough takes over an hour and is run on the MacBook Pro, never on a laptop used for editing, and it
is not a CI job yet. When it becomes one, this is the command; its exit code is the gate.

A step that goes on from the page the last one left needs the steps before it in `--steps` (`f-fail-live` needs
`f-fail-working`; the `gc-` steps run in order).

## The navigation charts: reachability

`node scripts/nav-reach.mjs` walks the live navigation chart (`web/nav.js`) and the design of every screen
(`docs/ux/statechart/studio.machine.js`) with `xstate/graph`, no browser, and lists the states with no way in, the
dead ends, the states only the top-level moves leave, the events nothing takes, and the events the Studio's code
sends that the chart does not declare. What it finds must be what `docs/ux/statechart/reach-baseline.json`
accepts (`--update` accepts a change). CI runs it with the property tests
(`npm run --prefix tools/dev property`).

## Not checked yet

- Flicker (something added and removed within a few hundred milliseconds).
- A screen that was wrong from its first picture: pixel comparison comes after the defects here are cleared, so
  they are not frozen into the reference pictures.
- The chat's claims beyond the build's state (counts in a reply the planner wrote).
- States a chart does not have. `docs/ux/states/` lists those by hand.
