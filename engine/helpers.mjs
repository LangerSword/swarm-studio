// The chat as the helper (decision 0025 e, issue #617): the planner in the chat, Hermia, can call a tool, and the
// chat shows what the tool found as a few cards to pick from, in both Studios and in every kind of talk. It is the
// same planner with tools available to it, not a second assistant. docs/specs/47-chat-helper.md is the interface
// the parts that plug in (research, game intake, the app builder's web tools, the asset library) code against.
//
// A tool:
//   { name: 'library_search',                       a word the planner writes, [a-z_]{2,40}
//     about: 'find pictures in the asset library',  one line for the planner's prompt: what it does
//     args: { q: 'what to look for, in a few words' }, each argument and what it is (strings only)
//     kinds: ['game', 'site'],                       the talks it is offered in (omit: every kind)
//     run: async (args, ctx) => ({ text, cards }),   ONLY READS. text: one plain sentence for the chat.
//                                                     cards: [{ title, source, img?, note?, act? }]
//     act: async (act, ctx) => ({ text }) }          what pressing a card does (it may write: the press is the
//                                                     person's yes). act is the card's own `act`, kept on the
//                                                     saved turn and never taken from the browser.
// ctx: { kind, project, run, plan, chat } where the talk is (any may be null).
//
// The rules are kept here, not left to each tool: three cards at most (the owner's rule for choices), every card
// says where it came from (`source`), a card without one is dropped, and a tool that throws says so in one plain
// line instead of failing the talk.

export const MAX_CARDS = 3
const NAME = /^[a-z][a-z0-9_]{1,39}$/
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const IMG = /^(\/[\w\-./%?=&]{1,400}|https:\/\/[^\s"'<>]{1,600})$/

export function helperKit(tools = []) {
  const byName = new Map(tools.filter(t => t && NAME.test(t.name) && typeof t.run === 'function').map(t => [t.name, t]))
  const offered = kind => [...byName.values()].filter(t => !t.kinds || t.kinds.includes(kind))

  // the planner's prompt: the tools this talk offers, and how to call one ('' when none)
  function lines(kind) {
    const list = offered(kind)
    if (!list.length) return ''
    return [
      'You can use these tools when the person asks for something they do (find, look up, bring in, use this for).',
      ...list.map(t => `- ${t.name}: ${clip(t.about, 200)}. Args: ${Object.entries(t.args || {}).map(([k, v]) => `"${k}" (${clip(v, 80)})`).join(', ') || 'none'}`),
      'To use one, reply with one short sentence, then this JSON on its own line and nothing after it:',
      '{"tool": "<name>", "args": {...}}',
      'The person sees what the tool found and picks; never say you picked, added or used anything yourself.',
      'Use a tool only when they ask for what it does; otherwise answer as usual.'
    ].join('\n')
  }

  // {"tool": …} in a reply: the sentence before it, the tool's name and its args (strings only); null when there
  // is none, or it names a tool this talk does not offer
  function toolOf(reply, kind) {
    const s = String(reply || '')
    const at = s.search(/\{\s*"tool"\s*:/)
    if (at < 0) return null
    let j
    try { j = JSON.parse(s.slice(at, s.lastIndexOf('}') + 1)) } catch { return null }
    const t = byName.get(String(j?.tool || ''))
    if (!t || (kind && t.kinds && !t.kinds.includes(kind))) return { name: String(j?.tool || ''), args: {}, say: clip(s.slice(0, at), 400), unknown: true }
    const args = Object.fromEntries(Object.keys(t.args || {}).filter(k => typeof j.args?.[k] === 'string').map(k => [k, clip(j.args[k], 300)]))
    return { name: t.name, args, say: clip(s.slice(0, at), 400) }
  }

  // run a tool: { text, cards } with the rules applied. cards keep their `act` (the saved turn's); view() strips it
  async function run(name, args = {}, ctx = {}) {
    const t = byName.get(name)
    if (!t || (ctx.kind && t.kinds && !t.kinds.includes(ctx.kind))) return { text: 'That is not something I can do from this chat.', cards: [] }
    let got
    try { got = await t.run(args, ctx) } catch (err) { return { text: `I could not ${clip(t.about, 80).replace(/^\w/, c => c.toLowerCase())}: ${clip(err?.message || err, 160)}.`, cards: [] } }
    const cards = (Array.isArray(got?.cards) ? got.cards : []).filter(c => c && clip(c.title, 80) && clip(c.source, 200)).slice(0, MAX_CARDS)
      .map((c, i) => ({
        id: `c${i + 1}`, tool: t.name, title: clip(c.title, 80), source: clip(c.source, 200),
        ...(IMG.test(String(c.img || '')) ? { img: String(c.img) } : {}),
        ...(clip(c.note, 160) ? { note: clip(c.note, 160) } : {}),
        ...(c.act && typeof t.act === 'function' ? { act: c.act, pick: clip(c.pick, 30) || 'Use this' } : {})
      }))
    return { text: clip(got?.text, 400), cards }
  }

  // press a card: the action kept on the saved turn (never one the browser sends), once
  async function pick(turn, cardId, ctx = {}) {
    const card = (turn?.cards || []).find(c => c.id === cardId)
    if (!card) throw Object.assign(new Error('no such card'), { status: 404 })
    if (!card.act) throw Object.assign(new Error('that card is only to look at'), { status: 400 })
    if (card.picked) throw Object.assign(new Error('already done'), { status: 409 })
    const t = byName.get(card.tool)
    if (!t || typeof t.act !== 'function') throw Object.assign(new Error('that tool is not here any more'), { status: 410 })
    const got = await t.act(card.act, ctx)
    card.picked = Date.now()
    return { text: clip(got?.text, 400) || `Done: ${card.title}.`, card: view(card) }
  }

  return { lines, toolOf, run, pick, has: name => byName.has(name), names: () => [...byName.keys()] }
}

// a card as the browser gets it: no action, only whether it can be picked and how the button reads
export const view = ({ act, ...c }) => ({ ...c, ...(act ? {} : { pick: undefined }) })
export const cardsView = cards => (cards || []).map(view)

// what the next turn knows of the cards: their titles and sources in the turn's text, so "the second one" can be
// read from the conversation the clients send back
export function cardsLine(cards = []) {
  return cards.length ? `\n[Shown: ${cards.map((c, i) => `${i + 1}. ${c.title} (${c.source})`).join('; ')}]` : ''
}
