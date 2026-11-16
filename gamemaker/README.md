# The guided game maker's own files

These are the pieces the Studio needs from the ARES game that used to live in `games/ares/`. ARES is a
hand-coded demo game of its own and it moved to its own repository, [Pukujan/ares](https://github.com/Pukujan/ares),
on 2026-11-16: everyone installing this plugin had been downloading 164 MB of it (owner, 2026-11-15).

What stayed, and why:

| File | Who reads it | Why the Studio needs it |
| --- | --- | --- |
| `heroes.json` | `server/server.mjs` (the workshop voices), `engine/skins.mjs`, `engine/voice.mjs`, `tests/skins.test.mjs`, `tests/voice.test.mjs` | The shape of a game's config: the voices, the heroes, the sheet contract (`sheet`), the effects. It is the file the guided game maker writes for a person's own game (docs/specs/22-guided-game-maker.md:38, 134). |
| `cut.py` | `engine/skins.mjs` (`cutSheet`), `server/server.mjs` (sprite strips, `scripts/idle_sheet.py`) | The sheet cutter: keys a painted sheet out of its flat colour and cuts it into a strip of frames. Needs numpy, scipy and Pillow in the Python the Studio runs — Setup › Game › **Sprite cutter** says so and gives the command (web/setup-parts.js). |
| `plan.json` | `server/server.mjs` (`builtInTemplates`) | The remixable game plan on the Make box's 💡 pop: a new plan from it, opened at the gate (docs/specs/21-plan-before-spend.md:200). Its `id` is `t-ares`, so remixes of it are recognisable. |
| `backdrops/` | the guided game maker's World step (docs/specs/22-guided-game-maker.md:73) | Four level looks as stills, to start a new game's world from. |
| `faces/` | the guided game maker's personality chips (docs/specs/22-guided-game-maker.md:177) | Face crops for the cast. |

Nothing else came across: the game's own art (`assets/art`, `assets/skins`, `assets/voice`, `assets/music`,
`assets/stages`, `assets/pets`, `assets/fx`, `assets/sfx`, `assets/level`, `assets/boss`), its web build, its
Godot project, its scripts, its content (`data/stages.json`, `enemies.json`, `fights.json`, `bosses.json`,
`CONTENT.md`) and its content check are all in [Pukujan/ares](https://github.com/Pukujan/ares), with their
history. The demo game it used to serve at `/studio/app/ares/` is now at
<https://pukujan.github.io/ares/web/>.

`tests/test_sheet_cut.py` still tests `cut.py` here, because the Studio runs it.
