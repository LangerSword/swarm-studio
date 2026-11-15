# State table: a build

A build is one run of the crew: a website's layout pass, then an app build, a game build or a film made on top
of it. Everything a build did is one file, `runs/<id>/events.jsonl`. The server also keeps the newest website
build in memory (`current`, `server/server.mjs:543`) and the app, game and film jobs in maps. This page lists
every state those two sources can make, what each screen shows in it, and where the screens disagree. The
website build comes first and in full. The app and game build and the film follow, only where they differ.

Read with [README.md](README.md). Pictures being painted after the layout are in [picture.md](picture.md). The
chat turn that starts a build is in [chat-turn.md](chat-turn.md). Publishing a build is in
[publish.md](publish.md).

Evidence: code in this worktree, and the walkthrough shots named in the cells (step ids such as
`f-fail-live`). Nothing was run when the table was first written; the cells changed by the build state's move
onto the Design deck and the Overview were checked against the walkthrough's `f-fail-*`, `f-change-*` and
`m-deck-planning` shots, run on 2026-11-15. "(inferred)" marks a cell read from code paths that no shot shows.

## States

### The website build

Each state is defined by the run's events and by whether the server still holds the run as `current`.

| Id | State | The data that makes it so |
|---|---|---|
| W1 | No build | No run: no `events.jsonl`. The deck holds `S.run = null` (`web/canvas/base.js:76`). |
| W2 | No model key | `startRun` finds no planner or worker key and emits one `error` with `where: 'models'`, and no `run:start` (`server/server.mjs:585`, `server/server.mjs:586`). The run never ends: it has no end event. |
| W3 | Planning (working: Hermia, on the pages) | `run:start` (`engine/run.mjs:121`), no `layer:plan` yet, and the run is `current` and not done. The server calls it stage `planning` (`server/server.mjs:739`). |
| W4 | Building (working: N agents, d of t sections) | At least one `layer:plan` (`engine/run.mjs:147`), the run is `current` and not done. `agent:assign` says who is on what (`engine/run.mjs:383`). `plan:done` says the plan is whole (`engine/run.mjs:363`). |
| W5 | Waiting for Hermes | A `hermes:waiting` event while W3 or W4 (`web/canvas/start.js:55`). Model calls wait until Hermes is back. |
| W6 | Next version starting | `run:start` with `extend: true` (and `resume: true` after Resume). The last version's pages and sections are sent again first, as `layer:plan` and `layer:done` (`engine/run.mjs:123`). Only the `layer:done` carries `kept`; a carried `layer:plan` has no mark (`engine/extend.mjs:29`). Nothing new is planned yet. |
| W7 | Done, every section built (done, with proof) | `run:done` with `failed: 0` and `done` equal to `planned` (`engine/run.mjs:503`). In a next version these counts are the new work only, a changed section adds to `done` and not to `planned` (`engine/run.mjs:469`), and `failed` still counts a section that failed and was built later. So the state is counted from the sections, one per page and id, not from these numbers (`engine/buildstate.mjs:65`). |
| W8 | Done with failed sections (partly done) | `run:done` with `failed > 0`. Each failure is a `layer:failed` with the provider's message (`engine/run.mjs:433`, `engine/run.mjs:434`). This includes "0 built, all failed": the run still ends with `run:done`, because the server turns `run:done` into `run:stopped` only when nothing was planned (`server/server.mjs:559`). |
| W9 | Next version added nothing | `run:done` with `extend: true` and nothing added or changed, after an `error` with `where: 'planner'` (`engine/run.mjs:286`, `engine/run.mjs:365`). It stays `run:done`: the rule at `server/server.mjs:559` skips a next version. |
| W10 | Stopped by you | `run:stopped` with `reason.code: 'person'` (`server/server.mjs:690`, `engine/stopreason.mjs:22`). Sections caught half way are left unbuilt, not failed (`engine/run.mjs:431`). |
| W11 | Stopped for a cause, some sections built (failed: why, and Resume) | `run:stopped` with `reason.code` `model`, `timeout` or `hermes`, and at least one `layer:plan` (`engine/stopreason.mjs:46`, `engine/stopreason.mjs:47`, `engine/stopreason.mjs:57`). |
| W12 | Stopped for a cause, nothing planned (failed: why, and Try again) | The planner failed before any page: `run:done` with `planned: 0` and a planner `error` is rewritten to `run:stopped` with a reason (`server/server.mjs:559`, `server/server.mjs:561`), or the run threw (`server/server.mjs:624`, `server/server.mjs:626`). Builds saved before that rule end with `run:done` and `planned: 0` and no reason, and older stops carry no `reason` at all: both are on the owner's disk (2026-11-15). |
| W13 | Replaced by a newer build | A second website build starts: the first is aborted with `'replaced'` (`server/server.mjs:529`). Its `run:stopped` is then dropped, because the server only records events of the run that is `current` (`server/server.mjs:554`). So the file ends with no end event (inferred). The reason code `replaced` (`engine/stopreason.mjs:21`) can not reach the file: `current` is set in one place only (`server/server.mjs:544`), and the one test that names the code checks the function, not a build's file (`tests/hermeshealth.test.mjs:121`). |
| W14 | Unsure: no end event | `run:start` with no `run:done` and no `run:stopped`, and the run is not `current`. Reached by W13, and by the server stopping mid-build. Films get an end written on restart (`server/server.mjs:4832`); website builds get none. |
| W15 | After the layout: painting or reviewing | `run:done`, then the picture queue or a review is busy (`server/server.mjs:741`, `server/server.mjs:742`). See [picture.md](picture.md). |

### The app build and the game build

Same file, other events. The state is `state(id)` in `engine/appjob.mjs:300`: the job in memory, else the last
of `app:start`, `app:done`, `app:failed`, `app:paused` in the file.

| Id | State | The data that makes it so |
|---|---|---|
| A1 | Designed, no app yet (idle) | No `app:*` event (`engine/appjob.mjs:310`). A game run says `kind: 'game'`. |
| A2 | Working (who: the engine; how far: the step line) | Job state `working` after `app:start` (`engine/appjob.mjs:402`, `engine/appjob.mjs:406`). Each `app:step` is the stage. |
| A3 | Working in another Studio | The last word is `app:start` and its process is alive elsewhere (`engine/appjob.mjs:315`). |
| A4 | Your turn (needs you) | `app:paused`: a big game stops after each slice and asks (`engine/appjob.mjs:463`, `engine/appjob.mjs:465`). |
| A5 | Built (done) | `app:done` (`engine/appjob.mjs:479`, `engine/appjob.mjs:483`). "Running" when a server address is known. |
| A6 | Failed | `app:failed` with the error's first 400 characters (`engine/appjob.mjs:487`, `engine/appjob.mjs:489`). |
| A7 | Stopped | The last word is `app:start` and no process runs it, or `app:failed` with the message `stopped` (`engine/appjob.mjs:322`, `server/server.mjs:816`). |

### The film

| Id | State | The data that makes it so |
|---|---|---|
| F1 | No film | No `video:*` event. |
| F2 | Working (stage, percent) | `video:start`, then `video:progress`; the job is `working` (`server/server.mjs:1153`, `server/server.mjs:1204`). |
| F3 | Done | `video:done` (`server/server.mjs:1414`). |
| F4 | Failed | `video:failed` with the error's first 300 characters (`server/server.mjs:1424`, `server/server.mjs:1425`). |
| F5 | Stopped | `video:failed` with the message `stopped` (`server/server.mjs:1424`). |
| F6 | Cut off by a restart | On start the server writes `video:failed` "Swarm Studio restarted before the video finished. Make it again." (`server/server.mjs:4832`). |
| F7 | Refused at the start | The request to make the film is not accepted; no event is written. The page keeps the answer's `error` (`web/canvas/film.js:264`). |

## The table

### Website build: outside the Design deck

One rule sits above every Projects card cell on this page: a project with any publish ever saved reads
"Live · HOST" in every build state, building and failed included, because that test comes first
(`server/projects.mjs:81`, `server/projects.mjs:85`; PU2 in [publish.md](publish.md)). The cells below are
for a project that was never published. Since the build state (`engine/buildstate.mjs`) a website's card word
is made from that one state (`server/projects.mjs:63`, `server/projects.mjs:105`); the other columns still
work the state out themselves, except the Overview's artboards, which read the same state from the board (`build`).

| State | Projects card | Top bar: work chip and Stop | Overview: artboards | Overview: live line |
|---|---|---|---|---|
| W1 | nothing: with no run there is no card. ("Draft" is a run with no section: W12, W14) | nothing (`web/work.js:43`) | nothing: the stage is empty (shot `m-ov-empty`) | nothing |
| W2 | nothing: a run with no `run:start` has no card (`server/server.mjs:766`) | UNCHECKED | UNCHECKED | nothing |
| W3 | "Website · Building", crew cursors and a bar (`server/projects.mjs:92`, `web/home.js:187`) | Chip with a count and a bar; its list says "Site · planning". Stop is shown (`web/work.js:52`, `web/work.js:58`, `server/server.mjs:739`) | Page tiles appear as pages are named; the body is marked live (`web/project.js:192`). Before the first page: nothing | nothing: the line only speaks of painting and reviewing (`web/project.js:1373`) |
| W4 | "Website · Building", bar at done over planned (`server/server.mjs:839`) | "Site · building pages" with a bar (`server/server.mjs:739`) | Each page as blocks, one per planned section; unbuilt blocks are plain (`web/project.js:235`, `web/project.js:241`) | nothing |
| W5 | "Website · Building" (inferred) | as W4 (inferred) | as W4 (inferred) | nothing |
| W6 | "Website · Building" | "Site · building pages" with a full bar: the kept sections count as done (`server/server.mjs:739`; shot `f-change-building` shows the chip full) | The last version's pages, whole | nothing |
| W7 | "Website · Designed" (`server/projects.mjs:98`) | nothing | Each page's picture | nothing |
| W8 | "Website · Partly built" when one section or more stands. "Website · Failed" when none does. With an older version in the project the card keeps its newest build's own word (`server/projects.mjs:63`, `server/projects.mjs:105`, `web/home.js:103`). Before the build state: "Website · Designed", or the older version's words (shot `f-fail-projects`) | nothing | A page with failed sections wears a tag at its foot, "Failed" and "N sections", with Resume (the picture-failed tag and button, `web/project.js` `leftTag`, `web/project.css`). The board marks each failed section from the build state and carries the state whole as `build` (`server/board.mjs`). Unbuilt blocks no longer pulse once the build has ended: the pulse is for a build that runs (`body.pj-live`). Resume starts the next version and the Overview shows it (shot `f-fail-overview`). Before: a failed section was drawn as one still to come, and pulsed for good | nothing |
| W9 | "Website · Designed", its own: every section of the last version is there (`server/projects.mjs:63`). Before the build state the new version read "Draft" and the card took the older version's words | nothing | The last version's pages (inferred) | nothing |
| W10 | "Website · Stopped" (`server/projects.mjs:63`) | Stop reads "Stopping", then "Stopped" for 2.5 seconds, then the chip goes (`web/work.js:77`, `web/work.js:81`) | A page with sections left wears "Stopped" and "N sections left", with Resume (`web/project.js` `leftTag`); the blocks do not pulse | nothing |
| W11 | as W10 | nothing | as W10 | nothing |
| W12 | "Website · Stopped". With an older version that works, this empty one is not listed among the versions, and the card still reads "Stopped" (`server/projects.mjs:109`, `web/home.js:96`, `web/home.js:103`) | nothing | nothing: no pages (shot `m-ov-empty`) | nothing |
| W13 | "Website · Stopped" (inferred: no shot) | The chip now shows the newer build only (inferred) | as W10 (inferred) | nothing |
| W14 | "Website · Stopped" | nothing | as W10 | nothing |
| W15 | "Website · Building" with a sliding bar (`server/projects.mjs:92`, `web/home.js:187`) | "Site · painting pictures" or "Site · reviewing" (`server/server.mjs:741`, `server/server.mjs:742`) | Pages whole; picture slots as in [picture.md](picture.md) | "NAME painting 2 of 8", "NAME reviewing page 1 of 3" (`web/project.js:1380`, `web/project.js:1385`) |

### Website build: the Design deck, as it happens

"Strip" is the status strip at the top left of the canvas (`#status`). For a website build it reads the server's
one state of the build (`engine/buildstate.mjs`), sent to the page on the stream as `build:state` just before the
event that changed it and never saved (`server/server.mjs` `sayState`, `web/canvas/core.js` `buildOf`); the words
are `buildStrip` in `web/replaytalk.js`. The chat's progress line (`buildProgress`), its end-of-build sentence and
its Stopped message (`endWords`, `web/canvas/panels.js` `leftMsg`) read the same state. With no state (an app, a
game, the hosted studio, a build with no `run:start`) the strip still counts the sections on the page, as it did:
no sections and no end is "planning", no sections is "idle", all done is "done", an agent holding a section is
"working", anything else is "paused" (`web/canvas/panels.js` `renderStatus`, `statusWords`).

| State | Strip | Layers and canvas | Chat: progress line | Chat: messages | Log |
|---|---|---|---|---|---|
| W1 | "Ready" (`web/replaytalk.js:23`) | "Pages appear here once the planner names them." (`web/canvas/panels.js:75`) | nothing | "Describe a product below. A planner picks the pages, then a swarm of agents builds them on the canvas." (`web/canvas/base.js:70`) | nothing |
| W2 | "Planning the pages" with no end (inferred: the run is set and never ends, `web/canvas/panels.js:138`) | "Pages appear here once the planner names them." | nothing (no `run:start`, so no line is made) | One red line: "models: No model key yet. Start a build from Hermes once (/swarm, the chat tool or \`hermes swarm\`) so it can pass its model settings, or set SWARM_STUDIO_API_KEY." No button (`web/canvas/events.js:209`, `server/server.mjs:586`) | nothing |
| W3 | "Planning the pages" (shot `f-first-planning`) | "Pages appear here once the planner names them." | "Planning the pages…" (`web/canvas/events.js:37`, `web/replaytalk.js:32`) | The brief as the person's bubble (`web/canvas/events.js:35`) | "Planner is drafting PAGE" (`web/canvas/events.js:55`) |
| W4 | "N agents building" and "d/t" of this build's own sections, for as long as the build runs (it no longer flashes "Stopped" or "N pages built" between sections) | A row per section: its agent's dot while written, a red dot when failed (`web/layers.js:66`, `web/canvas.css:103`). Failed frames are hatched (`web/canvas/deck.js:194`) | "Planned P pages and S sections in Xs. N agents building · d/t sections across P pages" (`web/canvas/events.js:61`, `web/replaytalk.js:34`; shot `f-fail-working`) | nothing new | "Plan finished: P pages, L layers in Xs", what each agent says, "failed LAYER: MESSAGE" (`web/canvas/events.js:60`, `web/canvas/events.js:160`) |
| W5 | as W4 | as W4 | as W4 | nothing. A bar outside the chat says the server's message, or "Waiting for Hermes" (`web/canvas/start.js:36`) | nothing |
| W6 | "Planning what to add" with no count, then "N agents building" and this version's own "d/t" (shot `f-change-building`). Before: "3 pages built" and "9/9" | The last version's rows, all done | "Planning what to add…" until this version has a section of its own, then "N agents building · d/t sections across P pages" with its own count (`web/replaytalk.js` `buildProgress`; shot `f-change-building`). Before: "0 agents building · 9/9 sections across 3 pages" | The message as the person's bubble (`web/canvas/events.js:35`) | nothing |
| W7 | "P pages built" and "t/t" | Every row done | removed (`web/canvas/panels.js:360`) | "Built P pages and D sections in Xs with N agents. Open a page, or play the prototype." with Play prototype, Watch a visitor and a button per page (`web/canvas/panels.js:363`, `web/canvas/panels.js:369`) | "Done: D/P layers across N pages in Xs" (`web/canvas/events.js:188`) |
| W8 | "Partly built" and "b/t" (every section standing of every section there is), or "Failed" when none stands (shot `f-fail-live`). The Planner pill still reads "done" (`web/canvas/events.js`, B18) | Failed rows: red dot and the agent's name. Failed frames hatched (shot `f-fail-live`) | removed | "B of T sections are built and kept; F failed. The model didn't answer (no model here)." then "Resume, or pick another model in \`hermes model\`." and Resume. With none built: "None of the T sections are built; F failed. ...". Never "All P pages are built", no Play prototype (`web/replaytalk.js` `endWords`, `web/canvas/panels.js` `leftMsg`; shot `f-fail-live`) | "failed LAYER: MODEL: HTTP 500 {...}" per section, raw, then "Done: 0/4 layers across 3 pages in 7.2s, 4 failed" (`web/canvas/events.js:160`, `web/canvas/events.js:188`; shot `f-fail-log`) |
| W9 | "P pages built" and "t/t" | The last version's rows | removed | A red line with no speaker: "planner: MODEL: HTTP 500 {...}". Then "Nothing was added in Xs. The N pages already here are kept." with the W7 buttons. No Try again (`web/canvas/events.js:209`, `web/canvas/panels.js:356`; shot `f-change-fail`) | "Done: 0/0 layers ..." (inferred) |
| W10 | "Stopped" and "b/t"; with nothing planned "Stopped" alone, never "Ready". The Planner pill reads "stopped" (`web/canvas/events.js`) | Sections caught half way go back to planned and lose their text (`web/canvas/events.js:200`) | removed when the Stopped message is said (`web/canvas/panels.js` `leftMsg`; shot `f-fail-stop`) | "Stopped. B of T sections are built and kept. Say what to change, or Resume." with Resume. With nothing planned: "Stopped before any page was planned." and no button (`web/replaytalk.js` `endWords`; shot `f-fail-stop`) | nothing |
| W11 | "Stopped" and "d/t". Planner pill: "stopped: model", "stopped: timed out" or "stopped: no Hermes" (`web/canvas/panels.js:237`) | as W10 | removed, as W10 | The reason, then "B of T sections are built and kept.", the one thing to do, and Resume. A build that stops this way from now on has an action that names Resume (`engine/stopreason.mjs`, `resume`); files saved before keep "Try again, ...". For Hermes: Resume happens by itself when Hermes is back, with "Hermes is back. Going on with the build." (`web/canvas/panels.js` `leftMsg`, `web/canvas/start.js:28`) | nothing |
| W12 | "Stopped" (shot `f-fail-new`). Before: "Ready" | "Pages appear here once the planner names them." | removed, as W10 | Hermia, once, when the planner is asked again: "The plan came back empty. Trying once more." (the raw planner lines are in the Log only). Then Hermia: "Stopped: the model didn't answer (no model here)." with "Try again, or pick another model in \`hermes model\`." and Try again, for Hermes too (shot `f-fail-new`). Try again starts the same build again from its own words, in its project, and asks nothing: `POST /api/runs/<id>/again`, taken only where the state says `next: 'again'` (`web/canvas/panels.js` `againRun`, `server/server.mjs`; shot `f-fail-try-again`). Before: "Couldn't start it again: ask" | nothing |
| W13 | The newer build takes the canvas (`web/canvas/start.js:56`) | the newer build's | the newer build's | nothing about the build that was replaced (inferred) | nothing |
| W14 | not live: see the next table | | | | |
| W15 | "P pages built" | Rows done; picture slots as in [picture.md](picture.md) | removed | The W7 message stays. It is said when painting starts, not when it ends (`web/canvas/events.js:189`, `server/server.mjs:581`) | see [picture.md](picture.md) |

### Website build: the Design deck, opened again later

A saved build is read back event by event (`web/canvas/replay.js` `openRun`), with the server's state of it
(`GET /api/runs/<id>/state`). Messages marked "only as it happens" (`live(e)`, `web/canvas/deck.js:246`) are not
said again; what a build with something left says is said again from its state. A build the state calls
`planning` or `building` is followed on the stream, however the page came to it.

| State | Strip | Chat | Way forward in the chat |
|---|---|---|---|
| W3, W4 opened by address while it runs | As it happens: "Planning the pages", then "N agents building" and "d/t". The page follows the stream because the state says the build runs; it sets no end time (`web/canvas/replay.js` `openRun`; shot `m-deck-planning`). Before: "Ready", or "Stopped d/t" | "Planning the pages…", live. Before: "This file was saved before Swarm Studio kept finished sections, so only its plan is shown." | Stop, in the top bar |
| W7 | "P pages built" | The "Built ..." message and its buttons, said again (`web/canvas/events.js:189`) | Play prototype, the pages |
| W8 | "Partly built" and "b/t", or "Failed" (shot `f-fail-deck`) | "B of T sections are built and kept; F failed.", the reason and the one thing to do, as when it happened (shot `f-fail-deck`). Before: "Built ... (F failed) ..." or "Finished the build: ... All P pages are built." | Resume, whenever the state says `next: 'resume'` (`web/canvas/panels.js` `leftMsg`; shots `f-fail-deck`, `f-fail-fix-resume`) |
| W9 | "P pages built" | The red "planner: ..." line and "Nothing was added ..." | none |
| W10 | "Stopped" and "b/t" | "Stopped. B of T sections are built and kept. Say what to change, or Resume.", said again from the state; the leftover progress line is removed (`web/canvas/replay.js` `openRun`). Before: only the leftover progress line | Resume (inferred; no shot) |
| W11 | "Stopped" and "b/t" (shot `m-deck-stopped`) | The reason, then "3 of 6 sections are built and kept." and the one thing to do; the leftover progress line is removed (shot `m-deck-stopped`) | Resume |
| W12 | "Stopped" | The reason, the one thing to do (the raw planner lines are in the Log) | Try again, which starts the same build again (`POST /api/runs/<id>/again`) |
| W13, W14 | "Stopped" and "b/t"; "Stopped" alone with no sections | "This run stopped before it finished. B of T sections are built and kept." With nothing planned: "This run stopped before it finished." Never the old-file sentence: that is kept for a build with no state, or a whole one saved without its sections' HTML (`web/canvas/replay.js` `openRun`) | Resume when a theme and a page were planned, else Try again (inferred; no shot) |

### Website build: Fix mode and Replay

| State | Fix mode ("/fix", then a question) | Replay |
|---|---|---|
| W8 | "What failed: PAGE › LAYER: MODEL: HTTP 500 {...}." then whose fault it is. It may offer "Finish the build" (`engine/doctor.mjs:157`, `engine/doctor.mjs:116`). With no model to word the answer it offers one button only, and Setup parts come first, so "Finish the build" is cut and the button is "Open Setup: Hermes" (`engine/doctor.mjs:199`, `engine/doctor.mjs:111`; shots `f-fail-fix`, `f-fail-fix-resume`) | Strip "Replay" and a percent; chat lines tagged Replay (`web/replaytalk.js:21`, `web/canvas/panels.js:205`). The end message is the recording's own. UNCHECKED per state |
| W10, W11, W12 | "Nothing failed in this build's log." when no section failed: the facts read `layer:failed`, `image:failed` and app events, not `error` or `run:stopped` (`engine/doctor.mjs:38`, `engine/doctor.mjs:163`; inferred, no shot) | UNCHECKED |
| others | answers from the Setup parts | UNCHECKED |

### App build and game build

| State | Projects card | Top bar chip | Overview | Room: pill | Room: stage | Chat and Log |
|---|---|---|---|---|---|---|
| A1 | "Website · Designed": the kind is App only once an app event exists (`server/projects.mjs:78`, `server/projects.mjs:98`; shot `f-fail-projects` shows Shift Log, an app, as "Website · Designed") | nothing | No App tile: the tile needs `app:ready` or `app:done` (`server/board.mjs:52`, `web/project.js:156`) | "no app yet", "no game yet" (`web/replaytalk.js:45`) | "Turn this design into a working app" with Build the app; for a game "A game starts with a few questions" with Start a game (`web/canvas/rooms.js:494`, `web/canvas/rooms.js:493`) | A typed message gets "Build the app first (the button in this view), then change it by chatting." It does not start the build (`web/canvas/rooms.js:787`, `web/canvas/wander.js:48`; shot `f-app-plan-build`). See [chat-turn.md](chat-turn.md) |
| A2 | "App · Building". A game: "Game · Painting art · n of N", then "Game · Building · stage x of y" (`server/projects.mjs:92`, `server/projects.mjs:86`, `server/projects.mjs:87`) | "App · STAGE" or "Game · STAGE", sliding bar (`server/server.mjs:746`, `web/work.js:58`) | A game tile has a bar (`web/project.js:259`). An app's first build has no tile | "building" | "Building the app…" or "Building the game…" with the stage (`web/canvas/rooms.js:480`) | Log: "🧩 MODEL is building the app" (`web/canvas/rooms.js:1168`). A typed message goes to the crew (`web/canvas/rooms.js:783`) |
| A3 | as A2 for ten minutes after the last step (`server/projects.mjs:83`) | nothing (no job here) (inferred) | UNCHECKED | "building" | as A2, with no Stop (`web/canvas/rooms.js:428`) | UNCHECKED |
| A4 | A game: its last progress words for ten minutes, then "Game · Stopped". Never "your turn" (`server/server.mjs:816`, `server/projects.mjs:83`, `server/projects.mjs:95`; inferred) | nothing: a paused job is not working (`server/server.mjs:746`) | Play sign, no bar (inferred) | "your turn" (`web/replaytalk.js:45`) | UNCHECKED | A card with the slice's choices, only as it happens (`web/canvas/rooms.js:1200`) |
| A5 | "App built", "Game built" (`server/projects.mjs:97`) | nothing | App tile; game tile with a play sign | "running" or "built" | The app itself | Log: "🧩 the app is ready (T turns, checks passed, Xs). Open the App view to try it, or chat to change it." (`web/canvas/rooms.js:1193`) |
| A6 | "App failed", "Game failed" (`server/projects.mjs:96`) | nothing | No App tile after a failed first build. A game tile shows a play sign (`web/project.js:259`) | "failed" | "The app didn't build", the error's first line, Show details, Try again (`web/canvas/rooms.js:489`) | Red line, raw: "🧩 app: MESSAGE" (`web/canvas/rooms.js:1203`). A typed message gets "The app build did not finish. Try again from its card; once it is building I can answer questions and take changes." and "try again" typed does start it when the build got at least one step in (`web/canvas/wander.js:47`, `web/canvas/wander.js:58`) |
| A7 | A game: "Game · Stopped". An app: "App · Designed" or "App · Draft", since Stopped is for games only (`server/projects.mjs:95`, `server/projects.mjs:98`) | nothing | as A6 | "stopped" | "Stopped", how far it got ("3/8 pictures · stage 2 of 5" or "nothing built yet"), Go on (`web/canvas/rooms.js:487`, `web/canvas/rooms.js:1138`) | "Stopped the app build. Everything finished is kept." as it happens (`web/canvas/events.js:206`). A typed message gets "The app build is stopped partway; what is painted and written is kept. Press Go on to continue it. ..." (`web/canvas/wander.js:46`) |

Not tabled, reached by the same room code:

- An app whose server was parked, opened again: a page-shaped skeleton and "Starting the app…", tried up to ten
  times (`web/canvas/rooms.js:472`, `web/canvas/rooms.js:473`).
- An app that is built and does not open: "The app didn't start", the message's first line, Try again
  (`web/canvas/rooms.js:491`).
- A game build that stopped because no picture could be painted: its own card (`web/canvas/rooms.js:485`). See
  [picture.md](picture.md).
- A project brought in from outside: the card reads "Coming in", "Did not come in" or "Brought in"
  (`server/projects.mjs:90`, `server/projects.mjs:91`), the room shows "Bringing it in" with the step
  (`web/canvas/rooms.js:476`), and the job is the intake one (`engine/appjob.mjs:501`). Its states are not
  listed here.

### Film

| State | Projects card | Top bar | Overview | Film room | Chat and Log |
|---|---|---|---|---|---|
| F1 | no sign | Video button | no Film tile | The form and "Make the film" (`web/canvas/film.js:131`) | nothing |
| F2 | "Building" on the project's own kind (`server/projects.mjs:92`) | Chip "Film · STAGE" with a percent; the button reads "Video 40%" or "Video writing…" (`server/server.mjs:748`, `web/canvas/loop.js:152`) | no Film tile yet (`server/board.mjs:46`) | The storyboard, a bar, and the stage in words: "Writing the storyboard…", "Rendering frames in headless Chrome…" (`web/canvas/film.js:100`) | Log: "🎬 MODEL is storyboarding a film" (`web/canvas/film.js:48`) |
| F3 | no word for it: a site with a film still reads "Website · Designed" (`server/projects.mjs:98`) | Video button | Film tile "Promo" (`web/project.js:158`) | The film, "Saved to PATH", Download | Log: "🎬 promo video ready (Ns, made in Xs)" (`web/canvas/film.js:66`) |
| F4 | nothing | nothing | nothing | The raw message in red and "Try again" (`web/canvas/film.js:130`) | Red line, raw: "🎬 video: MESSAGE" (`web/canvas/film.js:78`) |
| F5 | nothing | nothing | nothing | "stopped" in red and "Try again" (`web/canvas/film.js:130`) | "Stopped the film. Everything finished is kept." and the red line "🎬 video: stopped" (`web/canvas/events.js:206`, `web/canvas/film.js:78`) |
| F6 | nothing | nothing | nothing | "Swarm Studio restarted before the video finished. Make it again." and "Try again" (`server/server.mjs:4832`, `web/canvas/film.js:130`) | nothing: the line is said only as it happens (`web/canvas/film.js:78`) |
| F7 | nothing | nothing | nothing | The answer's `error`, or "HTTP 503", and "Try again" (`web/canvas/film.js:264`). Shot `m-film-working` shows the form again with no reason six seconds after the press: UNCHECKED why | nothing |

## Holes

Kinds: (a) a state no screen shows where a person needs to know; (b) two screens disagree; (c) a failure with
no plain reason or no way forward; (d) a sentence not made from the state. Worst first.

1. **B1** (b, d) W8, deck chat against deck strip, layers and Log. **Closed**: the chat's end-of-build sentence is made from the build state (`web/replaytalk.js` `endWords`, `web/canvas/panels.js` `summarize`, `leftMsg`): "5 of 9 sections are built and kept; 4 failed.", the reason, the one thing to do and Resume, and the strip says "Partly built 5/9" from the same state (`tests/replaytalk.test.mjs`; the walkthrough's `f-fail-live` and `f-fail-deck` fail on "All N pages are built"). As it was: The chat says "All 3 pages are built" or "Open a page, or play the prototype" while the strip says "Stopped 5/9" and four rows are red. The sentence is fixed text chosen by `e.resume` or `e.extend`, with the failed count only in brackets (`web/canvas/panels.js:350`, `web/canvas/panels.js:363`). Hit: any build where the model fails some sections (shots `f-fail-live`, `f-fail-deck`).
2. **B2** (a, b) W8, W10, W11, W12, W14, Projects card. **Closed** by the build state: the card reads "Partly built", "Failed" or "Stopped" from `buildState` and never borrows an older version's words (`engine/buildstate.mjs:65`, `server/projects.mjs:105`, `web/home.js:103`, `ui/src/screens/projects/model.ts:68`; `tests/buildstate.test.mjs`). As it was: A website build that failed or stopped reads "Website · Designed" or "Website · Draft". `stateOf` has no failed, stopped or partly built word for a website: the only test is `card.layers > 0` (`server/projects.mjs:98`). The failed count is carried and unread (`server/server.mjs:795`). When the newest version is dead the card also borrows an older version's words (`web/home.js:95`, `web/home.js:102`). Hit: go back to Projects after any failed build (shot `f-fail-projects`).
3. **B3** (c) W8, the deck opened again. **Closed**: a build opened again says what is left from its state, with Resume whenever the state says `next: 'resume'` (`web/canvas/replay.js` `openRun`, `web/canvas/panels.js` `leftMsg`; `tests/buildstateroutes.test.mjs` proves the server takes Resume for every state that names it; shot `f-fail-fix-resume`). As it was: No Resume, no Try again, no reason. Resume is offered only for a `run:stopped` (`web/canvas/replay.js:225`, `web/canvas/panels.js:248`), and a build whose sections all failed ends with `run:done` (`server/server.mjs:559`). Hit: open a failed build from Projects (shot `f-fail-deck`).
4. **B4** (c) W12, Try again. **Closed**: Try again posts to `/api/runs/<id>/again`, which builds the same words again in the same project and asks nothing, only where the build state says `next: 'again'` (failed, halted or cut off, with nothing to resume from), so it is no way around ask-before-build (`server/server.mjs`, `engine/buildstate.mjs`, `web/canvas/panels.js` `againRun`; `tests/buildstateroutes.test.mjs`; shot `f-fail-try-again`). As it was: The button sends the brief with no "sure" and no chat, so the server's ask-before-build rule answers 409 `ask`, and the chat prints "Couldn't start it again: ask" (`web/canvas/panels.js:281`, `web/canvas/panels.js:284`, `server/server.mjs:3344`, `server/server.mjs:3346`). Hit: press Try again after a build that failed at the start, outside a Studio project (shot `f-fail-try-again`).
5. **B5** (a, b) W8, W10, W11, the Overview. **Closed for the artboards**: the board carries the build state and marks each failed section (`server/board.mjs`); a page with sections failed or left wears "Failed · N sections" or "Stopped · N sections left" with Resume, in the picture-failed tag and button, and its blocks pulse only while the build runs (`web/project.js` `leftTag`, `web/project.css`; shot `f-fail-overview`). The reason is still said only in the Design deck's chat. As it was: Failed and unbuilt sections are drawn as the same blocks as sections still coming, and over a page picture they pulse as if loading, for good. The board keeps one flag per section, `done`, set only by `layer:done` (`server/board.mjs:40`, `server/board.mjs:43`, `web/project.js:235`, `web/project.css:86`). No word, no reason, no Resume on the Overview. Hit: open the Overview of a failed build (shot `f-fail-overview`).
6. **B6** (a) W13, W14, every screen. Part closed: the Projects card now reads "Website · Stopped" for a build with no end (`server/projects.mjs:63`); the Design deck opened on one says "This run stopped before it finished.", what is kept, and Resume or Try again, and the Overview tags its pages (`web/canvas/replay.js` `openRun`, `web/project.js` `leftTag`). Still open: nothing writes an end, so nobody can say why, and no walkthrough step shows it. As it was: A build replaced by a newer one, or cut off by the server stopping, has no end event and no screen says so. The replaced build's own `run:stopped` is dropped (`server/server.mjs:529`, `server/server.mjs:554`); nothing writes an end for a website build on restart (films get one, `server/server.mjs:4832`). The card reads "Designed" or "Draft", the deck shows a leftover progress line, and there is no Resume. Hit: start a second project's build while the first is building. Inferred from the code: no shot shows it, and no test starts a second build over a running one.
7. **B7** (b, d) W6, deck strip, chat line and top bar. **Closed for the strip and the chat line**: both count this version's own work from the build state (`kept`, `planned`, `done`): "Planning what to add" until it has a section of its own (`web/replaytalk.js` `buildStrip`, `buildProgress`). The top bar's chip still fills from the kept sections (`server/server.mjs` `workOf`). As it was: Before the next version has planned anything the chat says "0 agents building · 9/9 sections across 3 pages" and the strip says "3 pages built", while the top bar shows a build running with Stop. Both lines count the kept sections that were just sent again (`web/canvas/loop.js:155`, `web/canvas/panels.js:138`, `engine/run.mjs:123`); "Planning what to add…" lasts one frame (`web/canvas/events.js:37`). Hit: type a change on a built site (shot `f-change-building`).
8. **B8** (b, d) W3, W4 opened by address. **Closed**: a build the state calls `planning` or `building` is followed on the stream however the page came to it, with no end time and no old-file sentence (`web/canvas/replay.js` `openRun`; shot `m-deck-planning`). As it was: A build still planning reads "Ready", and the chat says "This file was saved before Swarm Studio kept finished sections, so only its plan is shown.", while the top bar shows it running. The page treats any build it did not hear start as a saved file, sets an end time, and picks the old-file sentence from "no finished section" (`web/canvas/replay.js:203`, `web/canvas/replay.js:217`, `web/canvas/replay.js:232`, `web/canvas/panels.js:138`). Hit: reload the deck, or open a running build's link (shot `m-deck-planning`).
9. **B9** (c) W10, the deck opened again. **Closed**: the Stopped message and Resume are said again from the state, whoever stopped the build (`web/canvas/replay.js` `openRun`). As it was: A build you stopped shows no Stopped message and no Resume when opened later: the message is said only as it happens (`web/canvas/events.js:202`) and the reopen rule leaves out a stop by the person (`web/canvas/replay.js:225`). Hit: press Stop, go to Projects, open the build again (inferred; no shot).
10. **B10** **Closed** (2026-11-15): Fix reads the build's one state (`facts.run.build`) and leads with its reason and the one way on it names, Resume or Try again; Setup comes first only when the reason is Hermes or a missing model (`engine/doctor.mjs` `troubleOf`, `actionsFor`, `plainReply`; `tests/stopreason.test.mjs`; shot `f-fail-fix`). Was: (c) W8, Fix mode. With no model answering, Fix offers one action, and Setup parts are listed before "Finish the build", so the one way forward is cut (`engine/doctor.mjs:199`, `engine/doctor.mjs:111`, `engine/doctor.mjs:116`). This is the case Fix exists for. Hit: "/fix", "Why did the build stop?" on a failed build (shots `f-fail-fix`, `f-fail-fix-resume`).
11. **B11** **Closed** (2026-11-15): a halted or cut-off build is led by its state's reason, never "Nothing failed" (`engine/doctor.mjs` `plainReply`). Was: (c, d) W10, W11, W12, Fix mode. Fix says "Nothing failed in this build's log." for a build that stopped because the model did not answer: its facts do not read `error` or `run:stopped` (`engine/doctor.mjs:38`, `engine/doctor.mjs:163`). Hit: "/fix" after a build that stopped before planning (inferred; no shot).
12. **B12** (b, d) A1, Projects card and the Overview bar. An app that is designed and not built reads "Website · Designed" and has no App tile, because "app" is only known from `app:ready` or `app:done` (`server/projects.mjs:78`, `server/board.mjs:52`). The same missing state sends a change typed in the Overview bar to a website build (`web/route.js:26`; see C2 in [chat-turn.md](chat-turn.md)). Hit: Make an app, stop at the design (shots `f-fail-projects`, `f-app-overview-ask`).
13. **B13** (c) A1, the app chat. "Build the app first (the button in this view)" is the answer to any message, including "build it"; the typed words that start a build are accepted only for a stopped or failed build (`web/canvas/wander.js:48`, `web/canvas/wander.js:58`, `web/canvas/rooms.js:787`). Hit: type "build the app" in the App room (shot `f-app-plan-build`).
14. **B14** (d) W10, W11, W12, the deck chat. **Closed for a website build**: the Stopped message removes the progress line (`web/canvas/panels.js` `leftMsg`). As it was: The progress line stays after a stop: "0 agents building · 5/9 sections across 3 pages" or "Planning the pages…" sits above the Stopped message for good. Only a finished build removes it (`web/canvas/panels.js:360`, `web/canvas/events.js:194`). Hit: press Stop (shots `f-fail-stop`, `f-fail-try-again`, `m-deck-stopped`).
15. **B15** (b) W12, deck strip against chat. **Closed**: the strip says "Stopped" from the build state (`web/replaytalk.js` `buildStrip`). As it was: The strip says "Ready" under a chat that says "Stopped: the model didn't answer" (`web/canvas/panels.js:138`). Hit: a build whose planner fails (shot `f-fail-try-again`).
16. **B16** **Closed** (2026-11-15): an `error` event's line and a failed section's line go to the Log only (`web/canvas/events.js`, `panels.js` `logErr`); the chat says a planner's retry once in plain words ("The plan came back empty. Trying once more.") and the end says why. W9 with a failed planner: the state carries `reason` (`engine/buildstate.mjs`) and the chat says "Nothing was added." with the reason and Try again, which sends the same change again; no Play prototype (shots `f-change-fail`, `e-change-failed`, `e-change-try-again`). Was: (c) W8, W9, W12, W2, the deck chat. Raw provider errors are printed as red lines with no speaker: "planner: cb/deepseek-v4.1-flash: HTTP 500 {"error":"no model here"}", "failed footer: ...", "models: No model key yet ..." (`web/canvas/events.js:209`, `web/canvas/events.js:160`). In W9 nothing follows but "Nothing was added": no reason in plain words and no Try again (`web/canvas/panels.js:356`). Hit: type a change when the model is down (shot `f-change-fail`).
17. **B17** **Partly** (2026-11-15): the line is now "No model key yet." with "Models" (Setup), and the environment variable's name stays in the Log. Left: the run still has no start and no end. Was: (a, c) W2, every screen. With no model key the run has no start and no end: no card, a strip that plans for ever (inferred), one red line naming an environment variable, and no Set up button (`server/server.mjs:585`, `server/server.mjs:586`, `server/server.mjs:766`). Hit: start a build before Hermes has passed its model settings.
18. **B18** (b) W8, strip against Planner pill. The strip says "Stopped" and the Planner pill says "done" (`web/canvas/panels.js:138`, `web/canvas/events.js:190`). Where the pill sits on screen is UNCHECKED (`web/index.html:129`).
19. **B19** (a) A4, Projects card and top bar. A game waiting for the person's answer reads "Building · stage x of y" for ten minutes and then "Stopped"; the top bar shows nothing. "Your turn" is said only inside the room (`server/server.mjs:816`, `server/projects.mjs:83`, `server/projects.mjs:95`, `web/replaytalk.js:45`; inferred).
20. **B20** (b) A7, Projects card. A stopped app build reads "App · Designed"; a stopped game reads "Game · Stopped". The Stopped word is behind `game &&` (`server/projects.mjs:95`).
21. **B21** (a) F4, F5, F6, outside the Film room. A film that failed leaves no sign on the card, the Overview or the top bar; the reason is in the Film room only, raw (`web/canvas/film.js:130`, `server/server.mjs:1424`).
22. **B22** (d) Top bar Stop. The button says "Stopped" after any press, whatever the server answered; a failed call is swallowed (`web/work.js:78`, `web/work.js:81`).
23. **B23** (d) W4, deck strip. **Closed for a website build**: the strip reads whether the build runs from the build state, not from the sections on the page. As it was: Mid-build the strip can say "Stopped" or "N pages built" for a moment, because it counts sections and never reads whether the run has ended (`web/canvas/panels.js:138`; inferred).
24. **B24** (a) W3, W4, Overview. While the layout is built the Overview has no words for who is working or how far; its live line speaks only of painting and reviewing (`web/project.js:1373`). The top bar chip is the only sign.
25. **B25** (d) W15, deck chat. "Built P pages ... play the prototype." is said when the pictures start, so "done" comes before any picture (`web/canvas/events.js:189`, `server/server.mjs:581`). See [picture.md](picture.md).
26. **B26** (a) Projects filter. The filter's list of statuses has no "Stopped", "Painting art" or "Building · stage", so those cards can not be filtered for (`web/home.js:21`). The website words "Partly built" and "Failed" are not in it either.

React front end: not tabled. `ui/src` has its own deck model (`ui/src/screens/deck/model.ts`); whether it repeats
B1, B7 and B8 is UNCHECKED. It does not read `build:state` yet.

B10, B11 and B16 were closed after it (2026-11-15, `web/stopreason.js`). Left open by the Design deck's move onto the build state, as written then: B10 and B11 (Fix mode's facts), B16 (the planner's raw
error line in the chat, and W9's missing reason), B17 (no model key), B18 (the Planner pill reads "done" beside
"Partly built"), B24, B25, and B6's missing end event.

## Where the state should live

It lives in `buildState(events, { live })` (`engine/buildstate.mjs`), a pure function over a website
build's events plus the live flag, beside `engine/stopreason.mjs`. It writes no event and reads old files as
they are. It answers `{ state, done, planned, kept, failed: [{ page, layer, why }], reason: { code, message,
action } | null, next: 'resume' | 'again' | null }`, or null for a run that is not a website build (an app, a
game, a project brought in).

| `state` | Rows | Made so by |
|---|---|---|
| `planning` | W3, W6 | live, no end, none of this build's own sections planned |
| `building` | W4 | live, no end, sections of its own planned |
| `done` | W7 | `run:done`, every section built |
| `unchanged` | W9 | `run:done` of a next version with no section of its own |
| `partly` | W8 | `run:done` with a section failed or unbuilt, or a page with no section, and one section or more standing |
| `failed` | W8 "0 built" | `run:done` with no section standing |
| `stopped` | W10 | `run:stopped` by the person, or with no reason (old files) |
| `halted` | W11, W12 | `run:stopped` with the reason `model`, `timeout` or `hermes` |
| `replaced` | W13 | `run:stopped` with the reason `replaced` (not written today) |
| `unsure` | W13, W14 | no end event and not live |

- Sections are counted one per page and id. A section built after it failed is built; a failure after
  a section was built (a fix that failed) leaves it built, as Resume reads it; a section caught by Stop is
  unbuilt, not failed. `kept` are the sections a next version was handed; `done` and `planned` are its own work.
- `failed` is Fix mode's list (`failuresOf`, `engine/doctor.mjs:38`), less a failure of a section that stands. `reason` is the
  stop's own (`run:stopped`), or for `partly` and `failed` the newest failed section's message read by
  `reasonFromFailure` (`engine/stopreason.mjs`) with `ended`: "The model didn't answer (...)." and never
  "Stopped: ...", since the build ran to its end. Its action names the way on that `next` gives: "Resume, or pick
  another model in `hermes model`." when `next` is `resume`. A stop the server writes from now on names Resume the
  same way when sections are kept (`server/server.mjs`, the run's catch); a stop already saved keeps its words.
- `next` names only what the server takes, and one thing at most. `resume`: the build is not whole, something is
  left and `/api/runs/<id>/resume` would accept it (a theme and a page, `engine/extend.mjs:37`). `again`: the build
  is `failed`, `halted` or `unsure`, there is nothing to resume from, and its `run:start` has words:
  `/api/runs/<id>/again` builds those words afresh in the same project. It is taken only for a build whose state
  says so, and the words are the build's own, so it asks nothing again and starts no other build
  (decision 0020). A build the person stopped before any page, or an old stop with no cause, has no `next`: the
  chat box is there. Set up is not a server action. W5 (waiting for Hermes), W15 (painting, reviewing) and W2 (no
  model key, no `run:start`) are not states of it yet.

How it reaches a screen. The page may not import the engine (`.dependency-cruiser.cjs`,
`page-code-stays-in-web`), and must not work the state out again, so the server sends it:

- on the stream, as `{ type: 'build:state', run, state }`, while a build runs: sent only when the state changed,
  just before the event that changed it (so the page holds the end state when `run:done` or `run:stopped` is
  drawn), first of all to a page that joins late, and never written to `events.jsonl` (`server/server.mjs`
  `sayState`, `STATE_EVENTS`);
- with a saved build, as `GET /api/runs/<id>/state` (`{ run, state }`), read beside its events;
- with the Overview's board, as `build`, each failed section marked in its page's plan (`server/board.mjs`);
- with every card and version, as before: `/api/runs` carries it whole as `buildState`, and its name as `state.site`.

The page keeps what it was sent by run (`web/canvas/core.js` `buildOf`, `setBuild`) and turns it into words in one
place (`web/replaytalk.js`: `buildStrip`, `buildProgress`, `endWords`; `tests/replaytalk.test.mjs`).

Who reads it today: the Projects card (`server/server.mjs`, `server/projects.mjs`), in both Studios; the Design
deck's strip, its chat's progress line, its end-of-build and Stopped messages with their Resume or Try again, and
its reopen rules (`web/canvas/panels.js`, `web/canvas/loop.js`, `web/canvas/replay.js`); the Overview's page
artboards (`web/project.js` `leftTag`). Still to move onto it: `workOf` (`server/server.mjs`, the top bar's chip),
Fix mode's facts, the Planner pill, the hosted studio (`server/hosted.mjs` sends no `build:state`; its board does
carry `build`) and the React deck (`ui/src/screens/deck/model.ts`). The app, game and film jobs are not parts of
it yet (`engine/appjob.mjs:300` is the app's). `scripts/build-state-diff.mjs` lists every card whose words
changed, old against new, over a runs folder.
