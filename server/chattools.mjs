// The tools the chat's planner can call (decision 0025 e; the shape is engine/helpers.mjs, the interface
// docs/specs/47-chat-helper.md). Each part that brings a tool adds it here, built from the server's own stores:
//   (a) research #606, (b) the game Plan board's intake #607, (c) the app builder's web tools #608,
//   and the asset library (the first one wired, below).
// deps: what the tools need from server.mjs (its stores); none is a key or a new host.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

// The asset library (engine/assetlib.mjs): "find me a pixel sword" shows three pictures, each with its credit and
// licence; pressing one puts it where this talk is: a game plan's art references, else the project's References.
// The search reads only what is on disk; a press may download an assetrizz picture the first time (the person's
// press is the yes).
export function libraryTool({ assets, refs, plans }) {
  const credit = r => [r.credit, r.license].filter(Boolean).join(', ')
  return {
    name: 'library_search',
    about: 'find pictures in the asset library: game art (icons, characters, enemies, backgrounds, props, tiles, ui, vfx, portraits, weapons), with their credit',
    args: { q: 'what to look for, in a few words (for example "pixel sword")', category: 'optional: one of icons, characters, enemies, backgrounds, props, tiles, ui, vfx, portraits, weapons' },
    run: async ({ q = '', category = '' }, ctx) => {
      const found = assets.search({ q, category: category ? [category] : [], limit: 3 })
      const to = ctx.plan ? { plan: ctx.plan } : ctx.project ? { project: ctx.project } : null
      if (!found.length) return { text: `Nothing in the asset library matches "${q}".`, cards: [] }
      return {
        text: to ? `Here are ${found.length} from the asset library. Press one to keep it with ${to.plan ? 'the game\'s art references' : 'the project\'s References'}.` : `Here are ${found.length} from the asset library.`,
        cards: found.map(r => ({
          title: r.subject || basename(r.path || r.id), source: `${r.own ? 'your pack' : 'assetrizz'} ${r.pack}: ${credit(r)}`,
          // the picture only when it is on disk already: showing a card downloads nothing
          ...(assets.local?.(r.id) ? { img: `/library/pic?id=${encodeURIComponent(r.id)}` } : {}), note: r.category,
          ...(to ? { act: { id: r.id, ...to }, pick: 'Keep this' } : {})
        }))
      }
    },
    act: async ({ id, plan, project }) => {
      const got = await assets.file(id)
      if (!got) throw Object.assign(new Error('that picture is not in the library any more'), { status: 404 })
      const name = basename(got.file).replace(/[^\w.() +-]+/g, '_')
      const buf = readFileSync(got.file)
      if (plan) plans.addRef(plan, { name, buf })
      else refs.addFile(project, { name, source: 'chat', use: '' }, buf)
      return { text: `Kept ${got.row.subject || name} with ${plan ? 'the game\'s art references' : 'the project\'s References'}. Credit: ${credit(got.row)}.` }
    }
  }
}

// The game Plan board's intake from the chat (decision 0025 b and e, issue #607): "use this for the boss", "make it
// as is", "bring in characters like these". Each runs on the talk's plan (ctx.plan) and only reads; a press writes.
// The parts a picture can be for: the plan's sheets, its screens (mocks) and its backdrops (engine/planart.mjs).
export function gamePartsOf(plan) {
  const sheets = plan?.art?.sheets || ['cast', 'weapons']
  const shots = (plan?.art?.shots || [['combat'], ['boss'], ['ult'], ['levelup'], ['select']]).map(s => s[0])
  return [...sheets.map(k => ({ slot: `sheet:${k}`, name: `${k} sheet`, words: [k] })), ...shots.map(k => ({ slot: `mock:${k}`, name: `${k} screen`, words: [k, k.replace('levelup', 'level up')] })),
    ...(plan?.shape?.backdrops === false ? [] : [{ slot: 'backdrops', name: 'backdrops', words: ['backdrop', 'background', 'world', 'stage'] }])]
}
// the part a few words name: "the boss", "Cast sheet", "the backgrounds"
export function gamePartFor(plan, words = '') {
  const w = String(words).toLowerCase()
  return gamePartsOf(plan).find(p => p.words.some(x => w.includes(x))) || null
}
// the plan's pictures (not pasted words or links), newest first
const pictures = plan => (plan?.refs || []).filter(r => !r.removed && !r.kind && r.src).reverse()
const noPlan = { text: 'This talk has no plan yet: say what the game is, then lock it.', cards: [] }

export function gameIntakeTools({ plans, assets = null }) {
  const tools = [{
    name: 'plan_use_for',
    about: 'use one of the owner\'s pictures for one part of the game (a sheet such as cast, a screen such as boss or combat, or the backdrops): the painter follows it there',
    args: { part: 'the part, in a few words (for example "the boss", "cast sheet", "backdrops")' },
    kinds: ['game'],
    run: async ({ part = '' }, ctx) => {
      const plan = ctx.plan && plans.get(ctx.plan)
      if (!plan) return noPlan
      const at = gamePartFor(plan, part)
      if (!at) return { text: `Which part? ${gamePartsOf(plan).map(p => p.name).join(', ')}.`, cards: [] }
      const pics = pictures(plan).slice(0, 3)
      if (!pics.length) return { text: `Drop or paste a picture on the Plan board, then say it is for the ${at.name}.`, cards: [] }
      return {
        text: `Press the picture the ${at.name} should follow.`,
        cards: pics.map(r => ({ title: r.name, source: 'your art references on the Plan board', img: r.src, note: r.for ? `now for ${r.for}` : '', act: { plan: plan.id, ref: r.id, slot: at.slot }, pick: `Use for the ${at.name}` }))
      }
    },
    act: async ({ plan, ref, slot }) => {
      const r = plans.refUse(plan, ref, { slot })
      const at = gamePartsOf(plans.get(plan)).find(p => p.slot === slot)
      return { text: `The ${at?.name || slot} will follow ${r.name} when it is painted.` }
    }
  }, {
    name: 'plan_references',
    about: 'show the owner\'s pictures on the game\'s Plan board, to make one a look to match or a picture placed as it is',
    args: {},
    kinds: ['game'],
    run: async (_args, ctx) => {
      const plan = ctx.plan && plans.get(ctx.plan)
      if (!plan) return noPlan
      const pics = pictures(plan).slice(0, 3)
      if (!pics.length) return { text: 'There are no pictures on the Plan board yet: drop or paste one there.', cards: [] }
      return {
        text: 'A look to match, or placed as it is?',
        cards: pics.map(r => ({ title: r.name, source: 'your art references on the Plan board', img: r.src, note: r.asIs ? 'placed as it is' : 'a look to match', act: { plan: plan.id, ref: r.id, asIs: !r.asIs }, pick: r.asIs ? 'Like this' : 'Use as is' }))
      }
    },
    act: async ({ plan, ref, asIs }) => {
      const r = plans.refUse(plan, ref, { asIs })
      return { text: r.asIs ? `${r.name} is placed in the game as it is, never redrawn.` : `${r.name} is a look to match again.` }
    }
  }]
  // characters like these: three from the asset library's characters; a press keeps one as the cast sheet's look
  if (assets) tools.push({
    name: 'game_characters',
    about: 'find characters in the asset library for the game\'s cast; the one pressed is the look the cast sheet follows',
    args: { q: 'what the characters are like, in a few words (for example "pixel knight")' },
    kinds: ['game'],
    run: async ({ q = '' }, ctx) => {
      if (!ctx.plan || !plans.get(ctx.plan)) return noPlan
      const found = assets.search({ q, category: ['characters'], limit: 3 })
      if (!found.length) return { text: `No characters in the asset library match "${q}".`, cards: [] }
      return {
        text: 'Press the one the cast should look like.',
        cards: found.map(r => ({ title: r.subject || basename(r.path || r.id), source: `${r.own ? 'your pack' : 'assetrizz'} ${r.pack}: ${[r.credit, r.license].filter(Boolean).join(', ')}`,
          ...(assets.local?.(r.id) ? { img: `/library/pic?id=${encodeURIComponent(r.id)}` } : {}), act: { id: r.id, plan: ctx.plan }, pick: 'Cast like this' }))
      }
    },
    act: async ({ id, plan }) => {
      const got = await assets.file(id)
      if (!got) throw Object.assign(new Error('that picture is not in the library any more'), { status: 404 })
      const r = plans.addRef(plan, { name: basename(got.file).replace(/[^\w.() +-]+/g, '_'), buf: readFileSync(got.file) })
      plans.refUse(plan, r.id, { slot: 'sheet:cast' })
      return { text: `The cast sheet will follow ${got.row.subject || r.name}. Credit: ${[got.row.credit, got.row.license].filter(Boolean).join(', ')}.` }
    }
  })
  return tools
}

export function chatTools(deps = {}) {
  return [
    ...(deps.assets && deps.refs ? [libraryTool(deps)] : []),
    ...(deps.plans?.refUse ? gameIntakeTools(deps) : []),
    ...(deps.extra || [])
  ]
}
