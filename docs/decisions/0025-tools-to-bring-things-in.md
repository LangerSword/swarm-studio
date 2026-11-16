# 0025. Tools to bring things in: research, the Plan board's intake, the app builder's web tools, agent tools

- Date: 2026-11-15
- Status: accepted by the owner. The quotes are the owner's words; the rest is *our wording*.
- Builds on [0015](0015-studio-walk-and-chat.md) (drop anything anywhere, importer first),
  [0022](0022-copy-the-look-from-a-link.md) (a link's look, walked behind the SSRF guard) and issue #543 (one drop
  target; a game's art references).

## Context

The owner asked where they can paste things, links or libraries, and whether the agent has tools to retrieve
things from online, **"or a tiny fish connector for research?"** When shown the gaps, they said:
**"gonna need a bunch of them tools or all of them."**

What exists today *(our wording)*:

- The bridge already has `POST /web`: Hermes's own `web_search` and `web_extract`, at most 20 results or 5
  addresses a call. Nothing in the server calls it yet (docs/engines/hermes-and-connections.md, Image painting).
- MCP connectors the person installed are reached through `ctx.call_mcp` (bridge.py `mcp`), with Hermes's
  allowlist and trust gates. Supabase is the only one wired (engine/hermes_connect.mjs `CONNECTORS`).
- The app builder's own web tools (`web_search`, `web_fetch`, `web_crawl`, which clones a site) don't work in
  Swarm. They call `/tools/web-search`, `/tools/web-crawl` and the like on `DYAD_ENGINE_URL`, which Swarm doesn't
  serve (docs/engines/dyad.md, Limits).
- A game's Plan board takes a dropped picture as an art reference (#605), but not a paste, a link, a library
  picture or a character of the person's own.
- The asset library (assetrizz and the person's own packs, engine/assetlib.mjs) and References have routes, but
  the Hermes agent has no tool for them.

## Decision

*(our wording)* Build all four, each its own issue and its own small PRs.

- **(a) A research step for the planner.** Before it plans, the planner can search and read the web through
  Hermes's `web_search` / `web_extract` (the bridge's `POST /web`). It can also use a research connector the
  person has granted in Hermes, such as TinyFish, through `ctx.call_mcp`. What it finds shows up as references
  the person keeps or removes; nothing found reaches the crew unseen.
- **(b) The game Plan board's intake.** Beyond a dropped picture:
  - a paste (a picture, words or a link);
  - links;
  - assets used as given;
  - a pick from the asset library;
  - characters of the person's own.
- **(c) The app builder's web tools work in Swarm.** Search, fetch and clone a site go through Swarm's own
  routes, which answer through Hermes's tools (a) and the site walk, not through a service of their own.
- **(d) Agent tools.** The Hermes agent's `swarm_studio` tool can:
  - search the asset library;
  - import a pack of the person's own;
  - pick a library picture for a build's slot;
  - add a link or a file to a project's References.

### Added 2026-11-15: (e) the chat is the helper

The owner, the same day: **"and a chat as helper."**

*(our wording)* The chat is the helper for all of this, on every screen and in every mode, a game's included. The
person asks Hermia in the chat for anything the tools above do, and she does it there:

- "find me a pixel sword": she searches the asset library and shows a few to pick from;
- "look up how X does its pricing page": she runs the research step (a) and shows what it found;
- a pasted link or picture: she asks once, "like this, or use as is?";
- "use this for the boss": she puts a picture in that slot;
- "bring in characters like these": she opens the character choices (b).

She shows what she found as a few cards to pick from, three at most, each saying where it came from. Nothing that
writes, spends or publishes happens until the person presses or says yes. It is the same planner with these tools
available to it, not a second assistant. One shared piece, how the planner calls a tool and returns cards to the
chat in both Studios, is built once and documented for the parts that plug into it.

## Standing rules

These hold for every part:

- **Everything online goes through Hermes's own tools or a connector the person granted.** No new key reaches
  the Studio. The site walk's SSRF guard (engine/walkguard.mjs) and the sandbox rules for generated code hold.
- **Anything fetched is shown, with its source, before it is used.** A search result, a page's words, a library
  picture or a connector's answer appears as a reference, with where it came from, and the person can remove it.
- **What writes, downloads or puts something online asks first.** Publish, post and deploy still go through
  Hermes's approval gate (commands.py `approval_hook`). So do the agent tools that write or download (d).
- **Every new host or tool is disclosed**, in `plugin.yaml` and the README, for the catalog's reviewers.

## Consequences

- One issue log per part: (a) #606, (b) #607, (c) #608, (d) #609, (e) #617. Each part is built by its own
  session in small PRs; (a) to (d) each make their tool callable from the chat through (e)'s interface.
- (c) depends on (a)'s search and fetch routes. (b) and (d) share the asset library and References routes.
- docs/engines/hermes-and-connections.md lists each new use of `POST /web`, `ctx.call_mcp` and the agent tools,
  and docs/engines/dyad.md drops the "do not work in Swarm today" line once (c) lands.
