// Research from the chat (decision 0025 e, docs/specs/48-chat-helper.md; the research step is engine/research.mjs,
// #606): "look up how X does its pricing page" runs the research and shows at most three of the pages it read as
// cards, each with its source and what was taken. The run only reads (Hermes's web_search and web_extract through
// the bridge's /web, nothing kept); pressing a card keeps that finding in the project's References, where the next
// build reads it and the person can remove it. Outside a project the cards are only to look at.
//
// deps: { refs } (engine/refs.mjs); web(body, signal), bridge.py /web; chat(), the planner's model call or null;
// research, engine/research.mjs research (a stand-in in tests)
import { research as researchStep } from '../engine/research.mjs'

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }

export function researchTool({ refs, web, chat = null, research = researchStep, limits } = {}) {
  return {
    name: 'web_research',
    about: 'look something up on the web (how a named site, app or place does something, prices, features, opening hours) and show the pages read, each with what was taken from it',
    args: { ask: 'what to look up, in a few words (for example "how Notion lays out its pricing page")' },
    run: async ({ ask = '' }, ctx = {}) => {
      const got = await research({ ask, kind: ctx.kind || 'site', web, chat: chat?.() || null, ...(limits ? { limits } : {}) })
      if (!got.findings.length) return { text: `I could not find anything to use for "${ask}"${got.note ? `: ${got.note}` : ''}.`, cards: [] }
      const keep = !!ctx.project
      const n = Math.min(got.findings.length, 3)
      return {
        text: keep ? `Here ${n === 1 ? 'is the page' : `are ${n} pages`} I read. Press one to keep it in the project's References for the crew.` : `Here ${n === 1 ? 'is the page' : `are ${n} pages`} I read.`,
        cards: got.findings.slice(0, 3).map(f => ({
          title: f.title || hostOf(f.url), source: f.url, note: f.took,
          ...(keep ? { act: { project: ctx.project, finding: { url: f.url, title: f.title, took: f.took, query: f.query || ask } }, pick: 'Keep this' } : {})
        }))
      }
    },
    // the person's press: that page's finding joins the project's References (engine/refs.mjs addFinding)
    act: async ({ project, finding } = {}) => {
      if (!project || !finding?.url) throw Object.assign(new Error('nothing to keep'), { status: 400 })
      const r = refs.addFinding(project, finding)
      return { text: `Kept ${r.name} in the project's References. The next build reads what was taken from it; remove it there if you change your mind.` }
    }
  }
}
