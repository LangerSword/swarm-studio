# State table: a publish

Publishing is five routes, not one thing: a site to a live link, a working app to Vercel, a project's source to GitHub, a post to the Swarm Feed, and an export (plus the launch kit, which only reads the others). Each route keeps its state in a different place: saved `publish:*` events, a server Map that dies with the server, a Python settings file, a browser Map that dies with the page, or nowhere. This file lists every state the data can reach, what each classic `web/` surface shows for it, and the holes. All line numbers are from the worktree. The walkthrough digest has no sentences for the `m-pub-*` steps, so a step id below proves only that the screen is reached, not its words.

## States

### A. A site to a live link (per build, i.e. per run id)

Data: four events, `publish:start` (`server/server.mjs:2835`, saved), `publish:stage` (`server/server.mjs:2845`, broadcast only, never saved), `publish:done` (`server/server.mjs:2838`, saved, carries `target`, `url`, `pending`), `publish:failed` (`server/server.mjs:2861`, saved, carries `message`). Beside them: the server Map `publishes` (`server/server.mjs:2834`, lost on restart), the browser object `pub` (`web/canvas/publish.js:11`), and `sites` on the run card (`server/server.mjs:775`).

| id | State | The data that makes it so |
|---|---|---|
| A0 | Idle, never published | No `publish:*` event for the run. `pub.state` is `'none'` (`web/canvas/publish.js:11`). |
| A1 | Cannot publish: nothing built | No `layer:done` event: the server refuses (`server/server.mjs:2824`). In the browser `S.done` is 0 (`web/canvas/loop.js:148`). `S.done` is the count of finished sections, set from each `layer:done` (`web/canvas/events.js:142`, `engine/run.mjs:419`), not "the build has ended". |
| A2 | Needs you: host not connected | `GET /api/publish` answers no `github` login, or no `vercel` / `cloudflare` user (`web/canvas/publish.js:93`). |
| A3 | Publishing (how far) | `publishes` job `state: 'working'` (`server/server.mjs:2833`), `publish:start` saved, then live-only `publish:stage` with `stage`. |
| A4 | Live, public link | `publish:done` with `target` github, vercel or cloudflare, an `https` `url`, `pending: false` (`server/server.mjs:2857`). |
| A5 | Live, "going live" (unsure) | `publish:done` with `pending: true`: the host did not answer in time (`engine/publish.mjs:143`, `engine/publish.mjs:266`, `engine/publish.mjs:328`). Nothing probes again later. |
| A6 | Live on this computer only | `publish:done` with `target: 'local'`, `url` `http://127.0.0.1:<port>/site/<run>/` (`server/server.mjs:2832`, `server/server.mjs:2841`). Served from the newest export folder (`server/server.mjs:4769`), only while the Studio runs. |
| A7 | Failed after it started | `publish:failed` saved with `message`, cut to 300 characters (`server/server.mjs:2860`, `server/server.mjs:2861`). |
| A8 | Refused before it started | `POST …/publish` answers 400 (`server/server.mjs:4025`): no event is saved. Only the browser holds it: `pub.state = 'failed'` (`web/canvas/publish.js:237`). Gone on reload. |
| A9 | Interrupted | `publish:start` saved with no `publish:done` or `publish:failed` after it (the server stopped mid-publish). A replayed `publish:start` is ignored (`web/canvas/publish.js:249`), so this reads as A0. |
| A10 | Live, and the newest try failed | An older `publish:done` and a later `publish:failed`. `pub.live` keeps the old link while `pub.state` is `'failed'` (`web/canvas/publish.js:252`). |
| A11 | Live but stale | Any `edit` or `layer:done` event later than the last `publish:done` (or a newer version of the project). No field, no selector: nothing computes it. |
| A12 | Live with sections missing | The export keeps only planned sections that have html (`engine/export.mjs:41`); the browser sends only sections with status `done` (`web/canvas/publish.js:233`). A build with failed sections, or one still running, publishes without them. |
| A13 | Done with no link (reachable in code only: not seen) | Vercel's result is `url: final`, and `final` is null when a READY deployment has no alias and no `url` (`engine/publish.mjs:263`, `engine/publish.mjs:266`); `publish:done` is then saved with `url: null`. |
| A14 | Taken down, or a custom domain being set | No data and no code. Not built (walkthrough `m-pub-domain`: not reached). |
| A15 | Project deleted, site still online | Trash and Delete forever touch only local files (`server/projects.mjs:313`, `server/projects.mjs:325`). The public site stays up and the Studio forgets it. |

### B. A working app to Vercel (per build)

Data: `app:deployed` (`engine/appjob.mjs:1143`, saved, carries `url`, `pending`). A failed deploy saves nothing. `appv.deploying` is browser-only (`web/canvas/rooms.js:1143`).

| id | State | The data that makes it so |
|---|---|---|
| B0 | No app yet | App state `hasApp` false (`web/canvas/start.js:317`); server: 'no app yet' (`engine/appjob.mjs:1128`). |
| B1 | App still building | App job `state: 'working'` (`engine/appjob.mjs:1129`). |
| B2 | Needs you: Vercel not connected | No Vercel credentials (`server/server.mjs:4458`). |
| B3 | Deploying | `appv.deploying` true (`web/canvas/rooms.js:1143`); `app:stage` events `deploy: <stage>`. |
| B4 | Deployed | `app:deployed` with a `url` (`engine/appjob.mjs:1143`). |
| B5 | Deployed, not answering yet, or no link | `app:deployed` with `pending: true`, `url` possibly null (`engine/publish.mjs:266`). |
| B6 | Deploy failed | Nothing saved: the error only reaches the chat line of the page that asked (`web/canvas/rooms.js:1149`). |

### C. A project's source on GitHub (per project and piece: app or game)

Data: the saved link (`sourceLinks`, read at `server/sourcehub.mjs:91`), computed `ahead`, `behind`, `unreachable` (`server/sourcehub.mjs:111`), and the job Map (`server/sourcehub.mjs:45`, lost on restart).

| id | State | The data that makes it so |
|---|---|---|
| C0 | No source here (a website-only project) | `source: false` (`server/sourcehub.mjs:104`): only a run with a `.git` folder counts. |
| C1 | Not signed in | `login` null (`server/sourcehub.mjs:104`). |
| C2 | Not on GitHub | `link` null. |
| C3 | Working (push, pull, bring) | Job `state: 'working'` with `step` (`server/sourcehub.mjs:118`). |
| C4 | Linked, up to date | `link.fits`, not `ahead`, `behind === false`. |
| C5 | Changes not pushed | `ahead` true (`server/sourcehub.mjs:111`). |
| C6 | New commits to pull | `behind` true. |
| C7 | Could not check | `unreachable` holds the error text (`server/sourcehub.mjs:101`). |
| C8 | Failed (with a way forward: pull, new branch, bring files in, replace) | Job `state: 'failed'` with `message` and `pull`, `other`, `changes` or `keys` (`server/sourcehub.mjs:122`). |
| C9 | Failed (no way forward attached) | Job `state: 'failed'` with only `message`, e.g. `Could not push to ${slug}: …` (`engine/sourcehub.mjs:333`). |
| C10 | This version does not fit its repository | `link.fits` false. |

### D. A post to the Swarm Feed (per build)

Data: `posted[run]` in the Feed settings file, written by Python (`feed.py:710`); the token there; and the browser Map `posted.runs` (`web/canvas/publish.js:163`, lost on reload). No Studio event is saved.

| id | State | The data that makes it so |
|---|---|---|
| D0 | Not posted | No `posted[run]`. |
| D1 | Needs you: not signed in to the Feed | No token: the post answers `connect: true` (`commands.py:512`). |
| D2 | Needs you: finish sign-in in the browser | `account.pending` with a code (`web/canvas/publish.js:203`). |
| D3 | Posting | `posted.busy` (`web/canvas/publish.js:210`). Browser only. |
| D4 | Posted | `posted[run]` saved (`feed.py:710`); the browser remembers it only until reload (`web/canvas/publish.js:223`). |
| D5 | Refused: no public link | No `https` site (`feed.py:438`, `feed.py:575`). A local-only publish (A6) is here. |
| D6 | Failed | `ok: false` with a `message` (`commands.py:512`, `server/server.mjs:221`). |
| D7 | Cannot post: Studio not started from Hermes | No Python (`server/server.mjs:217`). |

### E. An export (per build)

Data: one saved event, `export` (`server/server.mjs:4515`). `exp.busy` is browser-only (`web/canvas/design.js:582`). A failure saves nothing.

| id | State | The data that makes it so |
|---|---|---|
| E0 | Never exported | No `export` event. |
| E1 | Exporting | `exp.busy` true (`web/canvas/design.js:587`). |
| E2 | Exported | `export` event with `dir`, `zip`, `pages`, `sections`. |
| E3 | Failed | `POST …/export` answers not ok, e.g. 400 (`server/server.mjs:4518`); nothing saved. |

### F. The launch kit (per build; reads A and B)

Data: `launch.json` in the run folder, each post's `status` (`ready`, then `opened`, `sent`…) (`engine/launch.mjs:119`).

| id | State | The data that makes it so |
|---|---|---|
| F0 | Nothing to launch | No `https` link and no video (`server/server.mjs:1478`, `engine/launch.mjs:67`). |
| F1 | Writing the posts | The `POST …/launch` call is open (`web/canvas/auto.js:440`). |
| F2 | Kit ready | `launch.json` exists; each post `ready`. |
| F3 | A chat network is not connected (needs you) | No gateway entry for the network (`web/canvas/auto.js:522`). |
| F4 | A send failed | `POST …/launch/send` not ok (`web/canvas/auto.js:555`). |

## The table

"nothing" means the surface gives no sign. The Chat is `#feed` (`web/index.html:84`); the Log is `#log` (`web/index.html:100`). A line sent with kind `'sys'` goes to the Log, any other bot line to the Chat (`web/canvas/panels.js:168`).

### A. Site: the canvas surfaces

| State | Publish button (top bar) | Its menu, "Put it online" | Publish sheet | Chat | Log |
|---|---|---|---|---|---|
| A0 idle | "Publish" (`web/canvas/loop.js:149`) | "Website", "Pages only" (`web/index.html:51`); no link row | Host list: "GitHub Pages", "Vercel", "Cloudflare", "This computer" with "public link" or "only you" (`web/canvas/publish.js:31`), under the thumbnail row. Shots `m-pub-thumb`, `f-first-publish`, `f-first-publish-site` | nothing | nothing |
| A1 nothing built | "Publish", disabled, no reason (`web/canvas/loop.js:148`). Enabled as soon as one section is done, while the build still runs | cannot open | cannot open | Typed `/publish` with a build open: the red sheet opens with "no such build, or nothing built yet" (inferred from `web/canvas/loop.js:309`, `server/server.mjs:2824`); nothing in chat | nothing |
| A2 not connected | "Publish" | same as A0 | GitHub row disabled, "run gh auth login" (`web/canvas/publish.js:31`, `web/canvas/publish.js:94`). Vercel and Cloudflare: "Connect ${label}", "Get a token", a field, "Connect" (`web/canvas/publish.js:98`); a bad token shows the first line of the server's reason (`web/canvas/publish.js:121`). Shots `m-pub-connect`, `m-pub-github` | nothing | nothing |
| A3 publishing | "Publishing…" (`web/canvas/loop.js:149`); a click reopens the sheet (`web/canvas/start.js:304`) | not opened while publishing | The host's steps with ✓ ◌ · , e.g. "Exporting the pages", "Making the GitHub repo", "Pushing the site", "Turning on GitHub Pages", "GitHub is building it" (`web/canvas/publish.js:13`, `web/canvas/publish.js:141`). For "This computer": "Publishing…" (`web/canvas/publish.js:139`). The link's row is marked busy (`web/canvas/publish.js:138`), which is where Hermia the pet goes to work (`web/pet.js:136`); no crew name in words. Shot `m-pub-publishing` | nothing | nothing |
| A4 live, public | "Live ↗" (`web/canvas/loop.js:149`, `web/canvas.css:1833`) | The link and "Copy" (`web/index.html:50`, `web/canvas/publish.js:274`). Shot `m-pub-live-menu` | "Live", "${host label}", the link, "Publish again", "Copy link", "Open ↗", then the Feed row (`web/canvas/publish.js:152`). Shot `m-pub-live` | nothing | "🌐 live: ${url}" only as it happens (`web/canvas/publish.js:257`) |
| A5 going live | "Live ↗" | the link, "Copy" | "Live", "${host label} · going live" (`web/canvas/publish.js:152`), for ever after a reload too | nothing | "🌐 live: ${url}" |
| A6 local only | "Live ↗": same word as a public link | the `127.0.0.1` link, "Copy" | "Live", "This computer" (`web/canvas/publish.js:152`, `web/canvas/publish.js:34`). "only you" is said on the host list, not here. Shot `m-pub-live-local` | nothing | "🌐 live: http://127.0.0.1:…" |
| A7 failed | "Publish" (or "Live ↗" in A10) | "Website" reopens the failure (`web/canvas/start.js:325`) | "Not published", the first line of `message` cut at 90 characters, "Other host", "Retry" (`web/canvas/publish.js:144`, `web/canvas/publish.js:127`). Opens by itself when fresh (`web/canvas/publish.js:261`). Shot `m-pub-failed` | nothing | nothing |
| A8 refused | "Publish" | "Website" reopens it until reload | Same red sheet, with the server's sentence, e.g. "connect Vercel first: 🌐 Publish on the canvas, or set VERCEL_TOKEN" (`server/server.mjs:2828`) or "no such build, or nothing built yet" (`server/server.mjs:2824`) | nothing | nothing |
| A9 interrupted | "Publish" | as A0 | Host list, as if never tried | nothing | nothing |
| A10 live, newest try failed | "Live ↗" (label reads `liveUrl()`, `web/canvas/loop.js:149`) | the old link and "Copy"; "Website" opens "Not published" (`web/canvas/start.js:325`) | "Not published" with no mention that the old link still works | nothing | nothing |
| A11 stale | "Live ↗" | the link | "Live" | nothing | nothing |
| A12 sections missing | as A4 | as A4; before publishing, the menu's Website row says "B of T sections" | as A4, and the host list opens with the build's word and "B of T sections" (`web/replaytalk.js` `publishWords`) | nothing | nothing |
| A13 done, no link | "Publish" (`liveUrl()` is empty; a public link from another host is hidden too, `web/canvas/publish.js:255`) | no link row | Falls back to the host list (`web/canvas/publish.js:151`) | nothing | "🌐 live: null" (`web/canvas/publish.js:257`) |
| A14 taken down, domain | nothing | nothing | nothing | nothing | nothing |
| A15 project deleted | gone with the project | gone | gone | nothing | nothing |

### A. Site: the other surfaces

| State | Projects card | Overview | Settings and Setup | Launch kit and Feed post |
|---|---|---|---|---|
| A0 idle | "Website · Designed" or "Draft" (`server/projects.mjs:98`, `web/home.js:190`) | The same top-bar button; its label is hidden at 760 px and narrower (`web/project.css:232`). Nothing in the Overview's own body. Whether `pub` is filled while the Overview is in front: UNCHECKED | Setup › Publishing rows say which hosts are connected (`web/setup-parts.js:121`, `web/setup-parts.js:126`); nothing per build | Kit: refused, "Nothing to launch yet: publish it first." (`server/server.mjs:1481`). Feed: refused, D5 |
| A2 not connected | nothing | nothing | The host row is off, with its fix `gh auth login` (`web/setup-parts.js:122`) | nothing |
| A3 publishing | nothing (the card's "Building" and crew are for builds only) | button label "Publishing…" (inferred: same button) | nothing | nothing |
| A4 live, public | "Website · Live · ${host}" (`server/projects.mjs:85`, `server/projects.mjs:100`, `web/home.js:190`) | button "Live ↗" (inferred: same button) | nothing | Kit (the server's answer; the kit opens only from an Auto summary, `web/canvas/auto.js:421`): can be written; a post can open with "${name} is live.", one of three picks (`engine/launch.mjs:114`). Feed: can post |
| A5 going live | "Live · ${host}": no doubt shown | as A4 | nothing | Kit can say "is live." all the same |
| A6 local only | "Live · 127.0.0.1:${port}" (`server/projects.mjs:81` takes any link, `http` too) | as A4 | nothing | Kit (server's answer, when the run has no Auto link and no app deploy, `engine/launch.mjs:63`): "Nothing to launch yet: publish it first." (`engine/launch.mjs:67`). Feed: "has no public link yet. Publish it first (/swarm publish), then post it." (`feed.py:575`) |
| A7 failed | nothing: "Designed", or still "Live" from an older link | nothing | nothing | nothing |
| A8 refused | nothing | nothing | nothing | nothing |
| A9 interrupted | nothing | nothing | nothing | nothing |
| A10 live, newest try failed | "Live · ${host}" | "Live ↗" (inferred) | nothing | as A4 |
| A11 stale | "Live · ${host}" | "Live ↗" (inferred) | nothing | can say "is live." |
| A12 sections missing | "Partly built · Live · ${host}" (also Failed, Stopped, Building: `server/projects.mjs` `stateOf`) | as A4 | nothing | as A4 |
| A13 done, no link | not Live: the run card skips a `publish:done` with no `url` (`server/server.mjs:775`) | "Publish" (inferred) | nothing | as A0 |
| A15 project deleted | The card is in Trash or gone; nothing says a site is still online | gone | nothing | gone |

The Projects card has one more rule: "Live" comes first in `stateOf` (`server/projects.mjs:85`), so it hides "Building", "App failed" and every other status, and it is true for the whole project once any version went out (`server/projects.mjs:81`).

### B. Working app

| State | Publish button | Menu item "Working app" | Chat | Projects card |
|---|---|---|---|---|
| B0 no app | "Publish" | disabled, "Build the app first (App mode)." (`web/canvas/start.js:318`) | nothing | nothing |
| B1 app building | "Publish" | disabled, "The app is still building." (`web/canvas/start.js:318`) | nothing | "Building" |
| B2 Vercel not connected | "Publishing…" for a moment, then "Publish" | enabled, no reason | "Deploy: connect Vercel first: 🌐 Publish on the canvas → Connect, or set VERCEL_TOKEN" (`web/canvas/rooms.js:1149`, `server/server.mjs:4458`) | nothing |
| B3 deploying | "Publishing…", disabled (`web/canvas/loop.js:148`, `web/canvas/loop.js:149`) | cannot open | "🚀 Deploying the app to Vercel…" (`web/canvas/rooms.js:1144`) | nothing |
| B4 deployed | "Publish" (the label reads only the site's `liveUrl()`, `web/canvas/loop.js:149`) | "Live at ${url}; this sends the latest." (`web/canvas/start.js:318`) | "🚀 The app is live: ${url}" (`web/canvas/rooms.js:1148`) | "App · Live · ${host}" (`server/projects.mjs:81`) |
| B5 pending or no link | "Publish" | "Live at ${url}; this sends the latest." or no reason | "🚀 The app is live: ${url}", with `null` when there is no link (`web/canvas/rooms.js:1148`) | "Live" if a `url` exists (`server/server.mjs:819`) |
| B6 deploy failed | "Publish" | as before the try | "Deploy: ${err.message}" (`web/canvas/rooms.js:1149`); nothing after a reload | nothing |

### C. Source on GitHub

| State | GitHub sheet (☰ › GitHub) | Chat (typed moves) | Projects card, Overview | Settings › You › GitHub |
|---|---|---|---|---|
| C0 no source | "No app or game here yet" and a form to bring a repository in, button "Bring in" (`web/github.js:144`, `web/github.js:305`) | "where is this on github": "No app or game here yet. Bring one in from its GitHub menu." (`web/github.js:168`) | nothing | nothing |
| C1 not signed in | "Not signed in: run gh auth login" (`web/github.js:161`) | the same line, joined into the answer (`web/github.js:167`) | nothing | Row state "Not signed in" (`web/settings.js:101`) |
| C2 not on GitHub | "Not on GitHub", "Where it goes": "New repository", "An existing repository", "A folder on this computer"; "Push" (`web/github.js:147`, `web/github.js:286`) | "Not on GitHub. Say "push to github" to put its source there, private." (`web/github.js:168`) | nothing | Where new repositories go: the account or an organization (`web/settings.js:95`). Shot `m-settings-github` |
| C3 working | A crew cursor and the step, or "Pushing to GitHub", "Pulling from GitHub", "Bringing it in", "Checking GitHub" (`web/github.js:172`, `web/github.js:199`) | The same words in a working bubble with a crew name (`web/github.js:366`, `web/github.js:392`) | nothing | nothing |
| C4 up to date | "${repo}" link, "Private" or "Public", "Pushed ${ago}", "Up to date" (`web/github.js:151`, `web/github.js:159`) | "${repo}, private. Pushed 3 min ago. Up to date." with the link (`web/github.js:169`) | nothing | nothing |
| C5 ahead | "Changes not pushed" (`web/github.js:157`); "Push" leads | the same line | nothing | nothing |
| C6 behind | "New commits to pull" (`web/github.js:158`); "Pull" leads (`web/github.js:302`) | the same line | nothing | nothing |
| C7 could not check | The raw text of the error as a line (`web/github.js:160`, `server/sourcehub.mjs:101`) | the same | nothing | nothing |
| C8 failed, with a way | The message, plus "Push to a new branch" / "Bring its files in first" (`web/github.js:258`, `web/github.js:260`) or "Replace them" (`web/github.js:268`); a `keys` refusal has the message only, no button. Only while the sheet stays open: a sheet opened later drops the job (`web/github.js:351`) | The message plus "Say "pull from github"." or "Say "push to a new branch"…" or "Say "replace them" to write it anyway." (`web/github.js:394`) | nothing | nothing |
| C9 failed, no way | The message in red (`web/github.js:298`); "Push" and "Pull" stay as before | The message alone (`web/github.js:397`) | nothing | nothing |
| C10 does not fit | "This version needs a repository of its own" (`web/github.js:152`) and the "Where it goes" form | the same line | nothing | nothing |

### D. Swarm Feed

| State | Menu item | Feed sheet (alone, or under the Live link) | Chat, Log | Projects card, Overview | Settings › You |
|---|---|---|---|---|---|
| D0 not posted | "Swarm Feed", "Share it" (`web/index.html:53`): always enabled, whatever the publish state | "Public" / "Unlisted", "Post to Feed" (`web/canvas/publish.js:182`) | nothing | nothing | "Swarm Feed" row with the account (`web/settings.js:100`) |
| D1 not signed in | same | "Sign in to post", "Google", "GitHub", "Discord" (`web/canvas/publish.js:176`) | nothing | nothing | the row is off (`web/settings.js:100`) |
| D2 finish in browser | same | "Finish in your browser", the code, "Open again", "Cancel" (`web/canvas/publish.js:174`) | nothing | nothing | UNCHECKED |
| D3 posting | same | "Posting…", disabled (`web/canvas/publish.js:182`). No crew cursor | nothing | nothing | nothing |
| D4 posted | same | "In the Feed", "Public" or "Unlisted", the link (`web/canvas/publish.js:172`). After a reload: "Post to Feed" again (D0) | nothing | nothing | nothing |
| D5 no public link | same | The Feed's sentence, first line, cut at 90 characters: "“${title}” has no public link yet. Publish it first (/swarm publish), then post it." (`feed.py:575`, `web/canvas/publish.js:183`) | nothing | nothing | nothing |
| D6 failed | same | The message in red (`web/canvas/publish.js:183`), "The Feed did not take it." when there is none (`web/canvas/publish.js:224`), or a raw "Command failed: …" line (`server/server.mjs:221`). "Post to Feed" stays as the retry | nothing | nothing | nothing |
| D7 no Hermes | same | "Start Swarm Studio from Hermes to post to the Feed." (`server/server.mjs:217`) | nothing | nothing | nothing |

### E. Export

| State | Export button (deck) | Export pop | Chat | Log | Overview (a page's "Export") |
|---|---|---|---|---|---|
| E0 never | "Export"; disabled until one section is done (`web/canvas/loop.js:144`) | nothing | nothing | nothing | "Export" on a selected page (`web/project.js:474`) |
| E1 exporting | disabled, same word (`web/canvas/loop.js:144`): no "working" sign | nothing | nothing | nothing | toast "Preparing" (`web/project.js:1139`) |
| E2 exported | "Export" | "Exported, ready", "html/", "react/", "aba/", the folder path, "Download .zip" (`web/canvas/design.js:601`), only within 8 s of the event (`web/canvas/events.js:275`) | nothing | "⬇ exported ${pages} pages to ${dir}" (`web/canvas/design.js:612`) | toast with the zip's name; the file downloads (`web/project.js:1141`) |
| E3 failed | "Export" | nothing | "export: ${error}" or "export: the canvas server is not answering" (`web/canvas/design.js:592`) | nothing | toast with the error's words, e.g. "export failed" (`web/project.js:1151`, `web/project.js:1144`) |

### F. Launch kit

| State | Auto summary card | Launch kit pop | Chat |
|---|---|---|---|
| F0 nothing to launch | No "Open the launch kit" button (`web/canvas/auto.js:114`, `web/canvas/auto.js:412`) | If opened: "Nothing to launch yet: publish it first." (`server/server.mjs:1481`, `web/canvas/auto.js:442`) | nothing |
| F1 writing | nothing | "Writing the posts…" (`web/canvas/auto.js:434`). Shot `m-launch-writing` | nothing |
| F2 ready | "Live at", the link, "Copy link" when there is a link (`web/canvas/auto.js:411`) | "Written from this run's facts and its live link." (`web/canvas/auto.js:452`) and a card per network. Shot `m-launch-kit` | nothing |
| F3 not connected | nothing | The post button is disabled and reads "Connect ${label} in Hermes to send" (`web/canvas/auto.js:522`) | nothing |
| F4 send failed | nothing | The server's `error`, or "the send failed" (`web/canvas/auto.js:555`); "Send" is enabled again | nothing |

Two more facts. The hosted studio hides the whole Publish area and Export (`web/canvas.css:1808`) and its server refuses those routes with an install note (`server/hosted.mjs:441`). And on "does the chat say published from the state": for a site the Studio chat says nothing at all, in any state; the only words are the Log's "🌐 live: ${url}", built from the event (`web/canvas/publish.js:257`). For the working app the chat line is fixed text (`web/canvas/rooms.js:1148`). Outside the Studio, Hermes's own reply to `/swarm publish` is built from the job: "is live: ${url}" with "(still going live; give it a minute)" when pending, or "Publish: ${message}" (`commands.py:586`, `commands.py:590`).

## Holes

Kinds: (a) a state with no sign, (b) two surfaces disagree, (c) a failure with no plain reason or no way forward, (d) a sentence not made from the state.

1. **PU1** (b) A6 local only: the Projects card says "Live · 127.0.0.1:${port}" and the button says "Live ↗", while the Feed and the launch kit say there is no public link (`server/projects.mjs:81`, `web/canvas/loop.js:149`, `feed.py:575`, `engine/launch.mjs:67`). No test pins it (`tests/projects.test.mjs:85` only builds a card with an `https` Vercel link). Hit it: Publish › Website › This computer, then open Projects.
2. **PU2** (b) **Closed for a website whose newest build is running or not whole**: the card reads that build's own word first and keeps "Live" with the host, "Website · Failed · Live · HOST" (also Building, Partly built, Stopped), so it is still live at its address and its newest build failed (`server/projects.mjs` `stateOf`, `live`; `tests/buildstate.test.mjs`; shots `c-live-failed`, `c-live-building`). The filter's "Live" lists it too. Still open: the address is the first host ever used on the newest published version, not the newest publish; an app's or a game's card still tests Live first; nothing clears Live. A site on GitHub Pages whose repository moved to another owner shows where it is now once the Publish menu was opened for that build (the server asks GitHub then, one question for that one build, and keeps the answer in the data folder's `github.json`; `engine/ghowner.mjs` `siteNow`, `server/server.mjs` `syncSite`, `sitesNow`): the card, the Publish menu and the Live dialog read it; the launch kit, the Feed post and the app's link still read the saved address. As it was: "Live" on the Projects card outlives the truth: it is read from any `publish:done` ever saved, on any version, takes the first host ever used rather than the newest, comes before "Building" and "App failed", and nothing ever clears it (`server/projects.mjs:81`, `server/projects.mjs:85`, `server/server.mjs:775`). Hit it: publish version 1, then build version 2 and let it fail: the card still reads "Live".
3. **PU3** (a) **Closed for the Publish menu and dialog**: Publish stays possible, and says what goes live from the build state: the menu's Website row reads "5 of 9 sections" under "Pages only", and Publish › Website opens with the build's word and the same count ("Partly built", "5 of 9 sections") above the hosts; a whole build says nothing more. With no section built the Publish button still opens its menu, Website and Swarm Feed can not be pressed, and Website says "Nothing is built yet." (`web/replaytalk.js` `publishWords`, `web/canvas/publish.js` `pubButton`, `publishMenu`, `web/canvas/loop.js`; `tests/replaytalk.test.mjs`; shots `c-publish-part`, `c-publish-part-hosts`, `c-publish-none`). Still open: "publish" typed in the chat goes straight out with no such line, and the Live dialog does not say how much went out. As it was: A12: a build with failed sections, or one still running, publishes without them and nothing warns; Publish is enabled after the first finished section because `S.done` is a count (`web/canvas/events.js:142`, `engine/run.mjs:419`, `web/canvas/loop.js:148`, `web/canvas/publish.js:233`, `engine/export.mjs:41`, `server/server.mjs:2824`). `docs/ux/breadboards/publish.md` says "disabled until the build is done": the code does not do that, and no CSS rule disables the button either. Hit it: press Publish while the crew is still on page 2.
4. **PU4** (a) A11 stale: no surface knows the site is older than the build; "Live" stays after any edit, and a new version shows "Publish" with no word that an older version is online (`web/canvas/publish.js:37`, `server/projects.mjs:81`). Hit it: publish, change the hero, look anywhere.
5. **PU5** (c) A7 on GitHub, not signed in: the reason says "GitHub CLI is not signed in (run `gh auth login`), so the site is hosted on this computer only", but no local publish happens and no link is shown (`engine/publish.mjs:83`, `server/server.mjs:2859`); the sheet cuts it at 90 characters, so the false half is partly shown (`web/canvas/publish.js:129`). Hit it: type `/publish` (it goes to GitHub by default, `web/canvas/loop.js:309`) while the sheet's GitHub row is disabled (`web/canvas/publish.js:96`).
6. **PU6** (c) Raw errors reach "Not published": `shortReason` keeps the first line of whatever the server threw (`web/canvas/publish.js:128`). Raw today: "gh api: <gh's last stderr line>" (`engine/publish.mjs:76`), "git -c: <git's last stderr line>" (the command name and its first argument, `engine/publish.mjs:24`, `engine/publish.mjs:105`), "Vercel: <API message or status number>" (`engine/publish.mjs:212`), "Vercel deployment error" (`engine/publish.mjs:245`), "Cloudflare: <API message>" (`engine/publish.mjs:288`), "connect Vercel first: 🌐 Publish on the canvas, or set VERCEL_TOKEN" (`server/server.mjs:2828`), "no such build, or nothing built yet" (`server/server.mjs:2824`). Hit it: publish to GitHub Pages with no network.
7. **PU7** (c) A7, the way forward is cut off: "Builds go to ${org}, which can't be used: ${why}. Choose another in Settings › You › GitHub" is longer than 90 characters, so the fix is lost (`engine/ghowner.mjs:105`, `web/canvas/publish.js:129`); the keys refusal reads "Not published" twice, heading then sentence (`engine/publish.mjs:81`, `web/canvas/publish.js:144`). Hit it: publish to an organization that blocks Pages.
8. **PU8** (d) B4, B5: "🚀 The app is live: ${out.url}" is a fixed sentence; it ignores `pending`, which means no address answered yet (`web/canvas/rooms.js:1148`, `engine/publish.mjs:266`). In code it can also print "null" (`engine/publish.mjs:263`), not seen. Hit it: deploy an app whose Vercel address is slow to answer.
9. **PU9** (a) A9 interrupted and A8 refused leave no trace: a restart mid-publish, or a refusal before `publish:start`, reads as never tried on every surface after a reload, though a public repo may already exist (`web/canvas/publish.js:249`, `server/server.mjs:2845`, `server/server.mjs:4025`, `engine/publish.mjs:92`). Hit it: stop the Studio while "GitHub is building it" shows.
10. **PU10** (b) A10: the button says "Live ↗" and its menu shows the old link, while "Website" opens "Not published" with no word that the old site is still up (`web/canvas/loop.js:149`, `web/canvas/start.js:325`, `web/canvas/publish.js:144`). Hit it: Publish again with the network off.
11. **PU11** (a) A7, A8 in the Chat and the Log: a failed publish writes nothing to either; only the sheet knows, and once closed only "Website" brings it back (`web/canvas/publish.js:251`). Success writes to the Log only, never the Chat (`web/canvas/publish.js:257`). Hit it: type `/publish vercel` with no token, close the sheet.
12. **PU12** (a) No typed route but the slash: plain words like "publish it" are routed as a change to the build, `'extend'` (`web/route.js:44`, `web/canvas/loop.js:467`); what the planner then answers is UNCHECKED. "Retry", "Other host", "Connect", "Disconnect", "Copy link", "Post to Feed", "Publish again" and the working-app deploy have no typed route at all; only `/publish` and `/export` exist (`web/canvas/loop.js:308`, `web/canvas/loop.js:309`). "publish to <organization>" is taken as a setting, not a publish (`web/canvas/loop.js:422`, `web/github.js:74`).
13. **PU13** (a) D4 after a reload: the browser forgets the post; the sheet offers "Post to Feed" again and no surface says the build is in the Feed (`web/canvas/publish.js:163`, `feed.py:710`). Pressing it again answers "already" and the "Public" or "Unlisted" label then comes from the toggle, not from the post (`feed.py:680`, `web/canvas/publish.js:223`). Hit it: post, reload, open Publish › Swarm Feed.
14. **PU14** (c) D5, D6, D7: the Feed row shows Python's sentence. It names a Hermes command inside the Studio ("/swarm publish": `feed.py:575`), is cut at 90 characters, can be a raw "Command failed: …" line (`server/server.mjs:221`), and offers no "Publish" button. "Swarm Feed" in the menu is enabled even when it must refuse (`web/index.html:53`). Hit it: Publish › This computer, then Swarm Feed › Post to Feed.
15. **PU15** (a) A15: deleting a project leaves its site online and removes the saved link with the run's events; only the repo's name stays, in the data folder's claims (`server/projects.mjs:313`, `server/projects.mjs:325`, `engine/connect.mjs:160`). The confirm says only "Its files can't be brought back." (`web/home.js:570`). There is no unpublish anywhere (A14). Hit it: publish, Delete, Delete forever.
16. **PU16** (a) A5: "going live" is saved once and never checked again; it shows for ever, and the card and the launch kit say "Live" / "is live." at once (`web/canvas/publish.js:152`, `engine/publish.mjs:143`, `server/projects.mjs:85`, `engine/launch.mjs:114`). Hit it: publish to GitHub Pages on a slow day.
17. **PU17** (c) B2, B6: a failed app deploy is one chat line, "Deploy: ${err.message}", raw, with no button, no saved event and no sign after a reload; the button flashes "Publishing…" first (`web/canvas/rooms.js:1149`, `server/server.mjs:4458`). Hit it: Publish › Working app with no Vercel token.
18. **PU18** (b) B4: the app is deployed, the Projects card says "Live", the menu says "Live at ${url}", but the Publish button says "Publish" because its label reads only the site's link (`web/canvas/loop.js:149`, `web/canvas/start.js:318`, `server/projects.mjs:81`). Hit it: Publish › Working app on a build whose site was never published.
19. **PU19** (b) F0, minor: the kit's link is the Auto run's, else the app's, else the last `publish:done` of any host, and then it must be `https` (`engine/launch.mjs:63`, `engine/launch.mjs:67`). On a run with no Auto link and no app deploy, a local publish after a public one hides the public link. The kit opens only from an Auto summary (`web/canvas/auto.js:421`), where the Auto link comes first, so a person is unlikely to hit it today; it matters as one more selector that disagrees.
20. **PU20** (a) A13 (code only, not seen): a `publish:done` with no link writes "🌐 live: null" to the Log, drops the sheet back to the host list with no word, and hides a real public link from another host (`web/canvas/publish.js:254`, `web/canvas/publish.js:255`, `web/canvas/publish.js:151`). Hit it: a Vercel deployment that is READY with no address.
21. **PU21** (a) C8 opened later: a failed push and its ways forward are dropped when the sheet is opened again ("not news"), and the job Map is lost on a restart; the sheet then shows only "Changes not pushed" (`web/github.js:351`, `server/sourcehub.mjs:45`). The typed "push to a new branch" still works only while the server remembers (`web/github.js:383`). Hit it: push to a repository that holds other work, close the sheet, open it again.
22. **PU22** (a) C0: a website-only project cannot put its source on GitHub; the sheet says "No app or game here yet" and offers only to bring another repository in (`web/github.js:144`, `server/sourcehub.mjs:156`). The Projects card and the Overview never show a GitHub link in any C state. Hit it: ☰ › GitHub on a project that is only a website.
23. **PU23** (c) C7, C9: the raw error text is shown as a line or a red sentence with no next step (`server/sourcehub.mjs:101`, `web/github.js:160`, `engine/sourcehub.mjs:333`). Hit it: open the GitHub sheet with the network off.
24. **PU24** (a) A1, E0: Publish and Export are disabled with no reason (`web/canvas/loop.js:144`, `web/canvas/loop.js:148`); "Working app" does give one (`web/canvas/start.js:318`). Hit it: open a build whose every section failed.
25. **PU25** (a) D3, E1, B3: nobody is shown working. Publishing a site marks its link row busy for Hermia (`web/canvas/publish.js:138`, `web/pet.js:136`), but "Posting…" and a disabled "Export" carry no such mark (`web/canvas/publish.js:182`, `web/canvas/loop.js:144`), and the app deploy is a chat line (`web/canvas/rooms.js:1144`). The standing rule asks for a crew cursor on anything loading. Hit it: press Post to Feed, or Export on a large site.
26. **PU26** (d) A6: the local "site" is whatever the newest export folder holds (`server/server.mjs:4769`); a later Export, or Post to Feed's page shots (`server/server.mjs:4531`), rewrites it (`engine/export.mjs:540`) without a new `publish:done`. The link "Live" points at then is not what was published. Hit it: publish to This computer, edit, press Export, open the link.
27. **PU27** (b) E2 from two doors: the deck's Export sends the canvas's own sections (`web/canvas/design.js:588`); the Overview's Export sends `{}` (`web/project.js:1141`), so it is built from saved events only. Whether the two zips differ after hand edits: UNCHECKED (inferred from `engine/export.mjs:40`). Hit it: change a heading by hand, then Export from the deck and from the Overview.
28. **PU28** (d) Two meanings of "live": on a card, the class `live` and `p.live` mean "a build is running" (`server/projects.mjs:237`, `web/home.js:200`), while the status "Live" means published (`server/projects.mjs:85`). Hit it: read the code or the filter list; on screen a building card and a "Live" card are both "live".
29. **PU29** (b) React (`ui/src`), A13: the deck model folds the same events but drops a `publish:done` with no link (`ui/src/screens/deck/model.ts:302`), so A13 reads differently from the classic sheet; it has the same A9, A10, A11 gaps. Hit it: the same as PU20, in the React deck.
30. **PU30** (c) A7, A8: every reason gets the same two buttons, "Other host" and "Retry" (`web/canvas/publish.js:145`, `web/canvas/publish.js:146`). "Retry" repeats the same call, so it cannot work when the cause is "connect Vercel first" or "not signed in"; there is no "Connect" or "Set up" button on the failure, and no typed route for either button (see PU12). Hit it: type `/publish vercel` with no token, press Retry.

## Where the state should live

There is no single selector today. "The live link" is answered ten ways: `web/canvas/publish.js:37` with `web/canvas/publish.js:255` (newest public host, else local), `server/server.mjs:775` (last per host, plus the app's deploy), `server/server.mjs:4016` (the status route), `server/server.mjs:2249` (public only, app first), `server/projects.mjs:81` (first host ever, `http` allowed), `server/projects.mjs:233` (first `https`), `feed.py:438` (github, then vercel, then cloudflare), `engine/launch.mjs:63` (last of any host, then `https` only), `engine/appjob.mjs:741`, and `web/canvas/start.js:318` (the app's own state). The one place should be a function over a build's saved events, on the server beside `runCard` (`server/server.mjs:775`), returning for the site and the app each: `state` (none, working with stage, live, live local, pending, failed with reason and next step, interrupted), `url`, `host`, `public`, `at`, and `stale` (any `edit` or `layer:done` after `at`), with the failure, the refusal and the Feed post saved as events so they survive a reload. The nearest existing piece is the `GET /api/runs/<id>/publish` answer (`server/server.mjs:4018`), which already merges the job Map with the saved events; it lacks `public`, `stale`, the interrupted case and the app. Not reading it today: the Publish button and sheet (they fold events in the browser), the Projects card (`stateOf`), the Feed post, the launch kit, the promo game's link, and the working-app line in the menu.
