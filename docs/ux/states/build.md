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
`f-fail-live`). Nothing was run. "(inferred)" marks a cell read from code paths that no shot shows.

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
work the state out themselves.

| State | Projects card | Top bar: work chip and Stop | Overview: artboards | Overview: live line |
|---|---|---|---|---|
| W1 | nothing: with no run there is no card. ("Draft" is a run with no section: W12, W14) | nothing (`web/work.js:43`) | nothing: the stage is empty (shot `m-ov-empty`) | nothing |
| W2 | nothing: a run with no `run:start` has no card (`server/server.mjs:766`) | UNCHECKED | UNCHECKED | nothing |
| W3 | "Website · Building", crew cursors and a bar (`server/projects.mjs:92`, `web/home.js:187`) | Chip with a count and a bar; its list says "Site · planning". Stop is shown (`web/work.js:52`, `web/work.js:58`, `server/server.mjs:739`) | Page tiles appear as pages are named; the body is marked live (`web/project.js:192`). Before the first page: nothing | nothing: the line only speaks of painting and reviewing (`web/project.js:1373`) |
| W4 | "Website · Building", bar at done over planned (`server/server.mjs:839`) | "Site · building pages" with a bar (`server/server.mjs:739`) | Each page as blocks, one per planned section; unbuilt blocks are plain (`web/project.js:235`, `web/project.js:241`) | nothing |
| W5 | "Website · Building" (inferred) | as W4 (inferred) | as W4 (inferred) | nothing |
| W6 | "Website · Building" | "Site · building pages" with a full bar: the kept sections count as done (`server/server.mjs:739`; shot `f-change-building` shows the chip full) | The last version's pages, whole | nothing |
| W7 | "Website · Designed" (`server/projects.mjs:98`) | nothing | Each page's picture | nothing |
| W8 | "Website · Partly built" when one section or more stands. "Website · Failed" when none does. With an older version in the project the card keeps its newest build's own word (`server/projects.mjs:63`, `server/projects.mjs:105`, `web/home.js:103`). Before the build state: "Website · Designed", or the older version's words (shot `f-fail-projects`) | nothing | A failed section is drawn as an unbuilt block, the same as one still to come. Over a page picture the block pulses (`server/board.mjs:40`, `server/board.mjs:43`, `web/project.js:235`, `web/project.css:86`; shot `f-fail-overview`) | nothing |
| W9 | "Website · Designed", its own: every section of the last version is there (`server/projects.mjs:63`). Before the build state the new version read "Draft" and the card took the older version's words | nothing | The last version's pages (inferred) | nothing |
| W10 | "Website · Stopped" (`server/projects.mjs:63`) | Stop reads "Stopping", then "Stopped" for 2.5 seconds, then the chip goes (`web/work.js:77`, `web/work.js:81`) | Unbuilt sections as plain or pulsing blocks, as W8 | nothing |
| W11 | as W10 | nothing | as W10 | nothing |
| W12 | "Website · Stopped". With an older version that works, this empty one is not listed among the versions, and the card still reads "Stopped" (`server/projects.mjs:109`, `web/home.js:96`, `web/home.js:103`) | nothing | nothing: no pages (shot `m-ov-empty`) | nothing |
| W13 | "Website · Stopped" (inferred: no shot) | The chip now shows the newer build only (inferred) | as W10 (inferred) | nothing |
| W14 | "Website · Stopped" | nothing | as W10 | nothing |
| W15 | "Website · Building" with a sliding bar (`server/projects.mjs:92`, `web/home.js:187`) | "Site · painting pictures" or "Site · reviewing" (`server/server.mjs:741`, `server/server.mjs:742`) | Pages whole; picture slots as in [picture.md](picture.md) | "NAME painting 2 of 8", "NAME reviewing page 1 of 3" (`web/project.js:1380`, `web/project.js:1385`) |

### Website build: the Design deck, as it happens

"Strip" is the status strip at the top left of the canvas (`#status`). Its state is worked out from the
sections on the page, not from the run's end: no sections and no end is "planning", no sections is "idle", all
done is "done", an agent holding a section is "working", anything else is "paused"
(`web/canvas/panels.js:138`, words at `web/replaytalk.js:23`).

| State | Strip | Layers and canvas | Chat: progress line | Chat: messages | Log |
|---|---|---|---|---|---|
| W1 | "Ready" (`web/replaytalk.js:23`) | "Pages appear here once the planner names them." (`web/canvas/panels.js:75`) | nothing | "Describe a product below. A planner picks the pages, then a swarm of agents builds them on the canvas." (`web/canvas/base.js:70`) | nothing |
| W2 | "Planning the pages" with no end (inferred: the run is set and never ends, `web/canvas/panels.js:138`) | "Pages appear here once the planner names them." | nothing (no `run:start`, so no line is made) | One red line: "models: No model key yet. Start a build from Hermes once (/swarm, the chat tool or \`hermes swarm\`) so it can pass its model settings, or set SWARM_STUDIO_API_KEY." No button (`web/canvas/events.js:209`, `server/server.mjs:586`) | nothing |
| W3 | "Planning the pages" (shot `f-first-planning`) | "Pages appear here once the planner names them." | "Planning the pages…" (`web/canvas/events.js:37`, `web/replaytalk.js:32`) | The brief as the person's bubble (`web/canvas/events.js:35`) | "Planner is drafting PAGE" (`web/canvas/events.js:55`) |
| W4 | "N agents building" and "d/t". Between sections it can read "Stopped" (nobody holds a section) or "N pages built" (every planned section so far is done) while the planner is still adding pages (`web/canvas/panels.js:138`; inferred) | A row per section: its agent's dot while written, a red dot when failed (`web/layers.js:66`, `web/canvas.css:103`). Failed frames are hatched (`web/canvas/deck.js:194`) | "Planned P pages and S sections in Xs. N agents building · d/t sections across P pages" (`web/canvas/events.js:61`, `web/replaytalk.js:34`; shot `f-fail-working`) | nothing new | "Plan finished: P pages, L layers in Xs", what each agent says, "failed LAYER: MESSAGE" (`web/canvas/events.js:60`, `web/canvas/events.js:160`) |
| W5 | as W4 | as W4 | as W4 | nothing. A bar outside the chat says the server's message, or "Waiting for Hermes" (`web/canvas/start.js:36`) | nothing |
| W6 | "3 pages built" and "9/9" (shot `f-change-building`) | The last version's rows, all done | "Planning what to add…" for one frame, then "0 agents building · 9/9 sections across 3 pages" (`web/canvas/events.js:37`, `web/canvas/loop.js:155`; shot `f-change-building`) | The message as the person's bubble (`web/canvas/events.js:35`) | nothing |
| W7 | "P pages built" and "t/t" | Every row done | removed (`web/canvas/panels.js:360`) | "Built P pages and D sections in Xs with N agents. Open a page, or play the prototype." with Play prototype, Watch a visitor and a button per page (`web/canvas/panels.js:363`, `web/canvas/panels.js:369`) | "Done: D/P layers across N pages in Xs" (`web/canvas/events.js:188`) |
| W8 | "Stopped" and "d/t" (shot `f-fail-live`). The Planner pill reads "done" (`web/canvas/events.js:190`) | Failed rows: red dot and the agent's name. Failed frames hatched (shot `f-fail-live`) | removed | First build: "Built P pages and D sections in Xs with N agents (F failed). Open a page, or play the prototype." After Resume: "Finished the build: D sections in Xs (F failed). All P pages are built." Same buttons as W7. No Resume, no Try again (`web/canvas/panels.js:363`, `web/canvas/panels.js:350`; shot `f-fail-live`) | "failed LAYER: MODEL: HTTP 500 {...}" per section, raw, then "Done: 0/4 layers across 3 pages in 7.2s, 4 failed" (`web/canvas/events.js:160`, `web/canvas/events.js:188`; shot `f-fail-log`) |
| W9 | "P pages built" and "t/t" | The last version's rows | removed | A red line with no speaker: "planner: MODEL: HTTP 500 {...}". Then "Nothing was added in Xs. The N pages already here are kept." with the W7 buttons. No Try again (`web/canvas/events.js:209`, `web/canvas/panels.js:356`; shot `f-change-fail`) | "Done: 0/0 layers ..." (inferred) |
| W10 | "Stopped" and "d/t". With nothing planned: "Ready" (`web/canvas/panels.js:138`). The Planner pill reads "stopped" (`web/canvas/events.js:198`) | Sections caught half way go back to planned and lose their text (`web/canvas/events.js:200`) | stays: "0 agents building · d/t sections across P pages", or "Planning the pages…" (nothing removes it on a stop, `web/canvas/events.js:194`; shot `f-fail-stop`) | "Stopped. B of T sections are built and kept. Say what to change, or Resume." with Resume. With nothing planned: "Stopped before any page was planned." and no button (`web/canvas/panels.js:245`, `web/canvas/panels.js:254`, `web/canvas/panels.js:272`; shot `f-fail-stop`) | nothing |
| W11 | "Stopped" and "d/t". Planner pill: "stopped: model", "stopped: timed out" or "stopped: no Hermes" (`web/canvas/panels.js:237`) | as W10 | stays, as W10 | The reason, then "B of T sections are built and kept.", the one thing to do, and Resume. For Hermes: Resume happens by itself when Hermes is back, with "Hermes is back. Going on with the build." (`web/canvas/panels.js:245`, `web/canvas/panels.js:250`, `web/canvas/start.js:28`) | nothing |
| W12 | "Ready" (shot `f-fail-try-again`) | "Pages appear here once the planner names them." | stays: "Planning the pages…" (shot `f-fail-try-again`) | Red, no speaker: "planner: the site plan came back empty, trying once more", "planner: MODEL: HTTP 500 {...}". Then Hermia: "Stopped: the model didn't answer (no model here)." with "Try again, or pick another model in \`hermes model\`." and Try again. For Hermes: Check again (`web/canvas/events.js:209`, `engine/stopreason.mjs:57`, `web/canvas/panels.js:269`, `web/canvas/panels.js:259`; shot `f-fail-new`). Try again then prints "Couldn't start it again: ask" (`web/canvas/panels.js:284`; shot `f-fail-try-again`) | nothing |
| W13 | The newer build takes the canvas (`web/canvas/start.js:56`) | the newer build's | the newer build's | nothing about the build that was replaced (inferred) | nothing |
| W14 | not live: see the next table | | | | |
| W15 | "P pages built" | Rows done; picture slots as in [picture.md](picture.md) | removed | The W7 message stays. It is said when painting starts, not when it ends (`web/canvas/events.js:189`, `server/server.mjs:581`) | see [picture.md](picture.md) |

### Website build: the Design deck, opened again later

A saved build is read back event by event (`web/canvas/replay.js:214`). Messages marked "only as it happens"
(`live(e)`, `web/canvas/deck.js:246`) are not said again. A build is followed live only when this page already
heard it start (`web/canvas/replay.js:203`); one opened by its address is read as a saved file.

| State | Strip | Chat | Way forward in the chat |
|---|---|---|---|
| W3, W4 opened by address while it runs | "Ready" before any section, "Stopped d/t" after: the page sets an end time for every saved file (`web/canvas/replay.js:217`, `web/canvas/panels.js:138`; shot `m-deck-planning`). The top bar still shows the work chip and Stop | "Planning the pages…" as a finished line: the words "This run stopped before it finished." are written and then overwritten by the next frame (`web/canvas/replay.js:219`, `web/canvas/loop.js:155`). Then "This file was saved before Swarm Studio kept finished sections, so only its plan is shown." (`web/canvas/replay.js:232`; shot `m-deck-planning`) | none |
| W7 | "P pages built" | The "Built ..." message and its buttons, said again (`web/canvas/events.js:189`) | Play prototype, the pages |
| W8 | "Stopped" and "d/t" (shot `f-fail-deck`) | The same "Built ... (F failed) ..." or "Finished the build: ... All P pages are built." (shot `f-fail-deck`) | none: Resume is offered only for a `run:stopped` (`web/canvas/replay.js:225`, `web/canvas/replay.js:231`) |
| W9 | "P pages built" | The red "planner: ..." line and "Nothing was added ..." | none |
| W10 | "Stopped" and "d/t" | Only the leftover progress line "0 agents building · d/t sections across P pages". The Stopped message is not said again: it is said only as it happens, and the reopen rule skips a stop by the person (`web/canvas/events.js:202`, `web/canvas/replay.js:225`) | none (inferred; no shot) |
| W11 | "Stopped" and "d/t" (shot `m-deck-stopped`) | "Planned 2 pages and 6 sections in 0.1s. 0 agents building · 3/6 sections across 2 pages", then "The model took too long. 3 of 6 sections are built and kept." (shot `m-deck-stopped`) | Resume (`web/canvas/replay.js:231`, `web/canvas/panels.js:254`) |
| W12 | "Ready" | The red planner lines, the reason, the one thing to do | Try again (`web/canvas/panels.js:269`), which answers "Couldn't start it again: ask" |
| W13, W14 | "Stopped d/t", or "Ready" with no sections | The leftover progress line. With no finished section: "This file was saved before Swarm Studio kept finished sections, so only its plan is shown." (`web/canvas/replay.js:232`) | none |

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

1. **B1** (b, d) W8, deck chat against deck strip, layers and Log. The chat says "All 3 pages are built" or "Open a page, or play the prototype" while the strip says "Stopped 5/9" and four rows are red. The sentence is fixed text chosen by `e.resume` or `e.extend`, with the failed count only in brackets (`web/canvas/panels.js:350`, `web/canvas/panels.js:363`). Hit: any build where the model fails some sections (shots `f-fail-live`, `f-fail-deck`).
2. **B2** (a, b) W8, W10, W11, W12, W14, Projects card. **Closed** by the build state: the card reads "Partly built", "Failed" or "Stopped" from `buildState` and never borrows an older version's words (`engine/buildstate.mjs:65`, `server/projects.mjs:105`, `web/home.js:103`, `ui/src/screens/projects/model.ts:68`; `tests/buildstate.test.mjs`). As it was: A website build that failed or stopped reads "Website · Designed" or "Website · Draft". `stateOf` has no failed, stopped or partly built word for a website: the only test is `card.layers > 0` (`server/projects.mjs:98`). The failed count is carried and unread (`server/server.mjs:795`). When the newest version is dead the card also borrows an older version's words (`web/home.js:95`, `web/home.js:102`). Hit: go back to Projects after any failed build (shot `f-fail-projects`).
3. **B3** (c) W8, the deck opened again. No Resume, no Try again, no reason. Resume is offered only for a `run:stopped` (`web/canvas/replay.js:225`, `web/canvas/panels.js:248`), and a build whose sections all failed ends with `run:done` (`server/server.mjs:559`). Hit: open a failed build from Projects (shot `f-fail-deck`).
4. **B4** (c) W12, Try again. The button sends the brief with no "sure" and no chat, so the server's ask-before-build rule answers 409 `ask`, and the chat prints "Couldn't start it again: ask" (`web/canvas/panels.js:281`, `web/canvas/panels.js:284`, `server/server.mjs:3344`, `server/server.mjs:3346`). Hit: press Try again after a build that failed at the start, outside a Studio project (shot `f-fail-try-again`).
5. **B5** (a, b) W8, W10, W11, the Overview. Failed and unbuilt sections are drawn as the same blocks as sections still coming, and over a page picture they pulse as if loading, for good. The board keeps one flag per section, `done`, set only by `layer:done` (`server/board.mjs:40`, `server/board.mjs:43`, `web/project.js:235`, `web/project.css:86`). No word, no reason, no Resume on the Overview. Hit: open the Overview of a failed build (shot `f-fail-overview`).
6. **B6** (a) W13, W14, every screen. Part closed: the Projects card now reads "Website · Stopped" for a build with no end (`server/projects.mjs:63`); the deck, the Overview and Resume are as below. A build replaced by a newer one, or cut off by the server stopping, has no end event and no screen says so. The replaced build's own `run:stopped` is dropped (`server/server.mjs:529`, `server/server.mjs:554`); nothing writes an end for a website build on restart (films get one, `server/server.mjs:4832`). The card reads "Designed" or "Draft", the deck shows a leftover progress line, and there is no Resume. Hit: start a second project's build while the first is building. Inferred from the code: no shot shows it, and no test starts a second build over a running one.
7. **B7** (b, d) W6, deck strip, chat line and top bar. Before the next version has planned anything the chat says "0 agents building · 9/9 sections across 3 pages" and the strip says "3 pages built", while the top bar shows a build running with Stop. Both lines count the kept sections that were just sent again (`web/canvas/loop.js:155`, `web/canvas/panels.js:138`, `engine/run.mjs:123`); "Planning what to add…" lasts one frame (`web/canvas/events.js:37`). Hit: type a change on a built site (shot `f-change-building`).
8. **B8** (b, d) W3, W4 opened by address. A build still planning reads "Ready", and the chat says "This file was saved before Swarm Studio kept finished sections, so only its plan is shown.", while the top bar shows it running. The page treats any build it did not hear start as a saved file, sets an end time, and picks the old-file sentence from "no finished section" (`web/canvas/replay.js:203`, `web/canvas/replay.js:217`, `web/canvas/replay.js:232`, `web/canvas/panels.js:138`). Hit: reload the deck, or open a running build's link (shot `m-deck-planning`).
9. **B9** (c) W10, the deck opened again. A build you stopped shows no Stopped message and no Resume when opened later: the message is said only as it happens (`web/canvas/events.js:202`) and the reopen rule leaves out a stop by the person (`web/canvas/replay.js:225`). Hit: press Stop, go to Projects, open the build again (inferred; no shot).
10. **B10** (c) W8, Fix mode. With no model answering, Fix offers one action, and Setup parts are listed before "Finish the build", so the one way forward is cut (`engine/doctor.mjs:199`, `engine/doctor.mjs:111`, `engine/doctor.mjs:116`). This is the case Fix exists for. Hit: "/fix", "Why did the build stop?" on a failed build (shots `f-fail-fix`, `f-fail-fix-resume`).
11. **B11** (c, d) W10, W11, W12, Fix mode. Fix says "Nothing failed in this build's log." for a build that stopped because the model did not answer: its facts do not read `error` or `run:stopped` (`engine/doctor.mjs:38`, `engine/doctor.mjs:163`). Hit: "/fix" after a build that stopped before planning (inferred; no shot).
12. **B12** (b, d) A1, Projects card and the Overview bar. An app that is designed and not built reads "Website · Designed" and has no App tile, because "app" is only known from `app:ready` or `app:done` (`server/projects.mjs:78`, `server/board.mjs:52`). The same missing state sends a change typed in the Overview bar to a website build (`web/route.js:26`; see C2 in [chat-turn.md](chat-turn.md)). Hit: Make an app, stop at the design (shots `f-fail-projects`, `f-app-overview-ask`).
13. **B13** (c) A1, the app chat. "Build the app first (the button in this view)" is the answer to any message, including "build it"; the typed words that start a build are accepted only for a stopped or failed build (`web/canvas/wander.js:48`, `web/canvas/wander.js:58`, `web/canvas/rooms.js:787`). Hit: type "build the app" in the App room (shot `f-app-plan-build`).
14. **B14** (d) W10, W11, W12, the deck chat. The progress line stays after a stop: "0 agents building · 5/9 sections across 3 pages" or "Planning the pages…" sits above the Stopped message for good. Only a finished build removes it (`web/canvas/panels.js:360`, `web/canvas/events.js:194`). Hit: press Stop (shots `f-fail-stop`, `f-fail-try-again`, `m-deck-stopped`).
15. **B15** (b) W12, deck strip against chat. The strip says "Ready" under a chat that says "Stopped: the model didn't answer" (`web/canvas/panels.js:138`). Hit: a build whose planner fails (shot `f-fail-try-again`).
16. **B16** (c) W8, W9, W12, W2, the deck chat. Raw provider errors are printed as red lines with no speaker: "planner: cb/deepseek-v4.1-flash: HTTP 500 {"error":"no model here"}", "failed footer: ...", "models: No model key yet ..." (`web/canvas/events.js:209`, `web/canvas/events.js:160`). In W9 nothing follows but "Nothing was added": no reason in plain words and no Try again (`web/canvas/panels.js:356`). Hit: type a change when the model is down (shot `f-change-fail`).
17. **B17** (a, c) W2, every screen. With no model key the run has no start and no end: no card, a strip that plans for ever (inferred), one red line naming an environment variable, and no Set up button (`server/server.mjs:585`, `server/server.mjs:586`, `server/server.mjs:766`). Hit: start a build before Hermes has passed its model settings.
18. **B18** (b) W8, strip against Planner pill. The strip says "Stopped" and the Planner pill says "done" (`web/canvas/panels.js:138`, `web/canvas/events.js:190`). Where the pill sits on screen is UNCHECKED (`web/index.html:129`).
19. **B19** (a) A4, Projects card and top bar. A game waiting for the person's answer reads "Building · stage x of y" for ten minutes and then "Stopped"; the top bar shows nothing. "Your turn" is said only inside the room (`server/server.mjs:816`, `server/projects.mjs:83`, `server/projects.mjs:95`, `web/replaytalk.js:45`; inferred).
20. **B20** (b) A7, Projects card. A stopped app build reads "App · Designed"; a stopped game reads "Game · Stopped". The Stopped word is behind `game &&` (`server/projects.mjs:95`).
21. **B21** (a) F4, F5, F6, outside the Film room. A film that failed leaves no sign on the card, the Overview or the top bar; the reason is in the Film room only, raw (`web/canvas/film.js:130`, `server/server.mjs:1424`).
22. **B22** (d) Top bar Stop. The button says "Stopped" after any press, whatever the server answered; a failed call is swallowed (`web/work.js:78`, `web/work.js:81`).
23. **B23** (d) W4, deck strip. Mid-build the strip can say "Stopped" or "N pages built" for a moment, because it counts sections and never reads whether the run has ended (`web/canvas/panels.js:138`; inferred).
24. **B24** (a) W3, W4, Overview. While the layout is built the Overview has no words for who is working or how far; its live line speaks only of painting and reviewing (`web/project.js:1373`). The top bar chip is the only sign.
25. **B25** (d) W15, deck chat. "Built P pages ... play the prototype." is said when the pictures start, so "done" comes before any picture (`web/canvas/events.js:189`, `server/server.mjs:581`). See [picture.md](picture.md).
26. **B26** (a) Projects filter. The filter's list of statuses has no "Stopped", "Painting art" or "Building · stage", so those cards can not be filtered for (`web/home.js:21`). The website words "Partly built" and "Failed" are not in it either.

React front end: not tabled. `ui/src` has its own deck model (`ui/src/screens/deck/model.ts`); whether it repeats
B1, B7 and B8 is UNCHECKED.

## Where the state should live

It lives in `buildState(events, { live })` (`engine/buildstate.mjs:65`), a pure function over a website
build's events plus the live flag, beside `engine/stopreason.mjs`. It writes no event and reads old files as
they are. It answers `{ state, done, planned, kept, failed: [{ page, layer, why }], reason: { code, message,
action } | null, next: 'resume' | null }`, or null for a run that is not a website build (an app, a game, a
project brought in).

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
  `reasonFromFailure` (`engine/stopreason.mjs:43`).
- `next` names only what the server takes: `resume` when the build is not whole, something is left and
  `/api/runs/<id>/resume` would accept it (a theme and a page, `engine/extend.mjs:37`). Try again is not
  named: a bare brief is refused by ask-before-build (B4). Set up is not a server action. W5 (waiting for
  Hermes), W15 (painting, reviewing) and W2 (no model key, no `run:start`) are not states of it yet.

Who reads it today: the Projects card only (`server/server.mjs:823`, `server/projects.mjs:85`), in both
Studios. Still to move onto it: `workOf` (`server/server.mjs:737`), `runBoard` (`server/board.mjs:17`), the
deck's strip (`web/canvas/panels.js:138`), its summary sentence (`web/canvas/panels.js:348`), the reopen rules
(`web/canvas/replay.js:225`) and Fix mode's facts. `/api/runs` carries it whole as `buildState`, and every card and version carries its name as
`state.site`. The app, game and film jobs are not parts
of it yet (`engine/appjob.mjs:300` is the app's). `scripts/build-state-diff.mjs` lists every card whose words
changed, old against new, over a runs folder.
