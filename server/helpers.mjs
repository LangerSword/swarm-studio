// The chat's helper tools on the server (decision 0025 e, engine/helpers.mjs; docs/specs/47-chat-helper.md).
//
//   POST /api/helper/pick { chat, turn, card } -> { text, card, chat }
//     press a card a tool showed in a saved chat turn: its action is the one kept on that turn, never one sent
//     here, and it runs once. Hermia's answer joins the chat as her next turn.
//
// kit: engine/helpers.mjs helperKit(tools); chats: engine/chats.mjs; ctxOf(chat) -> { kind, project, run, plan, chat }
export function helperRoutes({ kit, chats, ctxOf = chat => ({ kind: chat.kind, project: chat.project || null, run: chat.run || null, plan: chat.plan || null, chat: chat.id }) }) {
  const json = (res, code, data) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(data))
  const body = req => new Promise(resolve => {
    let b = ''
    req.on('data', c => { b += c; if (b.length > 4000) req.destroy() })
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')) } catch { resolve({}) } })
  })
  return function handle(req, res, url) {
    if (url.pathname !== '/api/helper/pick') return false
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true }
    body(req).then(async input => {
      const id = String(input.chat || ''), turnId = String(input.turn || ''), cardId = String(input.card || '')
      if (!chats.get(id)) return json(res, 404, { error: 'no such chat' })
      let out = null
      await chats.update(id, async chat => {
        const turn = (chat.turns || []).find(t => t.id === turnId && t.who === 'planner')
        if (!turn) throw Object.assign(new Error('no such turn'), { status: 404 })
        out = await kit.pick(turn, cardId, ctxOf(chat))
        chat.turns.push({ id: `t${chat.turns.length + 1}`, who: 'planner', at: Date.now(), text: out.text, refs: [], marks: [], layers: [], made: [], reads: [] })
      })
      json(res, 200, { ...out, chat: id })
    }).catch(err => json(res, err.status || 400, { error: String(err.message || err) }))
    return true
  }
}
