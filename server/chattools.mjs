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
          img: `/api/library/file?id=${encodeURIComponent(r.id)}`, note: r.category,
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

export function chatTools(deps = {}) {
  return [
    ...(deps.assets && deps.refs ? [libraryTool(deps)] : []),
    ...(deps.extra || [])
  ]
}
