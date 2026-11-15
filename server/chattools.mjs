// The tools the chat's planner can call (decision 0025 e; the shape is engine/helpers.mjs, the interface
// docs/specs/47-chat-helper.md). Each part that brings a tool adds it here, built from the server's own stores:
//   (a) research #606, (b) the game Plan board's intake #607, (c) the app builder's web tools #608,
//   and the asset library (the first one wired, below).
// deps: what the tools need from server.mjs (its stores); none is a key or a new host.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import { researchTool } from './researchtool.mjs'

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

// The app builder's web tools in the chat (part c, #608): search the web, read a page, and look at a site to clone.
// Each reads through Hermes's own web tools (the bridge's POST /web) and the guarded site walk, the same reads the
// app engine's tools use (engine/enginetools.mjs webReads). Cloning a site into the app is a card's press: it starts
// the app engine, which spends model calls, so the press is the yes.
// reads: webReads(...); runsDir: where a run keeps its pictures; change(run, ask): one more change to that run's app.
export function webTools({ reads, runsDir, change }) {
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return String(u || '') } }
  const firstLine = md => String(md || '').replace(/^#+\s*/gm, '').split(/\n+/).map(l => l.trim()).find(l => l.length > 20) || ''
  const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s))
  const url = a => String(a.url || '').trim()
  return [{
    name: 'web_search',
    about: 'search the web for something the person asks about (a library, an API, how a kind of app usually works), with each result\'s address',
    args: { q: 'what to search for, in a few words' },
    kinds: ['app'],
    run: async ({ q = '' }) => {
      const query = String(q).trim().slice(0, 300)
      if (!query) return { text: 'Say what to search for.', cards: [] }
      const found = (await reads.search(query, 3)).filter(r => /^https?:\/\//.test(String(r.url || '')))
      if (!found.length) return { text: `Nothing came up for "${query}".`, cards: [] }
      return { text: `Here is what the web has on "${query}".`, cards: found.slice(0, 3).map(r => ({ title: clip(r.title || host(r.url), 90), source: r.url, ...(r.description ? { note: clip(r.description, 160) } : {}) })) }
    }
  }, {
    name: 'web_fetch',
    about: 'read a web page the person gives, by its address, and say what it says',
    args: { url: 'the page\'s address (https://…)' },
    kinds: ['app'],
    run: async a => {
      const p = await reads.pageText(url(a))
      const line = firstLine(p.markdown)
      return { text: line ? `${p.title || host(p.url)} says: ${clip(line, 220)}` : `I read ${p.title || host(p.url)}.`, cards: [{ title: clip(p.title || host(p.url), 90), source: p.url, ...(line ? { note: clip(line, 160) } : {}) }] }
    }
  }, {
    name: 'clone_site',
    about: 'look at a website the person wants their app to copy (an address): its words and a picture of it, with a button to clone it into the app',
    args: { url: 'the site\'s address (https://…)' },
    kinds: ['app'],
    run: async (a, ctx) => {
      const at = url(a)
      const [p, shot] = await Promise.all([reads.pageText(at), reads.pagePicture(at).catch(() => null)])
      // the picture on disk before the card is shown: showing it fetches nothing (/img/<run>/clone-<hash>.jpg)
      let img = null
      if (shot && ctx.run && /^[\w-]{1,64}$/.test(ctx.run)) {
        const name = `clone-${createHash('sha1').update(at).digest('hex').slice(0, 12)}.jpg`
        mkdirSync(join(runsDir, ctx.run, 'img'), { recursive: true })
        writeFileSync(join(runsDir, ctx.run, 'img', name), shot)
        img = `/img/${ctx.run}/${name}`
      }
      const line = firstLine(p.markdown)
      return {
        text: ctx.run ? `This is ${host(at)}. Press Clone it and the crew builds the app to look like it.` : `This is ${host(at)}. Once the app has been built, I can clone it into the app.`,
        cards: [{ title: clip(p.title || host(at), 90), source: at, ...(img ? { img } : {}), ...(line ? { note: clip(line, 160) } : {}), ...(ctx.run ? { act: { do: 'clone', url: at, run: ctx.run }, pick: 'Clone it' } : {}) }]
      }
    },
    act: async ({ do: what, url: at, run }) => {
      if (what !== 'clone' || !at || !run) throw Object.assign(new Error('nothing to clone'), { status: 400 })
      await change(run, `Clone the website at ${at} into this app: use web_crawl on that address, and copy its layout, sections and words, with placeholder pictures.`)
      return { text: `The crew is cloning ${host(at)} into the app. The App room shows it as it goes.` }
    }
  }]
}

export function chatTools(deps = {}) {
  return [
    ...(deps.assets && deps.refs ? [libraryTool(deps)] : []),
    ...(deps.reads && deps.change ? webTools(deps) : []),
    // (a) research #606: the web through Hermes's own tools (server/researchtool.mjs)
    ...(deps.refs && deps.web ? [researchTool(deps)] : []),
    ...(deps.extra || [])
  ]
}
